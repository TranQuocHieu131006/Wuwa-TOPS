// Tiện ích dùng chung cho trang chính và trang admin
const ELEMENTS = ["Aero", "Electro", "Fusion", "Glacio", "Havoc", "Spectro"];
const EL_COLOR = {
  Aero: "#4be3b0", Electro: "#b66dff", Fusion: "#ff7a4d",
  Glacio: "#4cb8ff", Havoc: "#ec4f9c", Spectro: "#f3e05a",
};
const ROLE_LABELS = ["DPS", "Sub-DPS", "Support"];
// vai trò của Resonator (lưu trong data: DPS / supDPS / Healer)
const ROLES = ["DPS", "supDPS", "Healer"];
const ROLE_TAG = { DPS: "DPS", supDPS: "Sub-DPS", Healer: "Healer" };

// Trạng thái banner của Resonator (màu: vàng = sắp ra, bạc = đang debut, xanh lá = đang rerun, đỏ = limited)
const STATUS_ORDER = ["available", "upcoming", "debut", "rerun", "soon", "limited", "norerun"];
const STATUS_META = {
  available: { label: "Đã ra mắt",       tag: "",            color: "#8d9ab8" },
  upcoming:  { label: "Sắp ra mắt",      tag: "Sắp ra",     color: "#f3c76b" },
  debut:     { label: "Debut",           tag: "Debut",      color: "#5fd9a0" },
  rerun:     { label: "Rerun",      tag: "Rerun",  color: "#5fd9a0" },
  soon:      { label: "Incoming",       tag: "Incoming",   color: "#ffa24d" },
  limited:   { label: "Đã limited",      tag: "LIMITED",     color: "#ff6b7a" },
  norerun:   { label: "Không rerun nữa", tag: "KHÔNG RERUN", color: "#c0394b" },
};
function statusTag(st) {
  const m = STATUS_META[st];
  return m && m.tag ? `<span class="st-tag st-${st}" title="${esc(m.label)}">${esc(m.tag)}</span>` : "";
}

// Potential: điểm cộng/trừ vào điểm pull (giá trị thật nằm ở engine.js -> POTENTIAL_POINTS)
const POTENTIALS = ["S+", "S", "A", "B", "C", "D", "E", "F"];
const potCls = p => "pot P" + String(p).replace("+", "p");
const fmtSigned = n => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n);
function potBadge(p) {
  return p ? `<span class="${potCls(p)}">${esc(p)} (${fmtSigned(POTENTIAL_POINTS[p])})</span>`
           : '<span class="pot P0">chưa chấm (0)</span>';
}
function potLegendHTML() {
  return `<div class="pot-legend"><b>Potential → điểm pull:</b>
    ${POTENTIALS.map(p => `<span class="${potCls(p)}">${esc(p)} = ${fmtSigned(POTENTIAL_POINTS[p])}</span>`).join("")}
    <span class="pot P0">chưa chấm = 0</span>
    <div class="hint">Điểm pull = mức tăng tổng điểm team khi có thêm nhân vật đó + điểm Potential. Potential là đánh giá tiềm năng của riêng bạn, chấm trong Admin → bảng Resonator; chỉ ảnh hưởng gợi ý “Nên pull ai?”, không ảnh hưởng việc xếp team.</div>
  </div>`;
}

// Ngày nhập tay: gõ dd/mm/yyyy (hoặc yyyy-mm-dd) -> "YYYY-MM-DD"; rỗng -> ""; sai -> null
function parseDateText(v) {
  v = String(v || "").trim();
  if (!v) return "";
  let d, m, y, x;
  if ((x = v.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/))) { y = +x[1]; m = +x[2]; d = +x[3]; }
  else if ((x = v.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/))) { d = +x[1]; m = +x[2]; y = +x[3]; }
  else return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const dateToText = iso => (iso ? iso.split("-").reverse().join("/") : "");
// tự chèn dấu "/" khi gõ số: 25122024 -> 25/12/2024
function attachDateMask(inp) {
  inp.addEventListener("input", () => {
    if (inp.value.includes("-")) return;                       // đang gõ kiểu yyyy-mm-dd -> để nguyên
    const dg = inp.value.replace(/\D/g, "").slice(0, 8);
    inp.value = dg.length > 4 ? `${dg.slice(0, 2)}/${dg.slice(2, 4)}/${dg.slice(4)}`
              : dg.length > 2 ? `${dg.slice(0, 2)}/${dg.slice(2)}` : dg;
  });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function initialsSvg(name, color) {
  const ini = (name || "?").replace(/[()]/g, "").split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity=".55"/><stop offset="1" stop-color="#0b0f1b"/>
    </linearGradient></defs>
    <rect width="64" height="64" fill="url(#g)"/>
    <text x="32" y="40" text-anchor="middle" font-family="Arial" font-weight="800" font-size="24" fill="#fff">${esc(ini)}</text>
  </svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

// chuỗi fallback: ảnh local -> CDN -> chữ cái đầu
function faceErr(img) {
  if (!img.dataset.tried && img.dataset.remote && img.src !== img.dataset.remote) {
    img.dataset.tried = "1";
    img.src = img.dataset.remote;
  } else {
    img.onerror = null;
    const face = img.closest(".face");
    if (face && face.classList.contains("dark")) {
      face.classList.add("noimg");   // nhân vật chưa có + không có ảnh: chỉ hiện ô tối với dấu "?"
    } else {
      img.src = initialsSvg(img.dataset.name, img.dataset.color);
    }
  }
}

// opts: {size: 'sm'|'md'|'lg', dark, busy, off}
function faceHTML(r, opts = {}) {
  if (!r) return `<span class="face ${opts.size || "md"} dark"></span>`;
  const color = EL_COLOR[r.element] || "#5b8cff";
  const cls = ["face", opts.size || "md", "el-" + r.element, r.rarity === "5★" ? "r5" : "r4"];
  if (opts.dark) cls.push("dark");
  if (opts.busy) cls.push("busy");
  if (opts.off) cls.push("off");
  return `<span class="${cls.join(" ")}" title="${esc(r.name)}">
    <img src="${esc(r.img)}" data-remote="${esc(r.remote)}" data-name="${esc(r.name)}" data-color="${color}"
         loading="lazy" alt="${esc(r.name)}" onerror="faceErr(this)"></span>`;
}

function tierClass(t) {
  return "T" + String(t || "").replace(/^T/, "").replace(".", "");
}

function tierBadge(t) {
  return t ? `<span class="tier ${tierClass(t)}">${esc(t)}</span>` : "";
}

let _toastTimer;
function toast(msg, isErr = false) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.className = "toast" + (isErr ? " err" : "");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}

// Không còn server: "API" chạy ngay trong trình duyệt (xem engine.js)
async function api(url, method = "GET", body) {
  return engineApi(url, method, body);
}
