# Đen Trắng II Online

Web game online 2 người cho luật **Đen Trắng II** bằng Node.js, Express và Socket.IO.

## Tính năng

- Tạo phòng riêng bằng mã phòng.
- Người chơi nhập tên khách hoặc đăng nhập tài khoản.
- Người chơi có thể tự tạo tài khoản thường.
- Admin vẫn có thể tạo tài khoản và cấp quyền admin.
- Tài khoản lưu tên hiển thị, avatar, nền trang và 10 ván gần nhất.
- Reload web vẫn tự đăng nhập lại bằng phiên lưu trong trình duyệt.
- Tài khoản đăng nhập lại ở thiết bị khác có thể nối lại ván đang diễn ra.
- Kết bạn, nhận/từ chối lời mời kết bạn.
- Hiển thị bạn bè online và gửi lời mời vào phòng.
- Bảng xếp hạng chuỗi thắng hiện tại/cao nhất cho tất cả người chơi.
- Admin xem danh sách tài khoản, IP đăng nhập gần nhất, lịch sử đấu, và xóa tài khoản spam.
- Log admin chỉ hiển thị kết quả lịch sử đấu, không hiển thị log thao tác riêng như gửi điểm hay sửa hồ sơ.

## Luật lượt đi

- Vòng 1: hệ thống random người đi trước.
- Từ vòng 2: người thắng gần nhất đi trước.
- Nếu vòng trước hòa: giữ người thắng gần nhất trước đó đi trước.

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

Khi chạy lần đầu, server sẽ tạo admin mặc định:

```text
Tài khoản: admin
Mật khẩu: admin123
```

Nên đổi mật khẩu sau khi đăng nhập hoặc đặt biến môi trường trên Render:

```text
ADMIN_USERNAME
ADMIN_PASSWORD
ADMIN_DISPLAY_NAME
```

## Deploy Render

Cấu hình Render Web Service:

```text
Build Command: npm install
Start Command: npm start
```

## Lưu dữ liệu

Bản này lưu tài khoản, hồ sơ, bạn bè, log và lịch sử thắng/thua vào:

```text
data/db.json
```

Lưu ý: nếu dùng Render Free, file local có thể mất khi server restart/redeploy. Muốn lưu bền vững lâu dài, nên chuyển sang database như Supabase/PostgreSQL.
