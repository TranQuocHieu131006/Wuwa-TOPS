// ---------------------------------------------------------------- state
let resonators = [];
let byId = {};
let selected = new Set();
let extra = new Set();          // nhân vật được +1 lần dùng (Matrix): chính là các Healer đã chọn

let mode = "toa";
let maxTeams = null;            // giới hạn số team khi xếp (null = không giới hạn)
let hasPull = false;
const MODE_NAME = { toa: "ToA", matrix: "Matrix" };
const modeTag = m => `<span class="mode-tag ${m}">${MODE_NAME[m]}</span>`;
let filterEl = null;
let filterRar = null;
let filterSt = null;
let hasResult = false;
let layout = [];                // các team đang hiển thị (tự động + tự xếp): {manual, members:[id|null x3], ev}
let lastD = null;               // kết quả optimize gần nhất
let evalSeq = 0;
let dirty = false;              // người dùng đã tự chỉnh team bằng tay -> không tự ghi đè nữa

const parseMax = v => { const n = Math.floor(Number(v)); return String(v ?? "").trim() !== "" && Number.isFinite(n) && n >= 1 ? n : null; };

const LS = {
  load() {
    try {
      selected = new Set(JSON.parse(localStorage.getItem("wuwa.owned") || "[]"));
      extra = new Set(JSON.parse(localStorage.getItem("wuwa.extra") || "[]"));
      mode = localStorage.getItem("wuwa.mode") || "toa";
      maxTeams = parseMax(localStorage.getItem("wuwa.maxTeams"));
    } catch (e) { /* bỏ qua */ }
  },
  save() {
    try {
      localStorage.setItem("wuwa.owned", JSON.stringify([...selected]));
      localStorage.setItem("wuwa.extra", JSON.stringify([...extra]));
      localStorage.setItem("wuwa.mode", mode);
      localStorage.setItem("wuwa.maxTeams", maxTeams == null ? "" : String(maxTeams));
    } catch (e) { /* bỏ qua */ }
  },
};

// ---------------------------------------------------------------- init
async function load() {
  LS.load();
  resonators = await api("/api/resonators");
  byId = Object.fromEntries(resonators.map(r => [r.id, r]));
  selected = new Set([...selected].filter(id => byId[id]));
  extra = new Set([...extra].filter(id => selected.has(id)));
  applyHealerDefaults();
  document.getElementById("maxTeams").value = maxTeams == null ? "" : maxTeams;
  buildFilters();
  syncMode();
  renderRoster();
  renderLayout();
  syncBuilder();
  refreshPull();
}

function buildFilters() {

  const rBox = document.getElementById("rarChips");
  rBox.innerHTML = ["5★", "4★"].map(r => `<span class="chip" data-r="${r}">${r}</span>`).join("");
  rBox.querySelectorAll(".chip").forEach(ch => ch.addEventListener("click", () => {
    filterRar = filterRar === ch.dataset.r ? null : ch.dataset.r;
    rBox.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c.dataset.r === filterRar));
    renderRoster();
  }));
}

function syncMode() {
  document.querySelectorAll("#modeSeg button").forEach(b =>
    b.classList.toggle("active", b.dataset.mode === mode));
  document.getElementById("modeHint").textContent = mode === "toa"
    ? "ToA: mỗi Resonator chỉ được dùng 1 lần. Click vào nhân vật để chọn / bỏ chọn."
    : "Matrix: Healer đã chọn tự được dùng ×2 (theo vai trò trong Admin). Click vào nhân vật để chọn / bỏ chọn.";
  document.body.classList.toggle("mode-matrix", mode === "matrix");
  // nút bấm luôn ghi rõ đang tính cho chế độ nào
  const mn = MODE_NAME[mode];
  const ob = document.getElementById("optimizeBtn");
  if (ob && !ob.disabled) ob.textContent = `⚡ Xếp team ${mn}`;
}

// ---------------------------------------------------------------- roster
const isHealer = id => !!byId[id] && byId[id].role === "Healer";
// Rover có 4 bản nhưng chỉ dùng 1 bản: chọn bản này thì bỏ các bản kia
const ROVER_ORDER = ["Spectro", "Havoc", "Aero", "Electro"];   // thứ tự trái → phải trong vòng cung chọn hệ Rover
const NO_HOVER = typeof matchMedia === "function" && matchMedia("(hover: none)").matches;
const isRover = id => /^Rover\b/.test(byId[id]?.name || "");
function pickOneRover(id) {
  resonators.forEach(r => {
    if (r.id !== id && isRover(r.id)) { selected.delete(r.id); extra.delete(r.id); }
  });
}
// Matrix: Healer đã chọn luôn có 2 lượt dùng (vai trò Healer chỉnh trong Admin → bảng Resonator)
function applyHealerDefaults() {
  extra = new Set();
  if (mode === "matrix") selected.forEach(id => { if (isHealer(id)) extra.add(id); });
}

const fmtDate = d => (d ? d.split("-").reverse().join("/") : "");

