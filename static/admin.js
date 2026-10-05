let chars = [];
let byId = {};
let teams = [];
let slots = [[], [], []];
let slotTiers = [[], [], []];   // bậc S→F của từng nhân vật trong slot (song song với slots)
let pairs = [];                 // cặp chuẩn [[idA, idB, idC], ...] (0 = ô trống, tối đa 1 ô trống): đủ bộ -> mỗi người được nâng 1 bậc
let teamKind = "meta";           // dạng team đang chọn trong form: "meta" (team chuẩn) | "alt" (team chắp vá)
const TIER_LIST = ["S", "A", "B", "C", "D", "E", "F"];
const tierRank = v => Math.max(TIER_LIST.indexOf(v), 0);
// giữ danh sách trong slot luôn xếp từ bậc cao xuống thấp (ổn định: cùng bậc giữ nguyên thứ tự thêm)
function sortSlot(si) {
  const arr = slots[si].map((id, k) => ({ id, t: slotTiers[si][k] || "S", k }));
  arr.sort((a, b) => tierRank(a.t) - tierRank(b.t) || a.k - b.k);
  slots[si] = arr.map(x => x.id);
  slotTiers[si] = arr.map(x => x.t);
}
const fmtScore = n => (Number.isInteger(+n) ? String(+n) : (+n).toFixed(1));
let editing = null;
let scoreTouched = false;

const SLOT_TITLES = ["Slot 1 · DPS chính", "Slot 2 · Sub-DPS / Hỗ trợ", "Slot 3 · Support / Healer"];

async function load() {
  chars = await api("/api/resonators");
  byId = Object.fromEntries(chars.map(c => [c.id, c]));
  teams = await api("/api/teams");
  renderSlots();
  renderTeams();
  renderResonators();
  const b = document.getElementById("localBanner");
  b.textContent = "Bạn đang dùng dữ liệu đã chỉnh sửa trên trình duyệt này (người khác không thấy). Muốn cập nhật cho mọi người: bấm “Xuất data.js” rồi thay file static/data.js trong repo.";
  b.classList.toggle("hidden", !WuwaEngine.hasLocalEdits());
}

// ------------------------------------------------------------ slot editor
let focusSlot = null;   // giữ focus ở ô tìm sau khi thêm, để thêm liên tiếp nhiều nhân vật

function addToSlot(si, id) {
  if (id && !slots[si].includes(id)) {
    const last = slotTiers[si][slotTiers[si].length - 1];
    slots[si].push(id);
    slotTiers[si].push(last || "S");      // mặc định cùng bậc với nhân vật liền trước => không bị trừ điểm
  }
  focusSlot = si;
  renderSlots();
}

function wireSlotSearch(inp) {
  const si = Number(inp.dataset.add);
  const list = inp.parentElement.querySelector(".slot-results");
  let active = 0, shown = [];

  const draw = () => {
    const q = inp.value.trim().toLowerCase();
    shown = chars.filter(c => !slots[si].includes(c.id) &&
      (!q || c.name.toLowerCase().includes(q) || c.element.toLowerCase().includes(q) ||
        (ROLE_TAG[c.role] || "").toLowerCase().includes(q)));
    active = Math.min(active, Math.max(shown.length - 1, 0));
    list.innerHTML = shown.length ? shown.map((c, i) => `
      <div class="slot-result ${i === active ? "active" : ""}" data-id="${c.id}">
        ${faceHTML(c, { size: "sm" })}
        <span class="grow">${esc(c.name)}</span>
        <small>${esc(c.element)} · ${esc(ROLE_TAG[c.role] || c.role)}</small>
      </div>`).join("") : '<div class="slot-empty">Không tìm thấy nhân vật nào</div>';
    list.classList.remove("hidden");
    const el = list.querySelector(".slot-result.active");
    if (el) el.scrollIntoView({ block: "nearest" });
  };

  inp.addEventListener("focus", () => { active = 0; draw(); });
  inp.addEventListener("input", () => { active = 0; draw(); });
  inp.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, shown.length - 1); draw(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); draw(); }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[active]) addToSlot(si, shown[active].id); }
    else if (e.key === "Escape") { list.classList.add("hidden"); inp.blur(); }
  });
  // mousedown (không phải click) để chọn được trước khi ô tìm mất focus
  list.addEventListener("mousedown", e => {
    const row = e.target.closest(".slot-result");
    if (!row) return;
    e.preventDefault();
    addToSlot(si, Number(row.dataset.id));
  });
  inp.addEventListener("blur", () => setTimeout(() => list.classList.add("hidden"), 120));
}

