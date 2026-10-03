# WuWa Account Optimizer (bản web tĩnh)

Chọn Resonator đang có → xếp team tối ưu → biết nên pull ai tiếp theo (ToA / Matrix).
Không cần server hay cài đặt: mọi thứ chạy ngay trong trình duyệt.

## Đưa lên GitHub Pages (người xem chỉ cần bấm link)

1. Tạo repo mới trên GitHub, upload **toàn bộ file trong thư mục này** (giữ nguyên cấu trúc: `index.html`, `admin.html`, thư mục `static/`).
2. Vào **Settings → Pages** → mục *Build and deployment*: chọn **Deploy from a branch**, branch `main`, thư mục `/ (root)` → **Save**.
3. Đợi khoảng 1 phút, link sẽ là `https://<tên-github>.github.io/<tên-repo>/` — gửi link này cho mọi người.

Mở thử ở máy: bấm đúp `index.html` vẫn chạy (nhưng bộ giải nhanh HiGHS cần web server nên sẽ tự chuyển sang bộ giải dự phòng, chậm hơn một chút với roster rất lớn). Trên GitHub Pages thì dùng bộ giải nhanh.

## Admin (`admin.html`)

Mật khẩu: `76767676` (đổi trong `static/gate.js`).

Lưu ý: đây là web tĩnh nên mật khẩu chỉ là rào chắn nhẹ — ai đọc code đều thấy.
Chỉnh sửa trong Admin **chỉ lưu trên trình duyệt của người chỉnh**, người khác không bị ảnh hưởng.

Muốn cập nhật dữ liệu cho mọi người:
1. Vào Admin, sửa team / Resonator như bình thường.
2. Bấm **⬇ Xuất data.js (cập nhật site)**.
3. Thay file `static/data.js` trong repo bằng file vừa tải → commit. Vài phút sau site được cập nhật.

Nút **↺ Về dữ liệu gốc** bỏ mọi chỉnh sửa trên trình duyệt hiện tại.

## Cấu trúc

- `static/data.js` — dữ liệu gốc (Resonator + team Prydwen)
- `static/engine.js` — thuật toán xếp team / gợi ý pull (ToA ×1, Matrix ×2) + lưu chỉnh sửa
- `static/vendor/` — bộ giải HiGHS (WASM, giấy phép MIT)
- Ảnh nhân vật lấy từ CDN Prydwen; nếu không tải được sẽ hiện chữ cái đầu.