function sortList(list) {
  return list.sort((a,b)=>{
    const upcoming = r => !r.released || r.status==="upcoming";
    if(upcoming(a)!==upcoming(b)) return upcoming(a) ? 1 : -1;
    const rarity = r => String(r.rarity).startsWith("5") ? 5 : 4;
    if(rarity(a)!==rarity(b)) return rarity(b)-rarity(a);
    if(!a.date !== !b.date) return a.date ? -1 : 1;
    if(a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.id-b.id;
  });
}

function visibleList() {
  const q = document.getElementById("search").value.trim().toLowerCase();
  const only = document.getElementById("onlySel").checked;
  return sortList(resonators.filter(r =>
    (!q || r.name.toLowerCase().includes(q)) &&
    (!filterEl || r.element === filterEl) &&
    (!filterRar || r.rarity === filterRar) &&
    (!filterSt || r.status === filterSt) &&
    (!only || selected.has(r.id))));
}

let roverMenu = null;
let roverMenuTimer = 0;
function closeRoverMenu() {
  clearTimeout(roverMenuTimer);
  roverMenu?.remove();
  roverMenu = null;
  document.querySelectorAll('.char.rover').forEach(card => card.setAttribute('aria-expanded', 'false'));
}
function deferCloseRoverMenu() {
  clearTimeout(roverMenuTimer);
  roverMenuTimer = setTimeout(closeRoverMenu, 450);
}
function roverArcPositions(count, cardWidth = 100) {
  const perRing = 6, rings = Math.ceil(count / perRing);
  const baseX = cardWidth / 2 + 10, baseY = 32;
  const maxX = Math.min(baseX + Math.max(0, rings - 1) * 40, (window.innerWidth - 52) / 2);
  const maxY = baseY + Math.max(0, rings - 1) * 38;
  const width = maxX * 2 + 36, height = maxY + 36;
  const points = Array.from({length: count}, (_, index) => {
    const ring = Math.floor(index / perRing);
    const ringCount = Math.min(perRing, count - ring * perRing);
    const radiusX = maxX * (baseX + ring * 40) / (baseX + Math.max(0, rings - 1) * 40);
    const radiusY = baseY + ring * 38;
    const angle = ringCount === 1 ? Math.PI / 2 : Math.PI - Math.PI * (index % perRing) / (ringCount - 1);
    return {x: width / 2 + radiusX * Math.cos(angle), y: height - 18 - radiusY * Math.sin(angle)};
  });
  return {width, height, points};
}
function openRoverMenu(card, variants, focusFirst = false) {
  clearTimeout(roverMenuTimer);
  if (roverMenu?.anchor === card) return;
  closeRoverMenu();
  const menu = document.createElement('div');
  menu.className = 'rv-arc';
  menu.setAttribute('role', 'group');
  menu.setAttribute('aria-label', 'Chọn hệ cho Rover');
  const rect = card.getBoundingClientRect(), arc = roverArcPositions(variants.length, rect.width);
  menu.style.width = `${arc.width}px`; menu.style.height = `${arc.height}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.left + rect.width / 2 - arc.width / 2, window.innerWidth - arc.width - 8))}px`;
  menu.style.top = `${Math.max(8, rect.top - arc.height + 20)}px`;
  menu.innerHTML = variants.map((r, i) => `<button type="button" class="rv-opt ${selected.has(r.id) ? 'on' : ''}" data-rv-id="${r.id}" style="--c:${EL_COLOR[r.element] || '#5b8cff'};left:${arc.points[i].x}px;top:${arc.points[i].y}px" title="${esc(r.name)}" aria-label="${esc(r.name)}" aria-pressed="${selected.has(r.id)}">${elementIconHTML(r.element)}</button>`).join('');
  menu.anchor = card; roverMenu = menu; document.body.appendChild(menu);
  card.setAttribute('aria-expanded', 'true');
  menu.addEventListener('mouseenter', () => clearTimeout(roverMenuTimer));
  menu.addEventListener('mouseleave', deferCloseRoverMenu);
  menu.addEventListener('focusin', () => clearTimeout(roverMenuTimer));
  menu.addEventListener('focusout', e => { if (!menu.contains(e.relatedTarget) && e.relatedTarget !== card) deferCloseRoverMenu(); });
  menu.querySelectorAll('button').forEach((button, i, buttons) => {
    button.addEventListener('click', () => {
      const id = Number(button.dataset.rvId);
      if (selected.has(id)) { selected.delete(id); extra.delete(id); }
      else { selected.add(id); pickOneRover(id); }
      closeRoverMenu(); afterChange();
    });
    button.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault(); buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length].focus();
      }
    });
  });
  if (focusFirst) menu.querySelector('button')?.focus();
}
document.addEventListener('pointerdown', e => {
  if (roverMenu && !roverMenu.contains(e.target) && !roverMenu.anchor.contains(e.target)) closeRoverMenu();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && roverMenu) { const card = roverMenu.anchor; closeRoverMenu(); card.focus({preventScroll:true}); }
});
window.addEventListener('resize', closeRoverMenu);
window.addEventListener('scroll', closeRoverMenu);