// ------------------------------------------------------------ cặp chuẩn (3 ô, được để trống 1 ô)
const inSlots = id => slots.some(s => s.includes(id));
// các nhân vật đứng chung đội hình được khi xếp được mỗi người vào 1 slot KHÁC NHAU
function canSeat(ids, k = 0, used = new Set()) {
  if (k === ids.length) return true;
  for (let i = 0; i < slots.length; i++) {
    if (used.has(i) || !slots[i].includes(ids[k])) continue;
    used.add(i);
    const ok = canSeat(ids, k + 1, used);
    used.delete(i);
    if (ok) return true;
  }
  return false;
}
const pairIds = p => p.filter(Boolean);
const pairOk = p => { const ids = pairIds(p); return ids.length >= 2 && new Set(ids).size === ids.length && canSeat(ids); };
function prunePairs() {
  pairs = pairs.map(p => p.map(id => (id && inSlots(id) ? id : 0)));   // nhân vật bị xóa khỏi team -> ô đó thành trống
}
function pairBadge(id) {
  const partners = pairs.filter(p => p.includes(id) && pairOk(p))
    .map(p => pairIds(p).filter(x => x !== id).map(x => byId[x]?.name).filter(Boolean).join(" + ")).filter(Boolean);
  return partners.length ? ` <span class="pair-badge" title="Đi cùng ${esc(partners.join(" / "))} thì được nâng 1 bậc">🔗 ${esc(partners.join(" / "))}</span>` : "";
}
function renderPairs() {
  const box = document.getElementById("pairsBox");
  const teamIds = [...new Set(slots.flat())];
  const opt = (sel, others) => `<option value="">— trống —</option>` +
    teamIds.filter(id => id === sel || !others.includes(id)).map(id => `<option value="${id}" ${id === sel ? "selected" : ""}>${esc(byId[id]?.name || "?")} (slot ${slots.map((s, i) => s.includes(id) ? i + 1 : 0).filter(Boolean).join("/")})</option>`).join("");
  box.innerHTML = `
    <div class="pairs-head"><b>🔗 Cặp chuẩn</b>
      <span class="hint">Mỗi cặp có <b>3 ô</b>, được để trống 1 ô (tối thiểu 2 nhân vật). Khi <b>tất cả nhân vật trong cặp</b> cùng có mặt trong đội hình thì <b>mỗi người được nâng 1 bậc</b> (A→S, B→A…; đã S thì vẫn S). Đứng riêng thì giữ nguyên bậc đã chọn ở trên.</span></div>
    ${pairs.length ? pairs.map((p, i) => {
      const n = pairIds(p).length;
      const bad = n >= 2 && !pairOk(p);
      const few = n < 2;
      return `<div class="pair-row ${bad || few ? "bad" : ""}">
        ${[0, 1, 2].map(k => `${k ? '<span class="pair-link">🔗</span>' : ""}<select data-pair="${i}" data-side="${k}">${opt(p[k], p.filter((_, j) => j !== k))}</select>`).join("")}
        <button type="button" class="danger" data-pair-del="${i}">✕</button>
        ${bad ? '<span class="hint">Các nhân vật này không xếp được vào các slot khác nhau nên không đứng chung đội hình được</span>'
          : few ? '<span class="hint">Cần chọn ít nhất 2 nhân vật (cặp thiếu sẽ không được lưu)</span>' : ""}
      </div>`;
    }).join("") : '<div class="hint">Chưa có cặp nào.</div>'}
    <button type="button" class="small ghost" id="addPair" ${teamIds.length < 2 ? "disabled" : ""}>＋ Thêm cặp</button>`;
  box.querySelectorAll("select[data-pair]").forEach(sel => sel.addEventListener("change", () => {
    pairs[+sel.dataset.pair][+sel.dataset.side] = Number(sel.value) || 0;
    renderSlots();
  }));
  box.querySelectorAll("button[data-pair-del]").forEach(b => b.addEventListener("click", () => {
    pairs.splice(+b.dataset.pairDel, 1);
    renderSlots();
  }));
  box.querySelector("#addPair").addEventListener("click", () => { pairs.push([0, 0, 0]); renderSlots(); });
}

