// Nút "Cập nhật" trên thanh trên cùng: đọc patch.json, hiện dấu chấm đỏ nếu có patch mới chưa đọc.
// Định dạng patch.json: { "patches": [ { "version": "1.1.0", "date": "2026-10-05 21:00", "content": ["dòng 1", "dòng 2"] } ] }
// (content có thể là 1 chuỗi hoặc danh sách chuỗi; patch mới nhất nằm đầu danh sách)
(function () {
  const SEEN_KEY = "wuwa.patch.seen";
  const btn = document.getElementById("patchBtn");
  if (!btn) return;
  const dot = btn.querySelector(".dot");
  let patches = [];
  let loadErr = false;

  const keyOf = p => `${p.version}|${p.date}`;
  const getSeen = () => { try { return localStorage.getItem(SEEN_KEY) || ""; } catch (e) { return ""; } };
  const setSeen = v => { try { localStorage.setItem(SEEN_KEY, v); } catch (e) { /* bỏ qua */ } };

  // "2026-10-05 21:00" -> "21:00 · 05/10/2026" (không có giờ thì chỉ hiện ngày)
  function fmtWhen(s) {
    const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    if (!m) return String(s || "");
    const d = `${m[3]}/${m[2]}/${m[1]}`;
    return m[4] ? `${m[4]}:${m[5]} · ${d}` : d;
  }
  const lines = c => (Array.isArray(c) ? c : String(c || "").split(/\r?\n/)).map(x => String(x).trim()).filter(Boolean);

  function refreshDot() {
    const latest = patches[0];
    dot.classList.toggle("hidden", !latest || keyOf(latest) === getSeen());
  }

  function openModal() {
    document.getElementById("patchModal")?.remove();
    const ov = document.createElement("div");
    ov.id = "patchModal"; ov.className = "exp-overlay";
    const body = loadErr
      ? '<p class="hint">Không tải được <b>patch.json</b>. Hãy mở trang qua link web (GitHub Pages) thay vì mở trực tiếp file.</p>'
      : !patches.length ? '<p class="hint">Chưa có thông tin cập nhật.</p>'
      : patches.map((p, i) => `<div class="patch-item ${i === 0 ? "latest" : ""}">
          <div class="patch-head"><span class="patch-ver">v${esc(p.version)}</span>${i === 0 ? '<span class="patch-new">Mới nhất</span>' : ""}
            <span class="patch-date">${esc(fmtWhen(p.date))}</span></div>
          <ul>${lines(p.content).map(l => `<li>${esc(l)}</li>`).join("")}</ul>
        </div>`).join("");
    ov.innerHTML = `<div class="exp-box patch-box">
      <div class="exp-note"><b>📢 Cập nhật</b><button class="small ghost" id="patchClose">Đóng ✕</button></div>
      <div class="patch-list">${body}</div></div>`;
    document.body.appendChild(ov);
    const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = e => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    ov.querySelector("#patchClose").addEventListener("click", close);
    ov.addEventListener("click", e => { if (e.target === ov) close(); });
    // mở xem = đã đọc
    if (patches[0]) setSeen(keyOf(patches[0]));
    refreshDot();
  }

  btn.addEventListener("click", openModal);

  fetch("patch.json", { cache: "no-store" })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(d => {
      patches = (Array.isArray(d) ? d : d.patches || [])
        .filter(p => p && p.version)
        .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));   // mới nhất lên đầu
      refreshDot();
    })
    .catch(() => { loadErr = true; });
})();