function renderRoster() {
  closeRoverMenu();
  const box = document.getElementById("roster");
  const scrollTop = box.scrollTop;
  const focusedId = box.contains(document.activeElement) ? document.activeElement.closest(".char")?.dataset.id : null;
  let list = visibleList();
  // Rover chỉ hiện 1 thẻ: ưu tiên bản đang chọn, không thì bản đầu tiên; rê chuột vào để chọn hệ
  const roverAll = resonators.filter(r => isRover(r.id)).sort((a, b) => {
    const rank = r => ROVER_ORDER.includes(r.element) ? ROVER_ORDER.indexOf(r.element) : ROVER_ORDER.length;
    return rank(a) - rank(b) || a.element.localeCompare(b.element);
  });
  const roverVis = list.filter(r => isRover(r.id));
  const roverRep = roverVis.find(r => selected.has(r.id)) || roverVis[0];
  list = list.filter(r => !isRover(r.id) || r === roverRep);
  box.innerHTML = list.map(r => {
    const sel = selected.has(r.id);
    const rv = isRover(r.id);
    return `
    <div class="char el-${r.element} ${sel ? "selected" : ""} ${rv ? "rover" : ""}" data-id="${r.id}" ${rv ? 'data-rover="1" aria-expanded="false"' : ""} role="button" tabindex="0" aria-pressed="${sel}"
         title="${esc(rv ? (sel ? r.name : "Rover") + " · rê chuột để chọn hệ" : r.name + " · " + r.element)}${r.date ? " · ra mắt " + fmtDate(r.date) : ""}${r.status !== "available" ? " · " + STATUS_META[r.status].label : ""}">
      <div class="tagrow">${statusTag(r.status)}</div>
      ${faceHTML(r, { size: "lg" })}
      <div class="nm"><span class="nm-t">${esc(rv && !sel ? "Rover" : r.name)}</span></div>
    </div>`;
  }).join("") || '<p class="hint">Không có nhân vật nào khớp bộ lọc.</p>';

  box.querySelectorAll(".char").forEach(card => {
    const id = Number(card.dataset.id);
    card.addEventListener("keydown", e => {if(e.target === card && (e.key === "Enter" || e.key === " ")){e.preventDefault();card.click();}});
    if (card.dataset.rover) {
      card.addEventListener('mouseenter', () => openRoverMenu(card, roverAll));
      card.addEventListener('mouseleave', deferCloseRoverMenu);
      card.addEventListener('keydown', e => {
        if (e.target === card && e.key === 'ArrowUp') { e.preventDefault(); openRoverMenu(card, roverAll, true); }
      });
    }
    card.addEventListener("click", () => {
      if (card.dataset.rover) {
        if (NO_HOVER) { openRoverMenu(card, roverAll); return; }
        const had = [...selected].filter(isRover);
        if (had.length) had.forEach(x => { selected.delete(x); extra.delete(x); });
        else { selected.add(id); pickOneRover(id); }
        return afterChange();
      }
      if (selected.has(id)) selected.delete(id);
      else { selected.add(id); if (isRover(id)) pickOneRover(id); }
      afterChange();
    });
  });
  box.onscroll = closeRoverMenu;
  box.scrollTop = scrollTop;
  if(focusedId) box.querySelector(`.char[data-id="${focusedId}"]`)?.focus({preventScroll:true});
  updateCounter();
}

function updateCounter() { /* đã bỏ dòng đếm số nhân vật đã chọn */ }

function afterChange() {
  const pageX=window.scrollX,pageY=window.scrollY;
  applyHealerDefaults();
  LS.save();
  renderRoster();
  refreshLayout();
  refreshPull();
  if(window.scrollX!==pageX || window.scrollY!==pageY) window.scrollTo({left:pageX,top:pageY,behavior:"instant"});
}

// panel "Nên pull" độc lập với panel "Xếp team": roster/chế độ đổi thì tính lại (gộp các lần bấm liên tiếp)
let pullTimer = 0;
let pullRevision = 0;
function refreshPull() {
  clearTimeout(pullTimer);
  pullRevision++;
  if (!selected.size) { resetPullPanel(); return; }
  pullTimer = setTimeout(() => runPull(true), 250);
}
function resetPullPanel() {
  pullRevision++;
  hasPull = false;
  document.getElementById("pulls").innerHTML = '<p class="hint">Chọn Resonator để tự động xem gợi ý.</p>';
  document.getElementById("pullTitle").textContent = "3. Nên pull ai?";
  document.getElementById("pullHint").textContent = "Gợi ý nhân vật nên pull nhất dựa trên roster bạn đã chọn.";
}

function payload() {
  return {
    owned: [...selected],
    duplicates: mode === "matrix" ? [...extra].filter(i => selected.has(i)) : [],
    max_teams: maxTeams,
  };
}

// ---------------------------------------------------------------- team rendering
function slotAlts(team, chosenIds) {
  // hiển thị các lựa chọn thay thế của từng slot (sáng = đang có, mờ = chưa có)
  const rows = team.slots.map((slot, si) => {
    const others = slot.filter(id => !chosenIds.includes(id));
    if (!others.length) return "";
    return `<span class="row"><span class="lbl">${ROLE_LABELS[si] || "Slot " + (si + 1)}:</span>
      ${others.map(id => faceHTML(byId[id], { size: "sm", off: !selected.has(id) })).join("")}</span>`;
  }).filter(Boolean);
  return rows.length ? `<div class="alts">${rows.join("")}</div>` : "";
}

function renderMembers(ids, flags = []) {
  return `<div class="members">${ids.map((id, i) => {
    const r = byId[id];
    const f = flags[i] || {};
    const state = f.missing ? '<span class="state miss">chưa có</span>'
      : f.busy ? '<span class="state busy">đã dùng</span>' : "";
    return `<div class="member ${f.missing ? "missing" : ""}">
      <span class="role">${ROLE_LABELS[i] || ""}</span>
      ${faceHTML(r, { size: "lg", dark: f.missing, busy: f.busy })}
      <span class="nm">${f.missing ? "???" : esc(r ? r.name : "?")}</span>
      ${f.missing ? `<span class="nm" style="color:#6c7595;font-weight:600">${esc(r ? r.name : "")}</span>` : ""}
      ${state}
    </div>`;
  }).join("")}</div>`;
}

function teamCard(t, idx) {
  return `<div class="team-card">
    <div class="head">
      <div class="title"><span class="rank">#${idx + 1}</span>${esc(t.name || "Team")}</div>
    </div>
    ${renderMembers(t.members)}
    ${slotAlts(t, t.members)}
    <div class="card-meta">${esc(t.team_type || "")}
      ${t.notes ? `<br>${esc(t.notes)}` : ""}</div>
  </div>`;
}

function incompleteCard(x) {
  return `<div class="team-card">
    <div class="head">
      <div class="title">${esc(x.name || "Team")}</div>
    </div>
    ${renderMembers(x.members.map(m => m.id), x.members)}
    ${slotAlts(x, x.members.map(m => m.id))}
    ${x.team_type ? `<div class="card-meta">${esc(x.team_type)}</div>` : ""}
  </div>`;
}

// ---------------------------------------------------------------- team layout (kéo thả)
const SLOT_COUNT = 3;
const capOf = id => (selected.has(id) ? 1 + (mode === "matrix" && extra.has(id) ? 1 : 0) : 0);

