# Đen Trắng II Online

Web game 2 người chơi online bằng Node.js + Express + Socket.IO.

## Tính năng chính

- Đăng nhập tài khoản hoặc chơi nhanh với tư cách khách.
- Người chơi tự tạo tài khoản thường. Tài khoản VIP chỉ admin mới tạo/cấp được.
- Admin tạo/xóa tài khoản, cấp/gỡ VIP, xem IP gần nhất và xem lịch sử đấu của từng tài khoản.
- Lưu tên hiển thị, avatar, nền, 10 ván gần nhất và chuỗi thắng cho tài khoản.
- Reload web vẫn tự đăng nhập lại bằng session lưu trong trình duyệt.
- Tài khoản có thể đăng nhập lại từ thiết bị khác để tiếp tục ván đang diễn ra.
- Vòng 1 random người đi trước.
- Từ vòng 2 trở đi, người thắng gần nhất đi trước; nếu hòa thì giữ người thắng gần nhất trước đó.
- Ai đạt 5 điểm thắng vòng trước sẽ thắng chung cuộc và ván kết thúc ngay.
- Sau khi kết thúc, hiện chi tiết từng vòng: mỗi người đã bỏ bao nhiêu điểm, còn bao nhiêu điểm, màu và mốc.
- Sau khi kết thúc, hệ thống tự đưa cả 2 người ra khỏi phòng. Muốn chơi tiếp phải tạo phòng mới.
- Có nút rời phòng để tránh bị kẹt khi vào nhầm phòng.
- Bảng xếp hạng chỉ hiện người chơi có chuỗi thắng từ 3 trở lên.
- Top 1, 2, 3 bảng xếp hạng có huy hiệu khi vào phòng. Huy hiệu tự cập nhật theo bảng xếp hạng.
- Admin/VIP có logo hiển thị riêng, hiệu ứng điểm, hiệu ứng phòng và hiệu ứng bùng nổ khi vào phòng.
- Đã tắt tính năng tìm bạn/kết bạn/mời bạn bè vì không cần thiết.

## Chạy local

```bash
npm install
npm start
```

Mở:

```text
http://localhost:3000
```

## Admin mặc định

Lần chạy đầu tiên server sẽ tạo admin mặc định:

```text
username: admin
password: admin123
```

Nên đổi mật khẩu sau khi đăng nhập, hoặc đặt biến môi trường:

```text
ADMIN_USERNAME
ADMIN_PASSWORD
ADMIN_DISPLAY_NAME
```

## Deploy Render

- Build Command: `npm install`
- Start Command: `npm start`

Lưu ý: bản này lưu dữ liệu trong `data/db.json`. Nếu dùng Render Free, dữ liệu có thể mất khi server restart/redeploy. Muốn lưu bền vững nên chuyển sang database như Supabase/PostgreSQL.
