# Bẫy đã gặp thật (và cách đã sửa)

## WordPress.com
- **"Invalid client_id" khi tạo site**: `/rest/v1.1/sites/new` chỉ dành cho client đăng ký của chính WordPress → bỏ tạo site,
  người dùng tạo trang trống rồi chọn (`listWpcomSites`). Không dùng lại credential đăng ký của WordPress.
- **"API calls to this endpoint have been disabled"**: v1.1 đang bị tắt dần → dùng `public-api.wordpress.com/wp/v2/sites/{id}/…?_envelope=1`
  (luôn nhận đủ phản hồi + mã lỗi trong body), dự phòng `https://<site>/wp-json/wp/v2`; v1.1 chỉ làm dự phòng cuối.
- **Trả về rỗng / lỗi khó hiểu → thật ra trang đã bị xoá (HTTP 410 "The authors have deleted this site")**: `/me/sites` vẫn liệt kê
  site đã xoá. `listWpcomSites` kiểm tra trang chủ, đánh dấu `deleted`, giao diện khoá lựa chọn đó.
- **Bị khoá "archived or suspended in accordance with our Terms of Service"** (cũng HTTP 410, nhưng API báo `is_deleted:false`):
  xảy ra sau chuỗi xoá → khôi phục → xoá sạch → dựng 4 trang trong vài phút. Từ đó: dựng cách ~4 phút, ô xoá sạch tắt sẵn,
  agent nhận diện "suspended" và chỉ đường kháng nghị `https://wordpress.com/help/contact`.
- Chẩn đoán đúng bằng `wrangler tail social-creator --search WPCOM` (hàm `rest` ghi log từng lệnh: mã, content-type, 300 ký tự đầu).

## Nền tảng khác
- **Vercel tài khoản team** gắn đuôi tên team vào địa chỉ → gắn domain cho *dự án* (không phải bản dựng) để lần cập nhật sau giữ địa chỉ.
- **GitHub đã xoá mà vẫn mở được** (cả ẩn danh): CDN giữ biến thể gzip `max-age=600` — đợi ~10 phút.
- **Blogger 400** khi liệt kê blog với `view=ADMIN` → thử lại không kèm `view`.
- **Google Sheets "API has not been used / disabled"** → báo câu dễ hiểu kèm link bật API; thiếu quyền → nhắc chia sẻ sheet.
- **Đọc màu website sai** (seongon.com ra màu swiper / preset WP): lọc màu thư viện, đọc cả CSS tải trễ.

## Công cụ / quy trình
- Bash heredoc + `node -e` làm hỏng `\` và backtick → viết script vá bằng file riêng; file CRLF thì chuẩn hoá LF trước khi vá chuỗi nhiều dòng.
- **Regex "lười" để thay khối code có thể nuốt cả nghìn dòng** → chỉ thay bằng chuỗi cố định, kiểm tra `git diff --stat` trước khi commit.
- Thư mục `out` bị khoá khi đang chạy preview → dừng preview trước khi build web.
- Chỉ deploy từ `worker/` (chạy wrangler trong `web/` làm hỏng web tĩnh).
- Kiểm tra bản đã lên: `npx wrangler deployments list` so giờ với commit.