function renderSlots() {
  const box = document.getElementById("slots");
  box.innerHTML = slots.map((ids, si) => `
    <div class="slot-box">
      <h4>${SLOT_TITLES[si]}</h4>
      <div class="slot-chips">
        ${ids.length ? ids.map((id, k) => `
          <div class="slot-chip">
            ${faceHTML(byId[id], { size: "sm" })}
            <span class="grow">${esc(byId[id]?.name || "?")}${pairBadge(id)}</span>
            <select class="chip-tier t-${slotTiers[si][k] || "S"}" data-tier data-s="${si}" data-k="${k}" title="Bậc của nhân vật này trong slot (hạ 1 bậc = trừ 0.5 điểm)">
              ${TIER_LIST.map(t => `<option value="${t}" ${t === (slotTiers[si][k] || "S") ? "selected" : ""}>${t}</option>`).join("")}
            </select>
            <button type="button" class="danger" data-act="del" data-s="${si}" data-k="${k}">✕</button>
          </div>`).join("") : '<span class="hint">Chưa chọn nhân vật nào</span>'}
      </div>
      <div class="slot-add">
        <input type="search" data-add="${si}" placeholder="🔍 Thêm nhân vật… (gõ tên để tìm)" autocomplete="off">
        <div class="slot-results hidden" data-results="${si}"></div>
      </div>
    </div>`).join("");

  box.querySelectorAll("input[data-add]").forEach(inp => wireSlotSearch(inp));
  if (focusSlot !== null) {
    const inp = box.querySelector(`input[data-add="${focusSlot}"]`);
    focusSlot = null;
    if (inp) inp.focus();
  }
  box.querySelectorAll("button[data-act]").forEach(btn => btn.addEventListener("click", () => {
    const si = Number(btn.dataset.s), k = Number(btn.dataset.k);
    if (btn.dataset.act === "del") { slots[si].splice(k, 1); slotTiers[si].splice(k, 1); prunePairs(); }
    renderSlots();
  }));
  box.querySelectorAll("select[data-tier]").forEach(sel => sel.addEventListener("change", () => {
    const si = Number(sel.dataset.s), k = Number(sel.dataset.k);
    slotTiers[si][k] = sel.value;
    sortSlot(si);
    renderSlots();
  }));
  renderPairs();
}

// ------------------------------------------------------------ team form
document.getElementById("score").addEventListener("input", () => { scoreTouched = true; });

function syncKind() {
  document.querySelectorAll("#kindSeg button").forEach(b => b.classList.toggle("active", b.dataset.kind === teamKind));
}
document.querySelectorAll("#kindSeg button").forEach(b => b.addEventListener("click", () => { teamKind = b.dataset.kind; syncKind(); }));

function resetForm() {
  editing = null;
  teamKind = "meta";
  syncKind();
  scoreTouched = false;
  slots = [[], [], []];
  slotTiers = [[], [], []];
  pairs = [];
  document.getElementById("teamForm").reset();
  document.getElementById("formTitle").textContent = "Thêm team";
  document.getElementById("saveBtn").textContent = "Thêm team";
  document.getElementById("cancelEdit").classList.add("hidden");
  renderSlots();
}

document.getElementById("teamForm").addEventListener("submit", async e => {
  e.preventDefault();
  const body = {
    name: document.getElementById("teamName").value,
    slots,
    tiers: slotTiers,
    pairs: pairs.filter(pairOk).map(pairIds),
    score: document.getElementById("score").value,
    kind: teamKind,
    team_type: document.getElementById("teamType").value,
    notes: document.getElementById("notes").value,
  };
  try {
    if (editing) await api(`/api/teams/${editing}`, "PUT", body);
    else await api("/api/teams", "POST", body);
    toast(editing ? "Đã lưu thay đổi" : "Đã thêm team");
    resetForm();
    await load();
  } catch (err) { toast(err.message, true); }
});
document.getElementById("cancelEdit").addEventListener("click", resetForm);