function leftoverNow() {
  const used = new Map();
  layout.forEach(t => t.members.forEach(id => { if (id != null) used.set(id, (used.get(id) || 0) + 1); }));
  const out = [];
  selected.forEach(id => {
    const left = capOf(id) - (used.get(id) || 0);
    if (left > 0) out.push({ id, count: left });
  });
  return out.sort((a, b) => byId[a.id].name.localeCompare(byId[b.id].name, "en", { sensitivity: "base" }));
}

function slotHTML(t, ti, si) {
  const id = t.members[si];
  const r = id != null ? byId[id] : null;
  const body = r
    ? `<div class="ts-box"><span class="dg" data-ti="${ti}" data-si="${si}" data-id="${id}">${faceHTML(r, { size: "lg" })}</span>
         <button class="rm" data-ti="${ti}" data-si="${si}" title="Gỡ ra khỏi team">×</button></div>
       <span class="nm" title="${esc(r.name)}">${esc(r.name)}</span>`
    : `<div class="ts-box"><span class="ts-empty">＋</span></div><span class="nm empty-nm">Trống</span>`;
  return `<div class="member ts" data-ti="${ti}" data-si="${si}">${body}</div>`;
}

function layoutTeamCard(t, ti) {
  const filled = t.members.filter(x => x != null).length;
  const full = filled === SLOT_COUNT;
  // kết quả chấm điểm chỉ dùng được khi còn khớp với số người hiện tại (tránh dùng kết quả cũ của bản 2/3 cho bản 3/3)
  const ev = t.ev && !t.stale && t.ev.complete === full ? t.ev : null;
  const matched = !!(ev && ev.matched);
  let pill, meta = "", alts = "";
  if (full && t.stale) {
    pill = '<span class="score-pill zero">đang tính…</span>';
  } else if (full && matched) {
    pill = "";
    alts = slotAlts(ev, ev.order || t.members);
    meta = `${esc(ev.team_type || "")}${ev.notes ? `<br>${esc(ev.notes)}` : ""}`;
  } else if (full) {
    pill = '<span class="score-pill zero" title="Bộ này không có trong database">ngoài DB</span>';
    meta = "Bộ này không có trong database.";
  } else {
    pill = `<span class="score-pill zero">${filled}/${SLOT_COUNT} · chưa đủ</span>`;
    if (!filled) meta = "Kéo nhân vật chưa dùng vào slot. Team không nhất thiết phải đủ 3 người.";
    else if (matched) {
      meta = "Đang khớp một phần với team trong database.";
      alts = ev.hints.map(h => {
        const faces = h.ids.map(i => faceHTML(byId[i], { size: "sm", off: !selected.has(i) })).join("");
        return faces ? `<span class="row"><span class="lbl">Gợi ý ${ROLE_LABELS[h.si] || "slot " + (h.si + 1)}:</span>${faces}</span>` : "";
      }).filter(Boolean).join("");
      alts = alts ? `<div class="alts">${alts}</div>` : "";
    } else meta = "Chưa có team nào trong database chứa đúng bộ này (vẫn có thể giữ như team tự xếp).";
  }
  return `<div class="team-card ${t.manual ? "manual" : ""}" data-ti="${ti}">
    <div class="head ${pill ? "has-status" : ""}">
      <div class="head-r">${pill}<button class="rm-team" data-ti="${ti}" title="Giải tán team (nhân vật về mục còn dư)">✕</button></div>
    </div>
    <div class="members">${t.members.map((_, si) => slotHTML(t, ti, si)).join("")}</div>
    ${alts}
    <div class="card-meta">${meta}</div>
  </div>`;
}

function renderLayout() {
  const box = document.getElementById("teams");
  box.innerHTML = layout.length
    ? layout.map(layoutTeamCard).join("")
    : '<p class="hint">Chưa có team nào. Bấm “Xếp team” để máy xếp sẵn, hoặc bấm “Add new team” rồi kéo nhân vật từ mục “Nhân vật còn dư” vào.</p>';
  box.querySelectorAll(".rm").forEach(b => b.addEventListener("click", () => {
    layout[+b.dataset.ti].members[+b.dataset.si] = null;
    commitLayout();
  }));
  box.querySelectorAll(".rm-team").forEach(b => b.addEventListener("click", () => {
    layout.splice(+b.dataset.ti, 1);
    commitLayout();
  }));

  const left = leftoverNow();
  document.getElementById("leftover").innerHTML = left.length
    ? left.map(l => {
        const r = byId[l.id];
        return `<span class="lo dg el-${r?.element}" data-id="${l.id}" title="${esc(r?.name || '?')}">${faceHTML(r, { size: "sm" })}<span class="lo-name">${esc(r?.name || "?")}</span>
          ${l.count > 1 ? `<small>×${l.count}</small>` : ""}</span>`;
      }).join("")
    : '<span class="hint">Không còn nhân vật nào dư 🎉 (kéo nhân vật từ team về đây để gỡ ra)</span>';

  renderSummary(left);
}

function renderSummary(left = leftoverNow()) {
  const el = document.getElementById("summary");
  if (el) el.innerHTML = "";
}

// chấm lại điểm các team sau mỗi lần chỉnh (chỉ để hiện điểm/gợi ý, KHÔNG đổi vị trí người dùng đã xếp)
async function reeval() {
  const seq = ++evalSeq;
  let res;
  try { res = await api("/api/eval-teams", "POST", { teams: layout.map(t => t.members) }); }
  catch (e) { toast(e.message, true); return; }
  if (seq !== evalSeq || res.length !== layout.length) return;
  res.forEach((ev, i) => { layout[i].ev = ev; layout[i].stale = false; });
  renderLayout();
}
function commitLayout(user = true) {
  if (user) dirty = true;
  layout.forEach(t => { t.stale = true; });          // điểm cũ không còn đúng cho tới khi chấm xong
  renderLayout();
  reeval();
}

