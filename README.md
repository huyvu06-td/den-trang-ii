# Đen Trắng II Online

Web game 2 người chơi online bằng Node.js + Express + Socket.IO.

## Tính năng chính

- Đăng nhập tài khoản hoặc chơi nhanh với tư cách khách.
- Người chơi tự tạo tài khoản thường. Tài khoản VIP chỉ admin mới tạo/cấp được.
- Admin tạo/xóa tài khoản, cấp/gỡ VIP, xem IP gần nhất, xem lịch sử đấu của từng tài khoản, mở khóa tài khoản và chỉnh chuỗi thắng trên bảng xếp hạng.
- Lưu tên hiển thị, avatar, nền, 10 ván gần nhất và chuỗi thắng cho tài khoản vào file riêng `data/accounts.json`.
- Reload web vẫn tự đăng nhập lại bằng session lưu trong trình duyệt.
- Tài khoản có thể đăng nhập lại từ thiết bị khác để tiếp tục ván đang diễn ra.
- Vòng 1 random người đi trước.
- Từ vòng 2 trở đi, người thắng gần nhất đi trước; nếu hòa thì giữ người thắng gần nhất trước đó.
- Ai đạt 5 điểm thắng vòng trước sẽ thắng chung cuộc và ván kết thúc ngay.
- Sau khi kết thúc, có thể hiện chi tiết từng vòng: mỗi người đã bỏ bao nhiêu điểm, còn bao nhiêu điểm, màu và mốc. Admin có thể bật/tắt log sau trận; nếu tắt thì chỉ VIP/Admin xem được.
- Sau khi kết thúc, hệ thống tự đưa cả 2 người ra khỏi phòng. Muốn chơi tiếp phải tạo phòng mới.
- Có nút rời phòng để tránh bị kẹt khi vào nhầm phòng.
- Bảng xếp hạng chỉ hiện người chơi có chuỗi thắng từ 3 trở lên. Admin có thể bật/tắt bảng xếp hạng; nếu tắt thì chỉ VIP/Admin xem được.
- Top 1, 2, 3 bảng xếp hạng có huy hiệu khi vào phòng. Huy hiệu tự cập nhật theo bảng xếp hạng và theo điểm chuỗi thắng admin chỉnh.
- Admin/VIP có logo hiển thị riêng, hiệu ứng điểm, hiệu ứng phòng, giao diện huyền ảo và hiệu ứng bùng nổ khi vào phòng.
- Admin có khung gửi thông báo toàn server; thông báo sẽ nổi bật trên màn hình tất cả người chơi theo dạng “Admin [tên] thông báo”.
- Đã loại bỏ hoàn toàn code tìm bạn/kết bạn/mời bạn bè và code nhạc nền để project gọn nhẹ hơn.
- Chống spam tài khoản: nếu có hơn 2 tài khoản dùng cùng một IP, hệ thống gửi cảnh báo cho admin và tự khóa tạm thời các tài khoản thường có IP đó. VIP và admin không bị khóa do trùng IP, nhưng vẫn xuất hiện trong cảnh báo. Chỉ admin mới mở khóa được tài khoản bị khóa.

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

## Lưu dữ liệu tài khoản khi nâng cấp web

Bản này đã tách dữ liệu thành 2 file:

```text
data/accounts.json
```

File này chứa tài khoản, mật khẩu đã mã hóa, tên hiển thị, avatar, nền, VIP/admin, trạng thái khóa, IP gần nhất, 10 ván gần nhất, lịch sử đấu và chuỗi thắng.

```text
data/db.json
```

File này chỉ chứa dữ liệu phụ như cài đặt hiển thị, cảnh báo IP và log hệ thống.

Khi nâng cấp code, **không xóa / không upload đè `data/accounts.json`**. Chỉ upload đè các file code như `server.js`, `public/app.js`, `public/style.css`, `public/index.html`, `package.json`, `README.md`.

Nếu bạn từng dùng bản cũ có dữ liệu trong `data/db.json`, lần chạy đầu tiên bản này sẽ tự chuyển tài khoản và điểm số sang `data/accounts.json`.

Lưu ý: nếu dùng Render Free không gắn Persistent Disk, dữ liệu file có thể mất khi server restart/redeploy. Muốn giữ chắc chắn, hãy sao lưu `data/accounts.json` hoặc dùng Persistent Disk/database như Supabase/PostgreSQL.

## Sao lưu / khôi phục tài khoản bằng admin

Đăng nhập tài khoản admin, vào mục **Quản trị tài khoản** → **Sao lưu / khôi phục tài khoản**.

- **Tải backup tài khoản**: tải về file `accounts-backup-YYYY-MM-DD.json`.
- **Khôi phục backup**: chọn file backup `.json` đã tải trước đó rồi bấm khôi phục.

File backup chứa tài khoản, mật khẩu đã mã hóa, avatar, nền, VIP/admin, trạng thái khóa, IP gần nhất, lịch sử đấu và chuỗi thắng. Không upload file backup công khai lên GitHub vì file có dữ liệu tài khoản, IP và session đăng nhập.

Khi khôi phục backup, toàn bộ phòng đang mở sẽ bị đóng để tránh dữ liệu phòng bị lệch với dữ liệu tài khoản mới.

## Cập nhật thông báo admin

- Mỗi thông báo admin có nút **×** để người chơi tắt ngay, và vẫn tự biến mất sau vài giây.