function editTeam(id) {
  const t = teams.find(x => x.id === id);
  if (!t) return;
  editing = id;
  teamKind = t.kind === "alt" ? "alt" : "meta";
  syncKind();
  scoreTouched = true;
  slots = t.slots.map(s => [...s]);
  // team cũ chưa có tiers: suy ra từ vị trí (1→S, 2→A, 3→B, 4+→C) để điểm không đổi
  slotTiers = t.slots.map((s, si) => s.map((_, k) => (t.tiers && t.tiers[si] && t.tiers[si][k]) || TIER_LIST[Math.min(k, 3)]));
  pairs = (t.pairs || []).map(p => [p[0] || 0, p[1] || 0, p[2] || 0]);
  document.getElementById("teamName").value = t.name || "";
  document.getElementById("score").value = t.score;
  document.getElementById("teamType").value = t.team_type || "";
  document.getElementById("notes").value = t.notes || "";
  document.getElementById("formTitle").textContent = `Sửa team: ${t.name || "#" + t.id}`;
  document.getElementById("saveBtn").textContent = "Lưu thay đổi";
  document.getElementById("cancelEdit").classList.remove("hidden");
  renderSlots();
  setCollapsed("formPanel", false);
  const fp = document.getElementById("formPanel");
  if (document.body.classList.contains("layout-pro") && fp.scrollHeight > fp.clientHeight) fp.scrollTo({ top: 0, behavior: "smooth" });
  else if (!document.body.classList.contains("layout-pro")) fp.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteTeam(id) {
  const t = teams.find(x => x.id === id);
  if (!confirm(`Xóa team "${t?.name || "này"}"?`)) return;
  try { await api(`/api/teams/${id}`, "DELETE"); toast("Đã xóa"); await load(); }
  catch (err) { toast(err.message, true); }
}

async function duplicateTeam(id) {
  const t = teams.find(x => x.id === id);
  if (!t) return;
  try {
    await api("/api/teams", "POST", {
      name: (t.name ? t.name + " " : "") + "(bản sao)",
      slots: t.slots, tiers: t.tiers, pairs: t.pairs || [],
      score: t.score, kind: t.kind === "alt" ? "alt" : "meta",
      team_type: t.team_type || "", notes: t.notes || "",
    });
    toast("Đã nhân bản team");
    await load();
  } catch (err) { toast(err.message, true); }
}

async function toggleActive(id, on) {
  try { await api(`/api/teams/${id}/active`, "POST", { active: on }); await load(); }
  catch (err) { toast(err.message, true); }
}

// ------------------------------------------------------------ team table
function renderTeams() {
  const q = document.getElementById("teamSearch").value.trim().toLowerCase();
  const list = teams.filter(t => {
    if (!q) return true;
    const names = t.slots.flat().map(i => byId[i]?.name || "").join(" ").toLowerCase();
    return (t.name || "").toLowerCase().includes(q) || names.includes(q);
  });
  document.getElementById("teamCount").textContent = `(${list.length}/${teams.length})`;
  const rows = l => l.map(t => `<tr class="${t.active ? "" : "off"}">
        <td><input type="checkbox" ${t.active ? "checked" : ""} data-act="${t.id}"></td>
        <td><b>${esc(t.name || "—")}</b><div class="src">${esc(t.team_type || "")}${t.notes ? " · " + esc(t.notes) : ""}
            ${t.source === "prydwen" ? " · Prydwen" : ""}</div></td>
        <td><div class="mini-faces">${t.slots.map(s =>
            `<span class="mini-slot">${s.map(i => faceHTML(byId[i], { size: "sm" })).join("")}</span>`).join("")}</div></td>
        <td><b>${fmtScore(t.score)}</b></td>
        <td><div class="row-actions">
          <button class="small" data-edit="${t.id}">Sửa</button>
          <button class="small" data-kind="${t.id}" data-to="${t.kind === "alt" ? "meta" : "alt"}" title="Chuyển sang ${t.kind === "alt" ? "Meta" : "Alternative"}">${t.kind === "alt" ? "→ Meta" : "→ Alt"}</button>
          <button class="small" data-dup="${t.id}" title="Nhân bản team này (giữ nguyên dạng, slot, bậc, cặp chuẩn, điểm)">⧉ Nhân bản</button>
          <button class="small danger" data-del="${t.id}">Xóa</button></div></td>
      </tr>`).join("");
  const table = (l, emptyMsg) => l.length ? `<table>
      <thead><tr><th>Dùng</th><th>Team</th><th>Thành phần (slot 1 · 2 · 3)</th><th>Điểm</th><th></th></tr></thead>
      <tbody>${rows(l)}</tbody></table>` : `<p class="hint">${emptyMsg}</p>`;
  const metaL = list.filter(t => t.kind !== "alt"), altL = list.filter(t => t.kind === "alt");
  document.getElementById("metaCount").textContent = `(${metaL.length})`;
  document.getElementById("altCount").textContent = `(${altL.length})`;
  document.getElementById("metaTable").innerHTML = table(metaL, "Chưa có team nào ở nhóm này.");
  document.getElementById("altTable").innerHTML = table(altL, "Chưa có team nào ở nhóm này.");
  for (const tb of [document.getElementById("metaTable"), document.getElementById("altTable")]) {
    tb.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => editTeam(Number(b.dataset.edit))));
    tb.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => deleteTeam(Number(b.dataset.del))));
    tb.querySelectorAll("[data-act]").forEach(b => b.addEventListener("change", () => toggleActive(Number(b.dataset.act), b.checked)));
    tb.querySelectorAll("[data-dup]").forEach(b => b.addEventListener("click", () => duplicateTeam(Number(b.dataset.dup))));
    tb.querySelectorAll("[data-kind]").forEach(b => b.addEventListener("click", async () => {
      try { await api(`/api/teams/${b.dataset.kind}/kind`, "POST", { kind: b.dataset.to }); await load(); }
      catch (err) { toast(err.message, true); }
    }));
  }
}
document.getElementById("teamSearch").addEventListener("input", renderTeams);