// bỏ các nhân vật đã bị bỏ chọn / vượt số lượt cho phép khỏi layout
function sanitizeLayout() {
  const used = new Map();
  layout.forEach(t => t.members.forEach((id, i) => {
    if (id == null) return;
    const n = (used.get(id) || 0) + 1;
    used.set(id, n);
    if (n > capOf(id)) t.members[i] = null;
  }));
}

function syncBuilder() {
  document.getElementById("incWrap").classList.toggle("hidden", !hasResult);
  document.getElementById("resultTitle").innerHTML = hasResult ? `2. Xếp team cho ${modeTag(mode)}` : "2. Xếp team (tự do)";
}

// sau khi đổi roster / chế độ: giữ nguyên các chỉnh tay, chỉ dọn phần không còn hợp lệ
function refreshLayout() {
  if (!selected.size) { layout = []; dirty = false; hasResult = false; lastD = null; }
  else if (hasResult && !dirty) { runOptimize(true); return; }
  else sanitizeLayout();
  renderLayout();
  if (layout.length) reeval();
  syncBuilder();
}

function addTeam() {
  layout.push({ manual: true, members: Array(SLOT_COUNT).fill(null), ev: null });
  dirty = true;
  syncBuilder();
  renderLayout();
  const cards = document.querySelectorAll("#teams .team-card");
  if (cards.length) cards[cards.length - 1].scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// áp dụng 1 lần thả. src: {id, ti?, si?} (ti == null: kéo từ mục còn dư). tgt: {slot:[ti,si]} hoặc {pool:true}
// Hoàn toàn tự do: không kiểm tra vai trò, không giới hạn số DPS, không tự sắp lại.
function applyDrop(src, tgt) {
  const fromTeam = src.ti != null;
  if (tgt.pool) {
    if (!fromTeam) return;
    layout[src.ti].members[src.si] = null;
    return commitLayout();
  }
  let [tt, ts] = tgt.slot;
  const dest = layout[tt].members;
  if (ts === -1) {                                   // thả vào thân card: vào slot trống đầu tiên
    ts = dest.findIndex(x => x == null);
    if (ts < 0) return toast("Team này đã đủ 3 người — thả thẳng lên 1 slot để đổi chỗ.", true);
  }
  if (!fromTeam) { dest[ts] = src.id; return commitLayout(); }   // slot đang có người -> người đó về mục còn dư
  if (src.ti === tt && src.si === ts) return;
  const from = layout[src.ti].members;
  const a = from[src.si], b = dest[ts];
  from[src.si] = b; dest[ts] = a;                    // hoán đổi
  commitLayout();
}

// kéo thả bằng pointer events: chạy cho cả chuột lẫn cảm ứng
(function initDnd() {
  let drag = null, ghost = null, hover = null, px = 0, py = 0, raf = 0;
  const EDGE = 70;
  const clearHover = () => { if (hover) { hover.classList.remove("drop-hover"); hover = null; } };
  const end = () => { if (drag) drag.el.classList.remove("dragging"); if (ghost) ghost.remove(); clearHover(); cancelAnimationFrame(raf); drag = ghost = null; };
  const updateHover = () => {
    const t = targetAt(px, py);
    if (t !== hover) { clearHover(); hover = t; if (t) t.classList.add("drop-hover"); }
  };
  // kéo sát mép trên/dưới màn hình thì trang tự cuộn (để thả vào team ở xa)
  const autoScroll = () => {
    if (!drag || !drag.started) return;
    const dy = py < EDGE ? -Math.ceil((EDGE - py) / 4) : py > innerHeight - EDGE ? Math.ceil((py - (innerHeight - EDGE)) / 4) : 0;
    if (dy) { window.scrollBy({ top: dy, behavior: "instant" }); updateHover(); }
    raf = requestAnimationFrame(autoScroll);
  };
  const targetAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest("#teams .ts, #teams .team-card, #leftover") : null;
  };

  document.addEventListener("dragstart", e => { if (e.target.closest && e.target.closest(".dg")) e.preventDefault(); });
  document.addEventListener("pointerdown", e => {
    const el = e.target.closest && e.target.closest("#teams .dg, #leftover .dg");
    if (!el || (e.pointerType === "mouse" && e.button !== 0)) return;
    drag = { el, x: e.clientX, y: e.clientY, started: false,
      src: { id: Number(el.dataset.id), ti: el.dataset.ti !== undefined ? Number(el.dataset.ti) : null,
             si: el.dataset.si !== undefined ? Number(el.dataset.si) : null } };
  });
  document.addEventListener("pointermove", e => {
    if (!drag) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      drag.started = true;
      drag.el.classList.add("dragging");
      ghost = drag.el.cloneNode(true);
      ghost.classList.add("drag-ghost");
      document.body.appendChild(ghost);
      raf = requestAnimationFrame(autoScroll);
    }
    e.preventDefault();
    px = e.clientX; py = e.clientY;
    ghost.style.left = px + "px";
    ghost.style.top = py + "px";
    updateHover();
  }, { passive: false });
  document.addEventListener("pointerup", e => {
    if (!drag) return;
    const wasDrag = drag.started, src = drag.src;
    const t = wasDrag ? targetAt(e.clientX, e.clientY) : null;
    end();
    if (!t) return;
    if (t.id === "leftover") applyDrop(src, { pool: true });
    else if (t.classList.contains("ts")) applyDrop(src, { slot: [Number(t.dataset.ti), Number(t.dataset.si)] });
    else applyDrop(src, { slot: [Number(t.dataset.ti), -1] });
  });
  document.addEventListener("pointercancel", end);
})();

