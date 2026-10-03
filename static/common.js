// Tiện ích dùng chung cho trang chính và trang admin
const ELEMENTS = ["Aero", "Electro", "Fusion", "Glacio", "Havoc", "Spectro"];
const EL_COLOR = {
  Aero: "#4be3b0", Electro: "#b66dff", Fusion: "#ff7a4d",
  Glacio: "#4cb8ff", Havoc: "#ec4f9c", Spectro: "#f3e05a",
};
const ROLE_LABELS = ["DPS", "Sub-DPS", "Support"];

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
