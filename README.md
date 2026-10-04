# WuWa Account Optimizer (bản web tĩnh)

Chọn Resonator đang có → xếp team tối ưu → biết nên pull ai tiếp theo (ToA / Matrix).
Không cần server hay cài đặt: mọi thứ chạy ngay trong trình duyệt.

## Cặp chuẩn (Admin → Team comp)

- Dưới 3 slot có khung **🔗 Cặp chuẩn**: bấm **＋ Thêm cặp**, chọn 2 nhân vật nằm ở 2 slot khác nhau (ví dụ Lupa + Mornye).
- Khi cả hai cùng có mặt trong đội hình thì **mỗi người được nâng 1 bậc** (B→A, A→S; đã S thì vẫn S). Đứng riêng (thiếu đối tác) thì giữ nguyên bậc đã chọn trong slot.
- Vì vậy hãy chấm bậc **lúc đứng riêng** cho từng nhân vật; bậc khi đúng cặp do app tự cộng. Ví dụ Lupa A, Mornye A, Qiuyuan A, Shorekeeper A + 2 cặp (Lupa–Mornye, Qiuyuan–Shorekeeper): đúng cặp = S + S, còn Lupa + Shorekeeper hoặc Qiuyuan + Mornye vẫn chỉ là A + A.
- Áp dụng ở mọi nơi tính điểm: xếp team tối ưu, gợi ý nên pull ai, team còn thiếu người, và chấm điểm team tự kéo thả. Thẻ team hiện dòng "🔗 Cặp chuẩn (+1 bậc)" khi có cặp đang khớp.
- `data.js`: team có thêm `pairs` (danh sách `[idA, idB]`, bỏ trống thì không xuất). Import/Export JSON dùng tên nhân vật.

## Giới hạn số team & "Nên pull ai?"

- Thanh dưới cùng, bên phải có ô **Giới hạn số team**: để trống = không giới hạn. Máy chọn tập team có tổng điểm lớn nhất với tối đa N team. Nếu N lớn hơn số team xếp được thì chỉ hiện các team xếp được (kèm ghi chú, không báo lỗi). Giá trị được lưu trong trình duyệt.
- **Nên pull ai?** luôn tính cả nhân vật sắp ra mắt, kết quả chia 2 nhóm (mỗi nhóm xếp điểm pull từ cao xuống thấp):
  1. *Ghép được với nhân vật hiện có*: lập thêm được ít nhất 1 team với roster đang chọn.
  2. *Nhân vật tiềm năng*: chưa ghép được team nào, chỉ xuất hiện nhờ điểm Potential dương.

## Cập nhật v3

- **Matrix**: nền trang chuyển đỏ nhẹ; card nhân vật giống ToA (không còn nút +/−). Healer đã chọn tự được dùng ×2 (đặt vai trò Healer trong Admin → bảng Resonator).
- **Icon hệ** (SVG nhúng sẵn trong `common.js`, biến `EL_SVG`) thay cho chữ ở bộ lọc, card nhân vật và gợi ý pull. Muốn dùng ảnh gốc của game: điền `EL_IMG.Aero = "static/img/el/aero.png"`… (một dòng mỗi hệ).
- **Preview team**: nút thay cho "Xuất ảnh", chỉ hiện trên web, không tải file.
- **Admin**: cặp chuẩn có 3 ô (được để trống 1 ô, tối thiểu 2 người); bậc trong slot S→F, mỗi bậc hạ trừ 0.5 điểm; bỏ Tier/Patch của team; thêm trạng thái **Debut** (bạc); Potential S+ S A B C D E F = +5 +2 0 −1 −2 −3 −5 −10.
- YouTube / Discord là 2 nút tròn cố định góc dưới bên phải.
