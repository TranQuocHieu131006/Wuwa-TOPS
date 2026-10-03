// Cổng mật khẩu cho trang Admin.
// LƯU Ý: đây là web tĩnh nên mật khẩu chỉ là rào chắn nhẹ (ai đọc code đều thấy).
// Chỉnh sửa ở Admin chỉ lưu trong trình duyệt của người đó, không thay đổi dữ liệu của người khác.
(function () {
  const ADMIN_PASSWORD = "76767676";
  const KEY = "wuwa.admin.auth";
  const ok = () => { try { return sessionStorage.getItem(KEY) === "1"; } catch (e) { return false; } };
  const apply = () => {
    const authed = ok();
    document.body.classList.toggle("locked", !authed);
    document.getElementById("gate").classList.toggle("hidden", authed);
    document.getElementById("logoutLink").classList.toggle("hidden", !authed);
    if (!authed) document.getElementById("gatePw").focus();
  };
  document.getElementById("gateForm").addEventListener("submit", e => {
    e.preventDefault();
    if (document.getElementById("gatePw").value === ADMIN_PASSWORD) {
      try { sessionStorage.setItem(KEY, "1"); } catch (err) { /* bỏ qua */ }
      document.getElementById("gateErr").classList.add("hidden");
      apply();
    } else {
      document.getElementById("gateErr").classList.remove("hidden");
      document.getElementById("gatePw").value = "";
    }
  });
  document.getElementById("logoutLink").addEventListener("click", e => {
    e.preventDefault();
    try { sessionStorage.removeItem(KEY); } catch (err) { /* bỏ qua */ }
    apply();
  });
  apply();
})();