// ---------------------------------------------------------------- preview team and PNG download
function showPreview() {
  const teams = layout.filter(t => t.members.some(x => x != null));
  if (!teams.length) return toast("Chưa có team nào để xem preview.", true);
  document.getElementById("exportPrev")?.remove();
  const ov = document.createElement("div");
  ov.id = "exportPrev"; ov.className = "exp-overlay";
  const previewMode = mode;
  const theme = getComputedStyle(document.getElementById("result"));
  ["--panel", "--panel2", "--bg2", "--line"].forEach(key => ov.style.setProperty(key, theme.getPropertyValue(key)));
  ov.innerHTML = `<div class="exp-box">
    <div class="exp-note"><b>Preview team</b><button class="small ghost" id="expClose">Đóng ✕</button></div>
    <div class="exp-shot"><div class="exp-grid">${teams.map(t => `<div class="exp-team">${
      t.members.map(id => id != null ? faceHTML(byId[id], { size: "lg" }) : '<span class="exp-blank"></span>').join("")}</div>`).join("")}</div></div>
  </div>`;
  const footer = document.createElement("div");
  footer.className = "exp-footer";
  footer.innerHTML = '<button type="button" class="primary" id="expDownload">↓ Tải về ảnh</button>';
  ov.querySelector(".exp-box").appendChild(footer);
  document.body.appendChild(ov);
  footer.querySelector("button").addEventListener("click", async e => {
    const button = e.currentTarget;
    button.disabled = true;
    button.textContent = "Đang tạo ảnh…";
    try { await downloadPreviewImage(teams, ov, previewMode); }
    catch (error) { toast("Không tải được ảnh: " + error.message, true); }
    finally { button.disabled = false; button.textContent = "↓ Tải về ảnh"; }
  });
  const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = e => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  ov.querySelector("#expClose").addEventListener("click", close);
  ov.addEventListener("click", e => { if (e.target === ov) close(); });
}

// PNG lấy kích thước / khoảng cách / bo góc trực tiếp từ preview đang hiển thị (đo bằng DOM),
// nên chỉnh CSS .exp-grid / .exp-team / .face ... thì ảnh tải về tự khớp, không cần sửa số trong code.
async function downloadPreviewImage(teams, overlay, previewMode) {
  const shot = overlay.querySelector(".exp-shot");
  const grid = overlay.querySelector(".exp-grid");
  const gridRect = grid.getBoundingClientRect();
  const cs = getComputedStyle(shot);
  const padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0;
  const padT = parseFloat(cs.paddingTop) || 0, padB = parseFloat(cs.paddingBottom) || 0;
  // vị trí từng ô (nhân vật hoặc ô trống) theo đúng thứ tự trong preview
  const cells = [...grid.querySelectorAll(".exp-team")].map(row => [...row.children].map(el => {
    const rc = el.getBoundingClientRect();
    return { x: rc.left - gridRect.left + padL, y: rc.top - gridRect.top + padT, w: rc.width, h: rc.height,
             radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 16 };
  }));
  const width = Math.round(gridRect.width + padL + padR);
  const height = Math.round(gridRect.height + padT + padB);
  const canvas = document.createElement("canvas");
  canvas.width = width * 2; canvas.height = height * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Trình duyệt không hỗ trợ tạo ảnh.");
  ctx.scale(2, 2);
  ctx.fillStyle = cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)" ? cs.backgroundColor : "#0d1220";
  ctx.fillRect(0, 0, width, height);
  const images = new Map();
  let missing = 0;
  const ids = [...new Set(teams.flatMap(t => t.members).filter(id => id != null))];
  await Promise.all(ids.map(async id => {
    const r = byId[id];
    const load = src => new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      const timer = setTimeout(() => reject(new Error("timeout")), 8000);
      img.onload = () => { clearTimeout(timer); resolve(img); };
      img.onerror = () => { clearTimeout(timer); reject(new Error("blocked")); };
      img.src = src;
    });
    // Canvas chỉ xuất được PNG khi ảnh có header CORS. CDN Prydwen thường không có, nên:
    // 1) thử tải trực tiếp, 2) nếu bị chặn thì đi qua proxy ảnh có CORS (wsrv.nl / weserv.nl), 3) cuối cùng mới dùng chữ viết tắt.
    const remote = r.remote || r.img;
    const sources = [remote];
    if (/^https?:/i.test(remote)) {
      const enc = encodeURIComponent(remote);
      sources.push(`https://wsrv.nl/?url=${enc}&output=png`, `https://images.weserv.nl/?url=${enc}&output=png`);
    }
    let got = null;
    for (const src of sources) {
      try { got = await load(src); break; } catch (_) { /* thử nguồn tiếp theo */ }
    }
    if (!got) {
      missing++;
      got = await load(initialsSvg(r.name, EL_COLOR[r.element] || "#5b8cff"));
    }
    images.set(id, got);
  }));
  teams.forEach((team, index) => {
    team.members.forEach((id, slot) => {
      if (id == null) return;
      const box = cells[index] && cells[index][slot];
      if (!box) return;
      const r = byId[id], img = images.get(id);
      const { x: left, y, w, h, radius } = box;
      ctx.save();
      ctx.beginPath(); ctx.roundRect(left, y, w, h, radius); ctx.clip();
      ctx.fillStyle = "#0b0f1b"; ctx.fillRect(left, y, w, h);
      const crop = Math.min(img.naturalWidth, img.naturalHeight);
      ctx.drawImage(img, (img.naturalWidth - crop) / 2, (img.naturalHeight - crop) / 2,
        crop, crop, left + 2, y + 2, w - 4, h - 4);
      ctx.restore();
      ctx.strokeStyle = EL_COLOR[r.element] || "#5b8cff";
      ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(left + 1, y + 1, w - 2, h - 2, Math.max(radius - 1, 0)); ctx.stroke();
    });
  });
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Không tạo được file PNG.");
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = `Wuwa-teams-${previewMode}.png`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (missing) toast(`${missing} ảnh không tải được; đã dùng tên viết tắt thay thế.`, true);
}

