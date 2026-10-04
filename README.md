# WuWa Account Optimizer (bản web tĩnh)

Chọn Resonator đang có → xếp team tối ưu → biết nên pull ai tiếp theo (ToA / Matrix).
Không cần server hay cài đặt: mọi thứ chạy ngay trong trình duyệt.

## Cặp chuẩn (Admin → Team comp)

- Dưới 3 slot có khung **🔗 Cặp chuẩn**: bấm **＋ Thêm cặp**, chọn 2 nhân vật nằm ở 2 slot khác nhau (ví dụ Lupa + Mornye).
- Khi cả hai cùng có mặt trong đội hình thì **mỗi người được nâng 1 bậc** (B→A, A→S; đã S thì vẫn S). Đứng riêng (thiếu đối tác) thì giữ nguyên bậc đã chọn trong slot.
- Vì vậy hãy chấm bậc **lúc đứng riêng** cho từng nhân vật; bậc khi đúng cặp do app tự cộng. Ví dụ Lupa A, Mornye A, Qiuyuan A, Shorekeeper A + 2 cặp (Lupa–Mornye, Qiuyuan–Shorekeeper): đúng cặp = S + S, còn Lupa + Shorekeeper hoặc Qiuyuan + Mornye vẫn chỉ là A + A.
- Áp dụng ở mọi nơi tính điểm: xếp team tối ưu, gợi ý nên pull ai, team còn thiếu người, và chấm điểm team tự kéo thả. Thẻ team hiện dòng "🔗 Cặp chuẩn (+1 bậc)" khi có cặp đang khớp.
- `data.js`: team có thêm `pairs` (danh sách `[idA, idB]`, bỏ trống thì không xuất). Import/Export JSON dùng tên nhân vật.
