# Đen Trắng II Online

Web game online 2 người cho luật Đen Trắng II.

## Tính năng

- Chơi online bằng mã phòng.
- 2 người chơi, 9 vòng, mỗi người bắt đầu với 99 điểm.
- Vòng 1 chủ phòng đi trước. Từ vòng 2, người thắng gần nhất đi trước; nếu hòa thì giữ người thắng trước đó.
- Người đi sau chỉ thấy ĐEN/TRẮNG và mốc điểm còn lại của người đi trước.
- Có tài khoản và đăng nhập.
- Chỉ admin mới tạo được tài khoản mới.
- Có nút đăng nhập với tư cách khách.
- Tài khoản lưu lại kết quả 10 ván gần nhất và tính tỉ lệ thắng.
- Có thể đổi tên hiển thị, avatar và nền trang.
- Admin xem được log người chơi, gồm cả khách: đăng nhập, tạo/vào phòng, gửi điểm, kết quả vòng và kết thúc ván.

## Cách chạy trên máy

```bash
npm install
npm start
```

Mở trình duyệt tại:

```txt
http://localhost:3000
```

## Admin mặc định

Lần đầu chạy, app tự tạo admin mặc định:

```txt
Tài khoản: admin
Mật khẩu: admin123
```

Khi deploy online, nên đổi bằng biến môi trường:

```txt
ADMIN_USERNAME=admin
ADMIN_PASSWORD=mat-khau-manh-cua-ban
ADMIN_DISPLAY_NAME=Admin
```

Sau đó dùng tài khoản admin để tạo tài khoản cho người chơi khác.

## Dữ liệu được lưu ở đâu?

Tài khoản, avatar, nền, lịch sử 10 ván gần nhất và log admin được lưu vào:

```txt
data/db.json
```

Nếu chạy local thì dữ liệu vẫn còn trong máy. Nếu deploy Render/Railway bản miễn phí, dữ liệu có thể bị mất khi server restart/redeploy vì ổ đĩa không bền vững. Muốn lưu lâu dài thật sự thì nên dùng database như Supabase, PostgreSQL hoặc Render Disk.

## Luật trong bản web này

- 2 người chơi, 9 vòng.
- Mỗi người bắt đầu với 99 điểm.
- Mỗi vòng, người đi trước gửi điểm trước. Người đi sau thấy màu và mốc còn lại của người đi trước rồi mới gửi điểm.
- Ai gửi điểm cao hơn thắng vòng.
- Nếu bằng điểm thì hòa, không ai được điểm vòng đó.
- 0-9 là ĐEN, 10-99 là TRẮNG.
- Mốc điểm còn lại:
  - A: 80-99
  - B: 60-79
  - C: 40-59
  - D: 20-39
  - E: 0-19

## Deploy online bằng Render

1. Đưa code lên GitHub.
2. Vào Render, chọn New Web Service.
3. Connect repo.
4. Build command: `npm install`
5. Start command: `npm start`
6. Nên thêm Environment Variables:
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
   - `ADMIN_DISPLAY_NAME`
7. Sau khi deploy, gửi link cho bạn vào chơi.


## Đổi mật khẩu

Đăng nhập bằng tài khoản của bạn, vào mục **Tùy chỉnh hồ sơ** rồi dùng phần **Đổi mật khẩu**. Khách không có mật khẩu nên không dùng được chức năng này.

Admin mặc định lần đầu là `admin` / `admin123`. Sau khi đăng nhập admin, nên đổi mật khẩu ngay trong giao diện web.


## Log admin

Đăng nhập bằng tài khoản admin, kéo xuống mục **Log người chơi** để xem log của cả tài khoản và khách. Log sẽ ghi các hành động chính như đăng nhập, tạo phòng, vào phòng, bắt đầu ván, gửi điểm, kết quả vòng, kết thúc ván, chơi lại, đổi hồ sơ và thoát game.

Log gửi điểm có lưu số điểm thật để admin kiểm tra sau này. Không lưu mật khẩu, password hash, salt, avatar hay ảnh nền vào log.