// ---------------------------------------------------------------- optimize
async function runOptimize(silent = false) {
  if (!selected.size) {
    if (!silent) toast("Hãy chọn ít nhất vài Resonator trước.", true);
    return;
  }
  if (!silent && dirty && !confirm("Xếp tự động sẽ ghi đè các team bạn đã tự chỉnh. Tiếp tục?")) return;
  const btn = document.getElementById("optimizeBtn");
  btn.disabled = true;
  try {
    const d = await api("/api/optimize", "POST", payload());
    hasResult = true;
    dirty = false;
    syncBuilder();

    lastD = d;
    layout = d.teams.map(t => ({
      manual: false,
      members: t.members.slice(),
      ev: { matched: true, complete: true, team_id: t.team_id, name: t.name, team_type: t.team_type,
            notes: t.notes, score: t.score, slots: t.slots, hints: [], pairs_active: t.pairs_active || [] },
    }));
    document.getElementById("approxWarn").classList.toggle("hidden", !d.approx);
    const ln = document.getElementById("limitNote");
    if (maxTeams && d.teams.length < maxTeams) {
      ln.textContent = `Giới hạn ${maxTeams} team nhưng roster hiện tại chỉ xếp được ${d.teams.length} team — đã hiển thị tất cả.`;
      ln.classList.remove("hidden");
    } else ln.classList.add("hidden");
    renderLayout();

    document.getElementById("incomplete").innerHTML = d.incomplete.length
      ? d.incomplete.map(incompleteCard).join("")
      : '<p class="hint">Không có gợi ý nào (hoặc không có nhân vật dư).</p>';

  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
    syncMode();
  }
}

// ---------------------------------------------------------------- pull advisor
function pullAnchorIds(x,owned) {
  const linked=!!x.chains?.length;
  const comps=linked ? x.chains : x.teams || [];
  return [...new Set(comps.flatMap(t=>{
    const slot1=t.slot1 ?? t.members[0];
    if(!linked) return [slot1];
    if(t.members.length===3 && slot1!==x.id) return [slot1];
    return t.members.filter(id=>id!==x.id && owned.has(id));
  }).filter(id=>id!=null))];
}
function groupLinkedSuggestions(list,owned=new Set()) {
  const groups=[],byContext=new Map();
  for(const x of list) {
    const contexts=x.chains?.length ? x.chains.map(t=>`${t.members.length}:`+t.members.filter(id=>id!==x.id).sort((a,b)=>a-b).join(",")).sort() : (x.teams || []).filter(t=>(t.members.length===2 || t.members.length===3) && t.members.includes(x.id) && t.members.filter(id=>id!==x.id).every(id=>owned.has(id))).map(t=>`${t.members.length}:`+t.members.filter(id=>id!==x.id).sort((a,b)=>a-b).join(",")).sort();
    const key=x.pairable && contexts.length ? (x.chains?.length ? "linked:" : "unlinked:")+JSON.stringify([...new Set(contexts)]) : "single:"+x.id;
    if(byContext.has(key)) byContext.get(key).push(x);
    else {const rows=[x];byContext.set(key,rows);groups.push(rows);}
  }
  return groups;
}
function pullCardHTML(x,i,owned,showAnchors=true) {
  const r=byId[x.id],ids=x.pairable && showAnchors ? pullAnchorIds(x,owned) : [];
  const linked=x.pairable && !!x.chains?.length;
  const images=ids.map(id=>faceHTML(byId[id],{size:"sm",off:!owned.has(id)})).join("");
  return `<div class="pull-option">${faceHTML(r,{size:"lg"})}<div><div class="nm ${linked ? "pull-gold-name" : ""}">${esc(x.name)}${linked ? ' <span class="pull-star" aria-hidden="true">⭐</span>' : ""} ${r ? statusTag(r.status) : ""}</div>${images ? `<div class="pull-linked-comps">${images}</div>` : ""}</div></div>`;
}
function pullLinkedBoxHTML(rows,i,owned) {
  return `<div class="pull pull-choice-box"><div class="no">${i+1}</div><div class="pull-choices">${rows.map((x,k)=>(k ? '<div class="pull-or">hoặc</div>' : "")+pullCardHTML(x,i,owned,k===0)).join("")}</div></div>`;
}
async function runPull(silent=true) {
  if(!selected.size) {resetPullPanel();return;}
  const revision=++pullRevision, snapshot=payload(), owned=new Set(snapshot.owned), requestMode=mode;
  try {
    const d=await api("/api/pull-advisor","POST",snapshot);
    if(revision!==pullRevision) return;
    hasPull=true;
    document.getElementById("pullTitle").innerHTML=`3. Nên pull ai cho ${modeTag(requestMode)}?`;
    document.getElementById("pullHint").textContent="Tự động cập nhật theo nhân vật bạn chọn.";
    document.getElementById("potLegend").innerHTML="";
    const shown=d.results.filter(x=>x.pull>0);
    const group=(title,list,empty)=>`<div class="pull-group"><h3 class="sec">${title} <span class="hint">(${list.length})</span></h3>${list.length ? `<div class="pull-list">${groupLinkedSuggestions(list,owned).map((rows,i)=>pullLinkedBoxHTML(rows,i,owned)).join("")}</div>` : `<p class="hint">${empty}</p>`}</div>`;
    document.getElementById("pulls").innerHTML=group("Ghép được với nhân vật hiện có",shown.filter(x=>x.pairable),"Chưa có gợi ý ghép phù hợp.")+group("Nhân vật tiềm năng",shown.filter(x=>!x.pairable),"Không có gợi ý tiềm năng.");
  } catch(e) {if(revision===pullRevision)toast(e.message,true);}
}

