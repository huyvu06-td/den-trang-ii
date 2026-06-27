# Đen Trắng II Online

Web game online 2 người cho luật Đen Trắng II.

## Cách chạy trên máy

```bash
npm install
npm start
```

Mở trình duyệt tại:

```txt
http://localhost:3000
```

## Luật trong bản web này

- 2 người chơi, 9 vòng.
- Mỗi người bắt đầu với 99 điểm.
- Mỗi vòng, người đi trước gửi điểm trước. Người đi sau thấy màu và mốc còn lại của người đi trước rồi mới gửi điểm.
- Người đi trước được luân phiên mỗi vòng để công bằng.
- Ai gửi điểm cao hơn thắng vòng.
- Nếu bằng điểm thì hòa, không ai được điểm vòng đó.
- 0-9 là ĐEN, 10-99 là TRẮNG.
- Mốc điểm còn lại:
  - A: 80-99
  - B: 60-79
  - C: 40-59
  - D: 20-39
  - E: 0-19

## Deploy online miễn phí

Có thể deploy lên Render hoặc Railway.

### Render

1. Đưa code lên GitHub.
2. Vào Render, chọn New Web Service.
3. Connect repo.
4. Build command: `npm install`
5. Start command: `npm start`
6. Sau khi deploy, gửi link cho bạn vào chơi.