// ------------------------------------------------------------ backup / reseed
document.getElementById("exportBtn").addEventListener("click", async () => {
  const data = await api("/api/export");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "wuwa_teams_backup.json";
  a.click();
  URL.revokeObjectURL(a.href);
});
function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
document.getElementById("exportJsBtn").addEventListener("click", () => {
  download("data.js", WuwaEngine.exportDataJs(), "text/javascript");
  toast("Đã tải data.js — thay file static/data.js trong repo rồi commit để cập nhật cho mọi người");
});
document.getElementById("resetLocalBtn").addEventListener("click", async () => {
  if (!confirm("Bỏ toàn bộ chỉnh sửa trên trình duyệt này và quay về dữ liệu gốc của site?")) return;
  WuwaEngine.resetLocalEdits();
  toast("Đã quay về dữ liệu gốc");
  await load();
});
document.getElementById("importBtn").addEventListener("click", () => document.getElementById("importFile").click());
document.getElementById("importFile").addEventListener("change", async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const r = await api("/api/import", "POST", data);
    toast(`Đã nhập ${r.added} team (bỏ qua ${r.skipped})`);
    await load();
  } catch (err) { toast("File không hợp lệ: " + err.message, true); }
  e.target.value = "";
});
document.getElementById("reseedBtn").addEventListener("click", async () => {
  if (!confirm("Xóa toàn bộ team nguồn Prydwen (kể cả bản bạn đã sửa) và nạp lại bản gốc? Team bạn tự thêm sẽ được giữ nguyên.")) return;
  try { const r = await api("/api/teams/reseed-prydwen", "POST", {}); toast(`Đã nạp lại ${r.count} team`); await load(); }
  catch (err) { toast(err.message, true); }
});