// ---------------------------------------------------------------- events
document.querySelectorAll("#modeSeg button").forEach(b => b.addEventListener("click", () => {
  mode = b.dataset.mode;
  applyHealerDefaults();
  syncMode();
  LS.save();
  renderRoster();
  refreshLayout();
  refreshPull();
}));
document.getElementById("search").addEventListener("input", renderRoster);
document.getElementById("onlySel").addEventListener("change", renderRoster);
document.getElementById("selAll").addEventListener("click", () => {
  visibleList().forEach(r => {
  if (!r.released) return;
  if (isRover(r.id) && [...selected].some(isRover)) return;   // chỉ giữ 1 bản Rover
  selected.add(r.id);
});
  afterChange();
});
document.getElementById("clearAll").addEventListener("click", () => {
  selected.clear(); extra.clear();
  afterChange();
});
document.getElementById("maxTeams").addEventListener("change", e => {
  maxTeams = parseMax(e.target.value);
  e.target.value = maxTeams == null ? "" : maxTeams;      // 0 / chữ / số âm -> về "không giới hạn"
  LS.save();
  if (hasResult && !dirty) runOptimize(true);
  else if (hasResult && dirty) toast("Đã lưu giới hạn. Bấm “Xếp team” để áp dụng (sẽ ghi đè team bạn tự chỉnh).");
});
document.getElementById("addTeamBtn").addEventListener("click", addTeam);
document.getElementById("exportBtn").addEventListener("click", showPreview);
document.getElementById("optimizeBtn").addEventListener("click", () => runOptimize(false));

// ---------------------------------------------------------------- kéo thả đổi độ rộng 2 panel Xếp team / Nên pull
// - Thanh giữa 2 panel: đổi tỉ lệ rộng của Xếp team ↔ Nên pull.
// - 2 mép ngoài: kéo ra để nới cả cụm vượt khỏi khung Resonator (nới đối xứng 2 bên), kéo vào để thu lại.
// - Nhấp đúp vào thanh/mép để về mặc định. Lưu trong trình duyệt.

load();

// Anchor the desktop roster below the header, independent of page scrolling.
function syncRosterAnchor() {
  const header = document.querySelector("header.top");
  if (header) document.documentElement.style.setProperty("--roster-top", `${Math.ceil(header.getBoundingClientRect().height) + 24}px`);
}
syncRosterAnchor();
window.addEventListener("resize", syncRosterAnchor);
if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(syncRosterAnchor).observe(document.querySelector("header.top"));
}

// Resize the horizontal space shared by the builder and Pull Suggest.
(function initBuilderResize() {
  const panel = document.getElementById('result');
  const pull = document.getElementById('pullResult');
  const shell = document.getElementById('optimizerShell');
  const grip = document.getElementById('builderResize');
  if (!panel || !pull || !shell || !grip) return;
  const storageKey = 'wuwa_builder_width_ratio_v1';
  let drag = null, ratio = null;
  const desktop = () => window.innerWidth >= 1200;
  const positionGrip = () => {
    if (!desktop()) return;
    const r = panel.getBoundingClientRect(), p = pull.getBoundingClientRect();
    const header = document.querySelector('header.top').getBoundingClientRect();
    const top = Math.max(r.top, header.bottom + 12), bottom = Math.min(r.bottom, window.innerHeight - 20);
    grip.style.left = `${(r.right + p.left) / 2}px`;
    grip.style.top = `${(top + Math.max(top, bottom)) / 2}px`;
    grip.style.visibility = bottom > top ? 'visible' : 'hidden';
  };
  const totalWidth = () => panel.getBoundingClientRect().width + pull.getBoundingClientRect().width;
  const setWidth = value => {
    if (!desktop()) return;
    const total = totalWidth();
    const width = Math.round(Math.max(Math.min(480, total * .6), Math.min(value, total - 280)));
    const rosterWidth = document.getElementById('rosterPanel').getBoundingClientRect().width;
    shell.style.gridTemplateColumns = `${rosterWidth}px minmax(0, ${width}px) minmax(280px, 1fr)`;
    ratio = width / total;
    grip.setAttribute('aria-valuenow', String(width));
    positionGrip();
  };
  const save = () => { try { localStorage.setItem(storageKey, String(ratio)); } catch (_) {} };
  const reset = () => {
    ratio = null; shell.style.removeProperty('grid-template-columns'); grip.removeAttribute('aria-valuenow');
    try { localStorage.removeItem(storageKey); } catch (_) {}
    positionGrip();
  };
  try {
    localStorage.removeItem('wuwa_builder_height_v1');
    const stored = parseFloat(localStorage.getItem(storageKey));
    if (Number.isFinite(stored) && stored > 0 && stored < 1) ratio = stored;
  } catch (_) {}
  if (ratio != null && desktop()) setWidth(totalWidth() * ratio);
  grip.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !desktop()) return;
    e.preventDefault(); drag = {x: e.clientX, width: panel.getBoundingClientRect().width};
    grip.setPointerCapture(e.pointerId); document.body.classList.add('builder-resizing');
  });
  grip.addEventListener('pointermove', e => { if (drag) setWidth(drag.width + e.clientX - drag.x); });
  const end = () => { if (!drag) return; drag = null; document.body.classList.remove('builder-resizing'); save(); };
  grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end); grip.addEventListener('lostpointercapture', end);
  grip.addEventListener('dblclick', reset);
  grip.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault(); setWidth(panel.getBoundingClientRect().width + (e.key === 'ArrowLeft' ? -20 : 20)); save();
    } else if (e.key === 'Home') { e.preventDefault(); reset(); }
  });
  window.addEventListener('resize', () => {
    shell.style.removeProperty('grid-template-columns');
    if (ratio != null && desktop()) setWidth(totalWidth() * ratio);
    positionGrip();
  });
  window.addEventListener('scroll', positionGrip, {passive:true});
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(positionGrip); observer.observe(panel); observer.observe(pull);
  }
  positionGrip();
})();
