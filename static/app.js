// ---------------------------------------------------------------- state
let resonators = [];
let byId = {};
let selected = new Set();
let extra = new Set();          // nhân vật được +1 lần dùng (Matrix): chính là các Healer đã chọn
let sortKey = "name";           // "name" | "date"
let sortDir = "asc";
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
      sortKey = localStorage.getItem("wuwa.sortKey") === "date" ? "date" : "name";
      sortDir = localStorage.getItem("wuwa.sortDir") === "desc" ? "desc" : "asc";
    } catch (e) { /* bỏ qua */ }
  },
  save() {
    try {
      localStorage.setItem("wuwa.owned", JSON.stringify([...selected]));
      localStorage.setItem("wuwa.extra", JSON.stringify([...extra]));
      localStorage.setItem("wuwa.mode", mode);
      localStorage.setItem("wuwa.maxTeams", maxTeams == null ? "" : String(maxTeams));
      localStorage.setItem("wuwa.sortKey", sortKey);
      localStorage.setItem("wuwa.sortDir", sortDir);
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
  syncSort();
  renderRoster();
  renderLayout();
  syncBuilder();
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
  const ob = document.getElementById("optimizeBtn"), pb = document.getElementById("pullBtn");
  if (ob && !ob.disabled) ob.textContent = `⚡ Xếp team cho ${mn}`;
  if (pb && !pb.disabled) pb.textContent = `🎯 Nên pull ai cho ${mn}?`;
}

// ---------------------------------------------------------------- roster
const isHealer = id => !!byId[id] && byId[id].role === "Healer";
// Rover có 4 bản nhưng chỉ dùng 1 bản: chọn bản này thì bỏ các bản kia
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
  const dir = sortDir === "asc" ? 1 : -1;
  const byName = (a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  if (sortKey === "date") {
    return list.sort((a, b) => {
      if (!a.date !== !b.date) return a.date ? -1 : 1;           // chưa có ngày luôn xuống cuối
      if (a.date !== b.date) return a.date < b.date ? -dir : dir;
      return byName(a, b);
    });
  }
  return list.sort((a, b) => dir * byName(a, b));
}

function syncSort() {
  document.querySelectorAll("#sortSeg button").forEach(b => {
    const k = b.dataset.sort, on = k === sortKey;
    b.classList.toggle("active", on);
    if (k === "name") b.textContent = on && sortDir === "desc" ? "Tên Z → A" : "Tên A → Z";
    else b.textContent = !on ? "Ngày ra mắt"
      : sortDir === "desc" ? "Ngày ra mắt: mới → cũ" : "Ngày ra mắt: cũ → mới";
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

function renderRoster() {
  const box = document.getElementById("roster");
  const list = visibleList();
  box.innerHTML = list.map(r => {
    const sel = selected.has(r.id);
    return `
    <div class="char el-${r.element} ${sel ? "selected" : ""}" data-id="${r.id}"
         title="${esc(r.name)} · ${esc(r.element)}${r.date ? " · ra mắt " + fmtDate(r.date) : ""}${r.status !== "available" ? " · " + STATUS_META[r.status].label : ""}">
      <div class="tagrow">${statusTag(r.status)}</div>
      ${faceHTML(r, { size: "lg" })}
      <div class="nm"><span class="nm-t">${esc(r.name)}</span></div>
    </div>`;
  }).join("") || '<p class="hint">Không có nhân vật nào khớp bộ lọc.</p>';

  box.querySelectorAll(".char").forEach(card => {
    const id = Number(card.dataset.id);
    card.addEventListener("click", () => {
      if (selected.has(id)) selected.delete(id);
      else { selected.add(id); if (isRover(id)) pickOneRover(id); }
      afterChange();
    });
  });
  updateCounter();
}

function updateCounter() { /* đã bỏ dòng đếm số nhân vật đã chọn */ }

function afterChange() {
  applyHealerDefaults();
  LS.save();
  renderRoster();
  refreshLayout();
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
      <span class="score-pill">${t.score.toFixed(1)}</span>
    </div>
    ${renderMembers(t.members)}
    ${slotAlts(t, t.members)}
    <div class="card-meta">${esc(t.team_type || "")}
      ${t.notes ? `<br>${esc(t.notes)}` : ""}</div>
  </div>`;
}

function incompleteCard(x) {
  const missing = x.members.filter(m => m.missing).length;
  return `<div class="team-card">
    <div class="head">
      <div class="title">${esc(x.name || "Team")}</div>
      <span class="score-pill">${x.score.toFixed(1)}</span>
    </div>
    ${renderMembers(x.members.map(m => m.id), x.members)}
    ${slotAlts(x, x.members.map(m => m.id))}
    <div class="card-meta">${esc(x.team_type || "")}
      · dành cho <span class="for">${x.for.map(i => esc(byId[i]?.name || "?")).join(", ")}</span>
      · ${missing ? `thiếu ${missing} nhân vật` : "đủ người (nhưng một số đã dùng ở team khác)"}</div>
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
       <span class="nm">${esc(r.name)}</span>`
    : `<div class="ts-box"><span class="ts-empty">＋</span></div><span class="nm empty-nm">Trống</span>`;
  return `<div class="member ts" data-ti="${ti}" data-si="${si}">${body}</div>`;
}

function layoutTeamCard(t, ti) {
  const filled = t.members.filter(x => x != null).length;
  const full = filled === SLOT_COUNT;
  // kết quả chấm điểm chỉ dùng được khi còn khớp với số người hiện tại (tránh dùng kết quả cũ của bản 2/3 cho bản 3/3)
  const ev = t.ev && !t.stale && t.ev.complete === full ? t.ev : null;
  const matched = !!(ev && ev.matched);
  let title, pill, meta = "", alts = "";
  if (full && t.stale) {
    title = "Team tự xếp";
    pill = '<span class="score-pill zero">đang tính…</span>';
  } else if (full && matched) {
    title = ev.name || "Team";
    pill = `<span class="score-pill">${ev.score.toFixed(1)}</span>`;
    alts = slotAlts(ev, ev.order || t.members);
    meta = `${esc(ev.team_type || "")}${ev.notes ? `<br>${esc(ev.notes)}` : ""}`;
  } else if (full) {
    title = "Team tự xếp";
    pill = '<span class="score-pill zero" title="Bộ này không có trong database nên không được tính điểm">0 · ngoài DB</span>';
    meta = "Bộ này không có trong database nên không tính điểm.";
  } else {
    title = t.manual ? "Team tự xếp" : (matched ? ev.name || "Team" : "Team tự xếp");
    pill = `<span class="score-pill zero">${filled}/${SLOT_COUNT} · chưa đủ</span>`;
    if (!filled) meta = "Kéo nhân vật chưa dùng vào slot. Team không nhất thiết phải đủ 3 người.";
    else if (matched) {
      meta = `Đang khớp một phần với team <span class="for">${esc(ev.name || "Team")}</span>`;
      alts = ev.hints.map(h => {
        const faces = h.ids.map(i => faceHTML(byId[i], { size: "sm", off: !selected.has(i) })).join("");
        return faces ? `<span class="row"><span class="lbl">Gợi ý ${ROLE_LABELS[h.si] || "slot " + (h.si + 1)}:</span>${faces}</span>` : "";
      }).filter(Boolean).join("");
      alts = alts ? `<div class="alts">${alts}</div>` : "";
    } else meta = "Chưa có team nào trong database chứa đúng bộ này (vẫn có thể giữ như team tự xếp).";
  }
  return `<div class="team-card ${t.manual ? "manual" : ""}" data-ti="${ti}">
    <div class="head">
      <div class="title"><span class="rank">#${ti + 1}</span>${esc(title)}</div>
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
        return `<span class="lo dg el-${r?.element}" data-id="${l.id}">${faceHTML(r, { size: "sm" })}${esc(r?.name || "?")}
          ${l.count > 1 ? `<small>×${l.count}</small>` : ""}</span>`;
      }).join("")
    : '<span class="hint">Không còn nhân vật nào dư 🎉 (kéo nhân vật từ team về đây để gỡ ra)</span>';

  renderSummary(left);
}

function renderSummary(left = leftoverNow()) {
  const done = layout.filter(t => !t.stale && t.members.every(x => x != null) && t.ev && t.ev.matched && t.ev.complete && t.ev.score != null);
  const total = done.reduce((a, t) => a + t.ev.score, 0);
  document.getElementById("summary").innerHTML = `
    <div class="stat"><b>${total.toFixed(1)}</b><span>Tổng điểm</span></div>`;
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
  if (hasPull) return;
  const res = document.getElementById("result");
  if (selected.size || layout.length) res.classList.remove("hidden"); else res.classList.add("hidden");
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

// ---------------------------------------------------------------- preview team (chỉ xem trên web, không tải ảnh)
function showPreview() {
  const teams = layout.filter(t => t.members.some(x => x != null));
  if (!teams.length) return toast("Chưa có team nào để xem preview.", true);
  document.getElementById("exportPrev")?.remove();
  const ov = document.createElement("div");
  ov.id = "exportPrev"; ov.className = "exp-overlay";
  ov.innerHTML = `<div class="exp-box">
    <div class="exp-note"><b>Preview team</b><button class="small ghost" id="expClose">Đóng ✕</button></div>
    <div class="exp-shot"><div class="exp-grid">${teams.map(t => `<div class="exp-team">${
      t.members.map(id => id != null ? faceHTML(byId[id], { size: "lg" }) : '<span class="exp-blank"></span>').join("")}</div>`).join("")}</div></div>
  </div>`;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = e => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  ov.querySelector("#expClose").addEventListener("click", close);
  ov.addEventListener("click", e => { if (e.target === ov) close(); });
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
    hasPull = false;
    dirty = false;
    document.getElementById("result").classList.remove("hidden");
    syncBuilder();
    if (!silent) document.getElementById("pullResult").classList.add("hidden");

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

    if (!silent) document.getElementById("result").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------- pull advisor
async function runPull(silent = false) {
  if (!selected.size) {
    if (!silent) toast("Hãy chọn Resonator đang có trước.", true);
    return;
  }
  const btn = document.getElementById("pullBtn");
  btn.disabled = true;
  btn.textContent = "Đang tính…";
  try {
    const d = await api("/api/pull-advisor", "POST", payload());
    document.getElementById("pullResult").classList.remove("hidden");
    document.getElementById("result").classList.add("hidden");
    hasResult = false;
    hasPull = true;
    document.getElementById("pullTitle").innerHTML = `Nên pull nhân vật nào cho ${modeTag(mode)}?`;
    document.getElementById("pullHint").textContent =
      `Tính theo luật ${MODE_NAME[mode]}${mode === "matrix" ? " (mỗi nhân vật dùng tối đa ×2)" : " (mỗi nhân vật dùng 1 lần)"}. ` +
      `Điểm hiện tại: ${d.base_score.toFixed(1)}. Điểm pull = mức tăng tổng điểm team nếu bạn có thêm nhân vật đó (S0) + điểm Potential + điểm Meta (+5 nếu pull xong là đủ bộ meta, +2.5 nếu mới hoàn thành cặp, khi DPS đang chơi team alt). Xếp từ cao xuống thấp.`;
    document.getElementById("potLegend").innerHTML = potLegendHTML();

    const pullCard = (x, i) => {
      const r = byId[x.id];
      const teams = x.teams.map(t => `<span class="mini">
          ${t.members.map(id => faceHTML(byId[id], { size: "sm" })).join("")}
          ${t.score.toFixed(1)}</span>`).join("");
      const sub = x.gain > 0
        ? `Điểm mới: ${x.new_score.toFixed(1)} · mở khóa ${x.unlocked} team`
        : x.unlocked > 0
          ? `Không tăng tổng điểm ngay, nhưng mở khóa ${x.unlocked} team (team tốt nhất ${x.best_unlocked.toFixed(1)})`
          : x.meta
            ? "Chưa mở khóa team mới ngay, nhưng ghép cặp được với nhân vật đang có trong meta team"
            : "Chưa ghép được team nào với roster hiện tại — xuất hiện nhờ điểm Potential";
      return `<div class="pull">
        <div class="no">${i + 1}</div>
        ${faceHTML(r, { size: "lg" })}
        <div>
          <div class="nm">${esc(x.name)} ${r ? statusTag(r.status) : ""}</div>
          <div class="sub">${sub}</div>
          <div class="breakdown">Team ${fmtSigned(x.gain)} · Potential ${potBadge(x.potential)}${x.meta_bonus ? ` · Meta <b>${fmtSigned(x.meta_bonus)}</b>` : ""} = <b>${fmtSigned(x.pull)}</b></div>
          ${x.meta ? `<div class="meta-note">⭐ Đưa ${x.meta.dps.map(id => `<b>${esc(byId[id]?.name || "?")}</b>`).join(" / ")} từ team alt lên meta team${x.meta.name ? ` <b>${esc(x.meta.name)}</b>` : ""} — ${x.meta.complete ? "đủ bộ meta" : "hoàn thành cặp, còn thiếu 1 người"}</div>` : ""}
          ${teams ? `<div class="mini-teams">${teams}</div>` : ""}
        </div>
        <div class="gain ${x.pull > 0 ? "" : x.pull < 0 ? "neg" : "zero"}" title="Điểm pull">${x.pull > 0 ? "+" : x.pull < 0 ? "−" : ""}${Math.abs(x.pull).toFixed(1)}</div>
      </div>`;
    };
    // nhóm 1: ghép được team với nhân vật đang có; nhóm 2: "tiềm năng" = không ghép được team nào, chỉ lên nhờ điểm Potential
    // (cả 2 nhóm đều xếp điểm pull từ cao xuống thấp — engine đã sắp sẵn)
    const shown = d.results.filter(x => x.pull > 0);       // điểm pull <= 0 thì không hiện
    const pairable = shown.filter(x => x.pairable);
    const potential = shown.filter(x => !x.pairable);
    const group = (title, hint, list, empty) => `<div class="pull-group">
      <h3 class="sec">${title} <span class="hint">(${list.length})</span></h3>
      <p class="hint g">${hint}</p>
      ${list.length ? `<div class="pull-list">${list.map(pullCard).join("")}</div>` : `<p class="hint">${empty}</p>`}
    </div>`;
    document.getElementById("pulls").innerHTML =
      group("Ghép được với nhân vật hiện có",
        "Roll nhân vật này sẽ lập thêm được team với các nhân vật bạn đang có (đã gồm cả nhân vật sắp ra mắt).",
        pairable, "Chưa có nhân vật nào ghép được team với roster hiện tại.") +
      group("Nhân vật tiềm năng",
        "Chưa ghép được team nào với roster hiện tại, nhưng có điểm Potential cao nên vẫn được gợi ý.",
        potential, "Không có nhân vật tiềm năng nào (chấm Potential trong Admin → bảng Resonator).");
    if (!silent) document.getElementById("pullResult").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
    syncMode();
  }
}

// ---------------------------------------------------------------- events
document.querySelectorAll("#modeSeg button").forEach(b => b.addEventListener("click", () => {
  mode = b.dataset.mode;
  applyHealerDefaults();
  syncMode();
  LS.save();
  renderRoster();
  if (hasPull) runPull(true);
  else refreshLayout();
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
  if (selected.size && !confirm("Bỏ chọn tất cả nhân vật?")) return;
  selected.clear(); extra.clear();
  afterChange();
});
document.querySelectorAll("#sortSeg button").forEach(b => b.addEventListener("click", () => {
  const k = b.dataset.sort;
  if (k === sortKey) sortDir = sortDir === "asc" ? "desc" : "asc";   // bấm lại = đảo chiều
  else { sortKey = k; sortDir = k === "date" ? "desc" : "asc"; }     // ngày: mặc định mới nhất trước
  syncSort();
  LS.save();
  renderRoster();
}));
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
document.getElementById("pullBtn").addEventListener("click", () => runPull(false));

load();
