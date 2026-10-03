let chars = [];
let byId = {};
let teams = [];
let slots = [[], [], []];
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
function renderSlots() {
  const box = document.getElementById("slots");
  box.innerHTML = slots.map((ids, si) => `
    <div class="slot-box">
      <h4>${SLOT_TITLES[si]}</h4>
      <div class="slot-chips">
        ${ids.length ? ids.map((id, k) => `
          <div class="slot-chip">
            <span class="ord">${k + 1}</span>${faceHTML(byId[id], { size: "sm" })}
            <span class="grow">${esc(byId[id]?.name || "?")}</span>
            ${k > 0 ? `<button type="button" title="Đẩy lên ưu tiên cao hơn" data-act="up" data-s="${si}" data-k="${k}">▲</button>` : ""}
            <button type="button" class="danger" data-act="del" data-s="${si}" data-k="${k}">✕</button>
          </div>`).join("") : '<span class="hint">Chưa chọn nhân vật nào</span>'}
      </div>
      <div class="slot-add">
        <select data-add="${si}">
          <option value="">+ Thêm nhân vật…</option>
          ${chars.map(c => `<option value="${c.id}">${esc(c.name)} (${c.element})</option>`).join("")}
        </select>
      </div>
    </div>`).join("");

  box.querySelectorAll("select[data-add]").forEach(sel => sel.addEventListener("change", () => {
    const si = Number(sel.dataset.add);
    const id = Number(sel.value);
    if (id && !slots[si].includes(id)) slots[si].push(id);
    renderSlots();
  }));
  box.querySelectorAll("button[data-act]").forEach(btn => btn.addEventListener("click", () => {
    const si = Number(btn.dataset.s), k = Number(btn.dataset.k);
    if (btn.dataset.act === "del") slots[si].splice(k, 1);
    else [slots[si][k - 1], slots[si][k]] = [slots[si][k], slots[si][k - 1]];
    renderSlots();
  }));
}

// ------------------------------------------------------------ team form
function fillTierSelects() {
  const opts = Object.keys(TIER_SCORE).map(t => `<option value="${t}">${t}</option>`).join("");
  document.getElementById("tier").insertAdjacentHTML("beforeend", opts);
  document.getElementById("tierFilter").insertAdjacentHTML("beforeend", opts);
}

document.getElementById("tier").addEventListener("change", e => {
  const t = e.target.value;
  const scoreEl = document.getElementById("score");
  if (t && TIER_SCORE[t] !== undefined && (!scoreEl.value || !scoreTouched)) {
    scoreEl.value = TIER_SCORE[t];
  }
});
document.getElementById("score").addEventListener("input", () => { scoreTouched = true; });