// ------------------------------------------------------------ resonators
function renderResonators() {
  document.getElementById("resCount").textContent = `(${chars.length})`;
  document.getElementById("resTable").innerHTML = `
    <table>
      <thead><tr><th></th><th>Tên</th><th>Độ hiếm</th><th>Nguyên tố</th><th>Trạng thái</th><th>Potential</th><th>Vai trò</th><th>Ngày ra mắt</th><th>Slug ảnh</th><th></th></tr></thead>
      <tbody>
      ${chars.map(c => `<tr class="res-row">
        <td>${faceHTML(c, { size: "sm" })}</td>
        <td><b>${esc(c.name)}</b></td>
        <td><select data-f="rarity" data-id="${c.id}"><option ${c.rarity === "5★" ? "selected" : ""}>5★</option><option ${c.rarity === "4★" ? "selected" : ""}>4★</option></select></td>
        <td><select data-f="element" data-id="${c.id}">${ELEMENTS.map(e => `<option ${c.element === e ? "selected" : ""}>${e}</option>`).join("")}</select></td>
        <td><select data-f="status" data-id="${c.id}" class="st-sel st-${c.status}">${STATUS_ORDER.map(k => `<option value="${k}" ${c.status === k ? "selected" : ""}>${STATUS_META[k].label}</option>`).join("")}</select></td>
        <td><select data-f="potential" data-id="${c.id}" class="${c.potential ? potCls(c.potential) : "pot P0"}"><option value="" ${c.potential ? "" : "selected"}>— chưa chấm (0)</option>${POTENTIALS.map(p => `<option value="${p}" ${c.potential === p ? "selected" : ""}>${p} (${fmtSigned(POTENTIAL_POINTS[p])})</option>`).join("")}</select></td>
        <td><select data-f="role" data-id="${c.id}">${ROLES.map(r => `<option value="${r}" ${c.role === r ? "selected" : ""}>${ROLE_TAG[r]}</option>`).join("")}</select></td>
        <td><input type="text" inputmode="numeric" maxlength="10" placeholder="dd/mm/yyyy" autocomplete="off" data-f="date" data-id="${c.id}" value="${esc(dateToText(c.date))}" style="padding:4px 8px;width:120px"></td>
        <td><span class="src">${esc(c.slug)}</span></td>
        <td><button class="small danger" data-del="${c.id}">Xóa</button></td>
      </tr>`).join("")}
      </tbody>
    </table>`;
  const tb = document.getElementById("resTable");
  tb.querySelectorAll('input[data-f="date"]').forEach(inp => {
    attachDateMask(inp);
    inp.addEventListener("keydown", e => { if (e.key === "Enter") inp.blur(); });
  });
  tb.querySelectorAll("select[data-f], input[data-f]").forEach(sel => sel.addEventListener("change", async () => {
    try {
      let val = sel.value;
      if (sel.dataset.f === "date") {
        val = parseDateText(sel.value);
        if (val === null) { toast("Ngày không hợp lệ — nhập dạng dd/mm/yyyy", true); sel.value = dateToText((byId[Number(sel.dataset.id)] || {}).date); return; }
      }
      await api(`/api/resonators/${sel.dataset.id}`, "PUT", { [sel.dataset.f]: val });
      toast("Đã cập nhật");
      await load();
    } catch (err) { toast(err.message, true); }
  }));
  tb.querySelectorAll("button[data-del]").forEach(b => b.addEventListener("click", async () => {
    const c = byId[Number(b.dataset.del)];
    if (!confirm(`Xóa "${c.name}"?`)) return;
    try { await api(`/api/resonators/${c.id}`, "DELETE"); toast("Đã xóa"); await load(); }
    catch (err) { toast(err.message, true); }
  }));
}

document.getElementById("resForm").addEventListener("submit", async e => {
  e.preventDefault();
  const dateVal = parseDateText(document.getElementById("resDate").value);
  if (dateVal === null) { toast("Ngày không hợp lệ — nhập dạng dd/mm/yyyy", true); return; }
  try {
    await api("/api/resonators", "POST", {
      name: document.getElementById("resName").value,
      rarity: document.getElementById("resRarity").value,
      element: document.getElementById("resElement").value,
      status: document.getElementById("resStatus").value,
      potential: document.getElementById("resPotential").value,
      role: document.getElementById("resRole").value,
      date: dateVal,
    });
    e.target.reset();
    toast("Đã thêm Resonator");
    await load();
  } catch (err) { toast(err.message, true); }
});

attachDateMask(document.getElementById("resDate"));
document.getElementById("resElement").innerHTML = ELEMENTS.map(e => `<option>${e}</option>`).join("");
document.getElementById("resStatus").innerHTML = STATUS_ORDER.map(k => `<option value="${k}">${STATUS_META[k].label}</option>`).join("");
document.getElementById("resPotential").innerHTML = '<option value="">Potential: chưa chấm (0)</option>' +
  POTENTIALS.map(p => `<option value="${p}">Potential ${p} (${fmtSigned(POTENTIAL_POINTS[p])})</option>`).join("");
