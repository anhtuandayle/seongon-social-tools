# Cấu trúc mã công cụ tạo social

| Phần | Đường dẫn (trong repo, bản sao ở `scripts/app/`) |
|---|---|
| Giao diện tab Tạo social mới | `web/src/components/social-creator.tsx` (PLATFORMS, UPCOMING, FORM, SocialRow, CheckBox, AgentError, AgentLogCard) |
| Gọi API từ trình duyệt | `web/src/lib/api.ts` |
| Cổng API + lịch chạy nền | `worker/src/index.ts` (mục "Tạo social mới", `createOnPlatform`, `saveCreated`, `checkSocial`, `runRetries`, `scheduled`) |
| Soạn 4 trang bằng quy tắc / AI | `worker/src/social/template.ts` |
| Đọc website thương hiệu | `worker/src/social/scrape.ts` |
| Dựng site tĩnh (header, footer, blog, sitemap, JSON-LD) | `worker/src/social/site.ts` |
| Từng nền tảng | `worker/src/social/{wpcom,blogger,tumblr,mastodon,hosts}.ts` (hosts = Netlify, Vercel, GitHub, Codeberg, Telegraph) |
| Share bài lên social đã tạo + dựng lại site | `worker/src/social/post.ts` (`postToSocial`, `redeploySite`) |
| Xoá hẳn trên nền tảng | `worker/src/social/remove.ts` |
| Google Sheet theo dõi | `worker/src/social/gsheets.ts` |
| Agent | `worker/src/social/agent.ts` |

## Khoá lưu trữ (Cloudflare KV)

`owner` = email người dùng + dấu `#` + id dự án.

- `socials:{owner}` — danh sách social đã tạo (kèm `check` = báo cáo kiểm tra, `sheetOk`).
- `social-site:{owner}:{id}` — ảnh chụp mẫu trang để share bài / dựng lại.
- `social-conn:{owner}`, `wpcom:{owner}`, `blogger:{owner}` — kết nối (mã hoá).
- `gsheets:{email}`, `social-track:{owner}` — kết nối Google Sheet + cách điền cột.
- Hàng chờ chạy nền: `wp-queue` (dựng trang WordPress cách ~4 phút), `social-check-queue` (kiểm tra), `social-retry-queue` (tự thử lại).
- `agent-log:{owner}` — 30 việc agent gần nhất.

## Lịch chạy nền (wrangler.toml)

- `* * * * *` — agent: tự thử lại → kiểm tra → hàng chờ WordPress (chạy lần lượt để không ghi đè hàng chờ của nhau).
- `*/15 * * * *` — nhắc việc Lark (công cụ khác của cổng).

## Triển khai

Push nhánh `main` → Cloudflare Workers Builds (thư mục gốc `worker`). Chỉ chạy wrangler trong `worker/`.
Bí mật đặt bằng `npx wrangler secret put TEN_BIEN` — không ghi vào mã hay wrangler.toml.
