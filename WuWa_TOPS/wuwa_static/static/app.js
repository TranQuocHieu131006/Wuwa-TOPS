// ---------------------------------------------------------------- state
let resonators = [];
let byId = {};
let selected = new Set();
let extra = new Set();          // nhân vật được +1 lần dùng (Matrix)
let mode = "toa";
let hasPull = false;
const MODE_NAME = { toa: "ToA", matrix: "Matrix" };
const modeTag = m => `<span class="mode-tag ${m}">${MODE_NAME[m]}</span>`;
let filterEl = null;
let filterRar = null;
let hasResult = false;

const LS = {
  load() {
    try {
      selected = new Set(JSON.parse(localStorage.getItem("wuwa.owned") || "[]"));
      extra = new Set(JSON.parse(localStorage.getItem("wuwa.extra") || "[]"));
      mode = localStorage.getItem("wuwa.mode") || "toa";
    } catch (e) { /* bỏ qua */ }
  },
  save() {
    try {
      localStorage.setItem("wuwa.owned", JSON.stringify([...selected]));
      localStorage.setItem("wuwa.extra", JSON.stringify([...extra]));
      localStorage.setItem("wuwa.mode", mode);
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
  buildFilters();
  syncMode();
  renderRoster();
}

function buildFilters() {
  const elBox = document.getElementById("elChips");
  elBox.innerHTML = ELEMENTS.map(e =>
    `<span class="chip" data-el="${e}" style="--c:${EL_COLOR[e]}"><i class="dot"></i>${e}</span>`).join("");
  elBox.querySelectorAll(".chip").forEach(ch => ch.addEventListener("click", () => {
    filterEl = filterEl === ch.dataset.el ? null : ch.dataset.el;
    elBox.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c.dataset.el === filterEl));
    renderRoster();
  }));

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
    : "Matrix: nhân vật đã chọn có nút + để thêm 1 lần dùng (tối đa ×2). Bấm − để bỏ.";
  // nút bấm luôn ghi rõ đang tính cho chế độ nào
  const mn = MODE_NAME[mode];
  const ob = document.getElementById("optimizeBtn"), pb = document.getElementById("pullBtn");
  if (ob && !ob.disabled) ob.textContent = `⚡ Xếp team cho ${mn}`;
  if (pb && !pb.disabled) pb.textContent = `🎯 Nên pull ai cho ${mn}?`;
}

// ---------------------------------------------------------------- roster
function visibleList() {
  const q = document.getElementById("search").value.trim().toLowerCase();
  const only = document.getElementById("onlySel").checked;
  return resonators.filter(r =>
    (!q || r.name.toLowerCase().includes(q)) &&
    (!filterEl || r.element === filterEl) &&
    (!filterRar || r.rarity === filterRar) &&
    (!only || selected.has(r.id)));
}

function renderRoster() {
  const box = document.getElementById("roster");
  const list = visibleList();
  box.innerHTML = list.map(r => {
    const sel = selected.has(r.id);
    const two = extra.has(r.id);
    return `
    <div class="char el-${r.element} ${sel ? "selected" : ""} ${mode === "matrix" ? "matrix" : ""}" data-id="${r.id}">
      ${r.released ? "" : '<span class="tag-up">SẮP RA</span>'}
      <span class="tick">✓</span>
      ${faceHTML(r, { size: "lg" })}
      <div class="nm">${esc(r.name)}</div>
      <div class="meta"><span class="${r.rarity === "5★" ? "star5" : "star4"}">${r.rarity}</span>
        <span style="color:${EL_COLOR[r.element] || "#888"}">${esc(r.element)}</span></div>
      <div class="copies">
        ${two ? '<button class="minus" title="Bỏ lần dùng thứ 2">−</button>' : ""}
        <span class="badge">×${two ? 2 : 1}</span>
        ${two ? "" : '<button class="plus" title="Thêm 1 lần dùng">+</button>'}
      </div>
    </div>`;
  }).join("") || '<p class="hint">Không có nhân vật nào khớp bộ lọc.</p>';

  box.querySelectorAll(".char").forEach(card => {
    const id = Number(card.dataset.id);
    card.addEventListener("click", e => {
      if (e.target.closest(".plus")) { extra.add(id); }
      else if (e.target.closest(".minus")) { extra.delete(id); }
      else {
        if (selected.has(id)) { selected.delete(id); extra.delete(id); }
        else selected.add(id);
      }
      afterChange();
    });
  });
  updateCounter();
}

function updateCounter() {
  const uses = selected.size + (mode === "matrix" ? [...extra].filter(i => selected.has(i)).length : 0);
  document.getElementById("counter").textContent =
    `Đã chọn ${selected.size} nhân vật` + (mode === "matrix" ? ` · ${uses} lượt dùng` : "");
}

function afterChange() {
  LS.save();
  renderRoster();
  if (hasResult) runOptimize(true);
}

