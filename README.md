# Đen Trắng II Online

Web game 2 người chơi online bằng Node.js + Express + Socket.IO.

## Bản này dùng Neon/Postgres để không mất tài khoản

Bản này đã chuyển dữ liệu tài khoản, điểm số, VIP/admin, session đăng nhập, lịch sử đấu, bảng xếp hạng, cảnh báo IP và cài đặt admin sang **Neon/Postgres** khi có biến môi trường:

```text
DATABASE_URL=postgresql://...
```

Nếu không có `DATABASE_URL`, server vẫn chạy chế độ cũ bằng file JSON local để test trên máy.

## Tính năng chính

- Bắt buộc đăng nhập hoặc tạo tài khoản mới để chơi; đã xóa chế độ khách.
- Người chơi tự tạo tài khoản thường. Tài khoản VIP chỉ admin mới tạo/cấp được.
- Mật khẩu giới hạn từ 4 đến 12 ký tự.
- Chỉ VIP/Admin mới đổi được avatar; tài khoản thường chỉ đổi được tên hiển thị và sẽ thấy dòng: “Chỉ có tài khoản VIP mới có quyền thay đổi avatar”.
- Đã xóa phần thay nền để dữ liệu nhẹ hơn.
- Admin tạo/xóa tài khoản, cấp/gỡ VIP, xem IP gần nhất, xem lịch sử đấu, mở khóa tài khoản, đặt lại mật khẩu và chỉnh chuỗi thắng.
- Reload web vẫn tự đăng nhập lại bằng session lưu trong trình duyệt.
- Tài khoản có thể đăng nhập lại từ thiết bị khác để tiếp tục ván đang diễn ra, miễn là server chưa restart và phòng còn trong RAM.
- Vòng 1 random người đi trước.
- Từ vòng 2 trở đi, người thắng gần nhất đi trước; nếu hòa thì giữ người thắng gần nhất trước đó.
- Ai đạt 5 điểm thắng vòng trước sẽ thắng chung cuộc và ván kết thúc ngay.
- Sau khi kết thúc, có thể hiện chi tiết từng vòng; admin có thể bật/tắt log sau trận.
- Bảng xếp hạng chỉ hiện người chơi có chuỗi thắng từ 3 trở lên; admin có thể bật/tắt bảng xếp hạng.
- Top 1, 2, 3 bảng xếp hạng có huy hiệu khi vào phòng.
- Admin/VIP có logo, hiệu ứng điểm, hiệu ứng phòng, giao diện huyền ảo và hiệu ứng bùng nổ khi vào phòng.
- Admin có khung gửi thông báo toàn server.
- Chống spam tài khoản: nếu có hơn 2 tài khoản dùng cùng một IP, hệ thống cảnh báo admin và khóa tài khoản thường; VIP/Admin không bị khóa do trùng IP.
- Admin có nút tải backup và khôi phục backup tài khoản.

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

Nếu database chưa có admin, server sẽ tạo admin mặc định:

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
- Environment Variable bắt buộc để dùng Neon:

```text
DATABASE_URL=connection string Neon của bạn
```

Sau khi deploy thành công, Render Logs sẽ hiện:

```text
Chế độ lưu dữ liệu: Neon/Postgres
```

Nếu Logs hiện:

```text
Chế độ lưu dữ liệu: file JSON local
```

thì Render chưa nhận được `DATABASE_URL` hoặc bạn thêm biến môi trường sai project.

## Các bảng Neon cần có

Server sẽ tự tạo hoặc bổ sung cột còn thiếu cho các bảng này:

```text
users
sessions
battle_logs
admin_logs
app_settings
ip_warnings
```

Nếu trước đó Neon có bảng mẫu `playing_with_neon` thì có thể xóa, không ảnh hưởng web.

## Chuyển dữ liệu cũ từ file sang Neon

Nếu server thấy Neon chưa có tài khoản nào nhưng trong project còn `data/accounts.json` hoặc `data/db.json`, server sẽ tự nhập dữ liệu cũ sang Neon một lần.

Cách an toàn nhất trước khi cập nhật:

1. Đăng nhập admin ở web cũ.
2. Bấm **Tải backup tài khoản**.
3. Cập nhật bản code này.
4. Nếu Neon trống hoặc dữ liệu chưa đúng, đăng nhập admin rồi dùng **Khôi phục backup**.

Không đăng file backup lên GitHub công khai vì file có dữ liệu tài khoản, IP và session đăng nhập.
