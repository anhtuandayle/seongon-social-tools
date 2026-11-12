# Từng nền tảng — cách kết nối, địa chỉ, dựng gì

| Nền tảng | Kết nối (theo dự án) | Địa chỉ | App dựng gì |
|---|---|---|---|
| **WordPress.com** | OAuth bằng app WordPress của chính người dùng (dán Client ID/Secret 1 lần, Redirect URI hiện trên app) | `<ten>.wordpress.com` — người dùng **tự tạo trang trống** (WP chỉ cho trang đăng ký của chính họ tạo site; `/sites/new` từ app ngoài luôn "Invalid client_id") rồi chọn trong app | Trang chủ ngay + 3 trang qua hàng chờ ~4 phút; đặt trang chủ, trang Blog, mô tả, mở công khai (launch), menu chính |
| **Blogger** | App Google riêng (Client ID/Secret) + OAuth, refresh token | `<ten>.blogspot.com` — tạo blog trống tay 1 lần | Các trang tĩnh + hero thương hiệu + khối liên hệ |
| **Tumblr** | OAuth app Tumblr | `<ten>.tumblr.com` — tạo blog tay | Bài Giới thiệu + Danh mục |
| **Mastodon** | Access token (`instance|token`) | `mastodon.social/@ten` — tạo tài khoản tay | Điền hồ sơ + bài ghim |
| **Netlify** | Personal access token | `<ten>.netlify.app` (tên trùng → lỗi) | Site tĩnh đầy đủ (`renderStaticSite`) |
| **Vercel** | Token (No expiration) | `<ten>.vercel.app` (tài khoản team: gắn domain dự án `POST /v10/projects/{name}/domains`; không giành được → xoá dự án, báo lỗi) | Site tĩnh |
| **GitHub Pages** | Token scope `repo` | `https://<login>.github.io/` (kho `<login>.github.io`, mỗi tài khoản 1 trang) | Site tĩnh, bật Pages nhánh main |
| **Codeberg Pages** | Token | `https://<login>.codeberg.page/` (kho `pages`, nhánh `pages`) | Site tĩnh |
| **Telegraph** | Không cần (app tự tạo tài khoản Telegraph cho dự án) | `telegra.ph/<tiêu-đề>-MM-DD` | 4 trang có ảnh |

Google Sheet theo dõi: kết nối Google riêng (`/api/google/sheets/connect`), cần bật **Google Sheets API** trong dự án Google Cloud
của app Google người dùng; sheet phải chia sẻ quyền sửa cho tài khoản đã kết nối.

## Nhóm thủ công — vì sao không tự động

Pinterest (không cho tạo tài khoản/sửa hồ sơ qua API), X (cần gói trả phí + xác minh SĐT), Weebly (đã gộp Square, cổng đóng),
Goodreads (API đóng từ 2020), Instapaper (không có trang hồ sơ), Google Sites (không có API), Wix (API tạo từ mẫu đang thử nghiệm).
Nhóm "semi" có thể làm thêm: Cloudflare Pages, GitLab Pages, Firebase Hosting, Surge.sh, Google Docs xuất bản web.

## Xoá hẳn (`remove.ts`)

WordPress.com: `POST /rest/v1.1/sites/{id}/delete` — **xoá cả site** (địa chỉ đó không đặt lại được cho site mới; khôi phục được trong 30 ngày
tại wordpress.com/sites → lọc Deleted → ⋮ → Restore site). GitHub/Codeberg: xoá kho. Netlify/Vercel: xoá site/dự án.
GitHub Pages CDN giữ bản nén gzip tối đa 10 phút sau khi xoá — mở ẩn danh vẫn thấy là bình thường.