function resetForm() {
  editing = null;
  scoreTouched = false;
  slots = [[], [], []];
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
    score: document.getElementById("score").value,
    tier: document.getElementById("tier").value,
    patch: document.getElementById("patch").value,
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
  scoreTouched = true;
  slots = t.slots.map(s => [...s]);
  document.getElementById("teamName").value = t.name || "";
  document.getElementById("score").value = t.score;
  document.getElementById("tier").value = t.tier || "";
  document.getElementById("patch").value = t.patch || "";
  document.getElementById("teamType").value = t.team_type || "";
  document.getElementById("notes").value = t.notes || "";
  document.getElementById("formTitle").textContent = `Sửa team: ${t.name || "#" + t.id}`;
  document.getElementById("saveBtn").textContent = "Lưu thay đổi";
  document.getElementById("cancelEdit").classList.remove("hidden");
  renderSlots();
  document.getElementById("formPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteTeam(id) {
  const t = teams.find(x => x.id === id);
  if (!confirm(`Xóa team "${t?.name || "này"}"?`)) return;
  try { await api(`/api/teams/${id}`, "DELETE"); toast("Đã xóa"); await load(); }
  catch (err) { toast(err.message, true); }
}

async function toggleActive(id, on) {
  try { await api(`/api/teams/${id}/active`, "POST", { active: on }); await load(); }
  catch (err) { toast(err.message, true); }
}

// ------------------------------------------------------------ team table
function renderTeams() {
  const q = document.getElementById("teamSearch").value.trim().toLowerCase();
  const tf = document.getElementById("tierFilter").value;
  const list = teams.filter(t => {
    if (tf && t.tier !== tf) return false;
    if (!q) return true;
    const names = t.slots.flat().map(i => byId[i]?.name || "").join(" ").toLowerCase();
    return (t.name || "").toLowerCase().includes(q) || names.includes(q);
  });
  document.getElementById("teamCount").textContent = `(${list.length}/${teams.length})`;
  document.getElementById("teamTable").innerHTML = `
    <table>
      <thead><tr><th>Dùng</th><th>Team</th><th>Thành phần (slot 1 · 2 · 3)</th><th>Điểm</th><th>Tier</th><th>Patch</th><th></th></tr></thead>
      <tbody>
      ${list.map(t => `<tr class="${t.active ? "" : "off"}">
        <td><input type="checkbox" ${t.active ? "checked" : ""} data-act="${t.id}"></td>
        <td><b>${esc(t.name || "—")}</b><div class="src">${esc(t.team_type || "")}${t.notes ? " · " + esc(t.notes) : ""}
            ${t.source === "prydwen" ? " · Prydwen" : ""}</div></td>
        <td><div class="mini-faces">${t.slots.map(s =>
            `<span class="mini-slot">${s.map(i => faceHTML(byId[i], { size: "sm" })).join("")}</span>`).join("")}</div></td>
        <td><b>${Number(t.score).toFixed(1)}</b></td>
        <td>${tierBadge(t.tier) || "—"}</td>
        <td>${esc(t.patch || "—")}</td>
        <td><div class="row-actions">
          <button class="small" data-edit="${t.id}">Sửa</button>
          <button class="small danger" data-del="${t.id}">Xóa</button></div></td>
      </tr>`).join("")}
      </tbody>
    </table>`;
  const tb = document.getElementById("teamTable");
  tb.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => editTeam(Number(b.dataset.edit))));
  tb.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => deleteTeam(Number(b.dataset.del))));
  tb.querySelectorAll("[data-act]").forEach(b => b.addEventListener("change", () => toggleActive(Number(b.dataset.act), b.checked)));
}
document.getElementById("teamSearch").addEventListener("input", renderTeams);
document.getElementById("tierFilter").addEventListener("change", renderTeams);

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
      <thead><tr><th></th><th>Tên</th><th>Độ hiếm</th><th>Nguyên tố</th><th>Trạng thái</th><th>Slug ảnh</th><th></th></tr></thead>
      <tbody>
      ${chars.map(c => `<tr class="res-row">
        <td>${faceHTML(c, { size: "sm" })}</td>
        <td><b>${esc(c.name)}</b></td>
        <td><select data-f="rarity" data-id="${c.id}"><option ${c.rarity === "5★" ? "selected" : ""}>5★</option><option ${c.rarity === "4★" ? "selected" : ""}>4★</option></select></td>
        <td><select data-f="element" data-id="${c.id}">${ELEMENTS.map(e => `<option ${c.element === e ? "selected" : ""}>${e}</option>`).join("")}</select></td>
        <td><select data-f="released" data-id="${c.id}"><option value="1" ${c.released ? "selected" : ""}>Đã ra mắt</option><option value="0" ${c.released ? "" : "selected"}>Sắp ra mắt</option></select></td>
        <td><span class="src">${esc(c.slug)}</span></td>
        <td><button class="small danger" data-del="${c.id}">Xóa</button></td>
      </tr>`).join("")}
      </tbody>
    </table>`;
  const tb = document.getElementById("resTable");
  tb.querySelectorAll("select[data-f]").forEach(sel => sel.addEventListener("change", async () => {
    try {
      await api(`/api/resonators/${sel.dataset.id}`, "PUT", { [sel.dataset.f]: sel.value });
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
  try {
    await api("/api/resonators", "POST", {
      name: document.getElementById("resName").value,
      rarity: document.getElementById("resRarity").value,
      element: document.getElementById("resElement").value,
      released: document.getElementById("resReleased").value,
    });
    e.target.reset();
    toast("Đã thêm Resonator");
    await load();
  } catch (err) { toast(err.message, true); }
});

document.getElementById("resElement").innerHTML = ELEMENTS.map(e => `<option>${e}</option>`).join("");
fillTierSelects();
load();