document.getElementById("potLegend").innerHTML = potLegendHTML();
// ------------------------------------------------------------ thu gọn panel (+/−) & chế độ Pro
const COLLAPSE_KEY = "wuwa.admin.collapsed", LAYOUT_KEY = "wuwa.admin.layout";
const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const collapsedState = readJSON(COLLAPSE_KEY, {});
function setCollapsed(id, on) {
  const p = document.getElementById(id);
  if (!p) return;
  p.classList.toggle("collapsed", on);
  const b = p.querySelector(":scope > .panel-head > .collapse-btn");
  if (b) { b.textContent = on ? "+" : "−"; b.title = on ? "Mở rộng panel" : "Thu nhỏ panel"; b.setAttribute("aria-expanded", String(!on)); }
  collapsedState[id] = on;
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsedState)); } catch (e) { /* bỏ qua */ }
}
document.querySelectorAll("main .panel[id]").forEach(p => {
  const head = p.querySelector(":scope > .panel-head");
  if (!head) return;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "collapse-btn";
  b.addEventListener("click", () => setCollapsed(p.id, !p.classList.contains("collapsed")));
  head.insertBefore(b, head.firstChild);
  setCollapsed(p.id, !!collapsedState[p.id]);
});

function setLayout(mode) {
  const pro = mode === "pro";
  document.body.classList.toggle("layout-pro", pro);
  document.querySelectorAll("#layoutSeg button").forEach(b => b.classList.toggle("active", b.dataset.layout === (pro ? "pro" : "default")));
  try { localStorage.setItem(LAYOUT_KEY, pro ? "pro" : "default"); } catch (e) { /* bỏ qua */ }
}
document.querySelectorAll("#layoutSeg button").forEach(b => b.addEventListener("click", () => setLayout(b.dataset.layout)));
try { setLayout(localStorage.getItem(LAYOUT_KEY) === "pro" ? "pro" : "default"); } catch (e) { setLayout("default"); }

// ------------------------------------------------------------ kéo thả đổi kích thước
// Chỉ còn vệt dưới panel Thêm team: kéo để đổi chiều cao, bấm đúp để về tự động.
// (Các panel bên phải dùng nút +/− để thu gọn; thanh kéo độ rộng giữa 2 cột đã bỏ.)
const SIZE_KEY = "wuwa.admin.sizes";
const sizes = readJSON(SIZE_KEY, {});
const saveSizes = () => { try { localStorage.setItem(SIZE_KEY, JSON.stringify(sizes)); } catch (e) { /* bỏ qua */ } };
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function applyHeight(group, h) {                      // group: "right" | "form"; h = null -> tự động
  const ids = ["formPanel"];
  ids.forEach(id => {
    const p = document.getElementById(id);
    if (!p) return;
    p.classList.toggle("sized", h !== null);
    if (h !== null) p.style.setProperty("--sz-h", h + "px"); else p.style.removeProperty("--sz-h");
  });
  if (h === null) delete sizes[group]; else sizes[group] = Math.round(h);
  saveSizes();
}

function dragStart(e, axis, onMove, onDone, el) {
  e.preventDefault();
  el.setPointerCapture(e.pointerId);
  el.classList.add("dragging");
  document.body.classList.add("resizing", axis === "v" ? "rz-v" : "rz-h");
  const move = ev => onMove(ev);
  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    el.classList.remove("dragging");
    document.body.classList.remove("resizing", "rz-v", "rz-h");
    if (onDone) onDone();
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}

[["formPanel", "form"]].forEach(([id, group]) => {
  const p = document.getElementById(id);
  if (!p) return;
  const grip = document.createElement("div");
  grip.className = "panel-grip";
  grip.title = "Kéo để đổi chiều cao · bấm đúp để về tự động";
  grip.classList.add("inside"); p.appendChild(grip);   // nằm trong panel (dính đáy) để không phá lưới 2 cột
  grip.addEventListener("pointerdown", e => {
    const y0 = e.clientY, h0 = p.getBoundingClientRect().height;
    dragStart(e, "v", ev => applyHeight(group, clamp(h0 + ev.clientY - y0, 120, 2400)), null, grip);
  });
  grip.addEventListener("dblclick", () => applyHeight(group, null));
});
if (sizes.form > 0) applyHeight("form", sizes.form);
// dọn kích thước cũ của các thanh kéo đã bỏ
if ("right" in sizes || "leftW" in sizes) { delete sizes.right; delete sizes.leftW; saveSizes(); }

load();