function payload() {
  return {
    owned: [...selected],
    duplicates: mode === "matrix" ? [...extra].filter(i => selected.has(i)) : [],
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
    <div class="card-meta">${tierBadge(t.tier)}${esc(t.team_type || "")}${t.patch ? " · Patch " + esc(t.patch) : ""}
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
    <div class="card-meta">${tierBadge(x.tier)}${esc(x.team_type || "")}
      · dành cho <span class="for">${x.for.map(i => esc(byId[i]?.name || "?")).join(", ")}</span>
      · ${missing ? `thiếu ${missing} nhân vật` : "đủ người (nhưng một số đã dùng ở team khác)"}</div>
  </div>`;
}

// ---------------------------------------------------------------- optimize
async function runOptimize(silent = false) {
  if (!selected.size) {
    if (!silent) toast("Hãy chọn ít nhất vài Resonator trước.", true);
    return;
  }
  const btn = document.getElementById("optimizeBtn");
  btn.disabled = true;
  try {
    const d = await api("/api/optimize", "POST", payload());
    hasResult = true;
    hasPull = false;
    document.getElementById("resultTitle").innerHTML = `2. Xếp team cho ${modeTag(mode)}`;
    document.getElementById("result").classList.remove("hidden");
    if (!silent) document.getElementById("pullResult").classList.add("hidden");

    document.getElementById("summary").innerHTML = `
      <div class="stat"><b>${d.score.toFixed(1)}</b><span>Tổng điểm</span></div>
      <div class="stat"><b>${d.teams.length}</b><span>Team hoàn chỉnh</span></div>
      <div class="stat"><b>${d.leftover.reduce((a, l) => a + l.count, 0)}</b><span>Lượt nhân vật còn dư</span></div>
      <div class="stat"><b>${d.usable_templates}</b><span>Team trong DB dùng được</span></div>`;
    document.getElementById("approxWarn").classList.toggle("hidden", !d.approx);

    document.getElementById("teams").innerHTML = d.teams.length
      ? d.teams.map(teamCard).join("")
      : '<p class="hint">Chưa ghép được team hoàn chỉnh nào từ roster hiện tại. Xem gợi ý bên dưới hoặc bấm “Nên pull ai?”.</p>';

    document.getElementById("leftover").innerHTML = d.leftover.length
      ? d.leftover.map(l => {
          const r = byId[l.id];
          return `<span class="lo el-${r?.element}">${faceHTML(r, { size: "sm" })}${esc(r?.name || "?")}
            ${l.count > 1 ? `<small>×${l.count}</small>` : ""}</span>`;
        }).join("")
      : '<span class="hint">Không còn nhân vật nào dư 🎉</span>';

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
    const d = await api("/api/pull-advisor", "POST",
      { ...payload(), include_upcoming: document.getElementById("inclUpcoming").checked });
    document.getElementById("pullResult").classList.remove("hidden");
    document.getElementById("result").classList.add("hidden");
    hasResult = false;
    hasPull = true;
    document.getElementById("pullTitle").innerHTML = `Nên pull nhân vật nào cho ${modeTag(mode)}?`;
    document.getElementById("pullHint").textContent =
      `Tính theo luật ${MODE_NAME[mode]}${mode === "matrix" ? " (mỗi nhân vật dùng tối đa ×2)" : " (mỗi nhân vật dùng 1 lần)"}. ` +
      `Điểm hiện tại: ${d.base_score.toFixed(1)}. Mỗi dòng là mức tăng tổng điểm nếu bạn có thêm nhân vật đó (S0), dựa trên điểm bạn chấm trong database.`;

    document.getElementById("pulls").innerHTML = d.results.map((x, i) => {
      const r = byId[x.id];
      const teams = x.teams.map(t => `<span class="mini">
          ${t.members.map(id => faceHTML(byId[id], { size: "sm" })).join("")}
          ${tierBadge(t.tier)}${t.score.toFixed(1)}</span>`).join("");
      const sub = x.gain > 0
        ? `Điểm mới: ${x.new_score.toFixed(1)} · mở khóa ${x.unlocked} team`
        : x.unlocked > 0
          ? `Không tăng tổng điểm ngay, nhưng mở khóa ${x.unlocked} team (team tốt nhất ${x.best_unlocked.toFixed(1)})`
          : "Chưa mở khóa team nào với roster hiện tại";
      return `<div class="pull">
        <div class="no">${i + 1}</div>
        ${faceHTML(r, { size: "lg" })}
        <div>
          <div class="nm">${esc(x.name)} <span class="hint">${r ? r.rarity : ""} ${esc(r?.element || "")}${r && !r.released ? " · sắp ra mắt" : ""}</span></div>
          <div class="sub">${sub}</div>
          ${teams ? `<div class="mini-teams">${teams}</div>` : ""}
        </div>
        <div class="gain ${x.gain > 0 ? "" : "zero"}">${x.gain > 0 ? "+" : ""}${x.gain.toFixed(1)}</div>
      </div>`;
    }).join("") || '<p class="hint">Không có ứng viên nào.</p>';
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
  syncMode();
  LS.save();
  renderRoster();
  if (hasResult) runOptimize(true);
  else if (hasPull) runPull(true);
}));
document.getElementById("search").addEventListener("input", renderRoster);
document.getElementById("onlySel").addEventListener("change", renderRoster);
document.getElementById("selAll").addEventListener("click", () => {
  visibleList().forEach(r => { if (r.released) selected.add(r.id); });
  afterChange();
});
document.getElementById("clearAll").addEventListener("click", () => {
  if (selected.size && !confirm("Bỏ chọn tất cả nhân vật?")) return;
  selected.clear(); extra.clear();
  afterChange();
});
document.getElementById("optimizeBtn").addEventListener("click", () => runOptimize(false));
document.getElementById("pullBtn").addEventListener("click", runPull);

load();
