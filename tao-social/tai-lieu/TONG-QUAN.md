---
name: tao-social-ai
description: Agent tạo social đa nền tảng (site vệ tinh / social entity) cho thương hiệu trong cổng Trợ lý AI SEONGON. Đọc website thương hiệu lấy logo, màu, ảnh, sản phẩm, liên hệ; soạn 4 trang Trang chủ, Giới thiệu, Danh mục sản phẩm, Blog bằng quy tắc (chỉ gọi AI khi khó); dựng cùng lúc lên WordPress.com, Blogger, Tumblr, Mastodon, Netlify, Vercel, GitHub Pages, Codeberg Pages, Telegraph; ghi link trang chủ vào Google Sheet theo dõi; agent tự thử lại, tự kiểm tra từng trang, tự dựng bù và báo Lark. Dùng khi cần tạo social cho một thương hiệu, sửa lỗi công cụ tạo social (trang bị khoá, lỗi kết nối, thiếu trang), thêm nền tảng mới, hoặc dựng lại công cụ trên Cloudflare Workers.
---

# tao-social-ai — Agent tạo social đa nền tảng

Công cụ chạy thật tại `https://seongon.tro-ly-ai.workers.dev/tao-social` (tab "Tạo social mới"), đăng nhập bằng mã OTP gửi email.
Mã nguồn chuẩn ở repo `anhtuandayle/tro-ly-ai-seongon`; bản sao mã kèm theo skill ở `scripts/app/` (đọc `scripts/app/README.md`).

## Khi nào dùng

- Cần **tạo bộ social / site vệ tinh** cho một thương hiệu (SEO entity, backlink thương hiệu) trên nhiều nền tảng cùng lúc.
- Công cụ **báo lỗi** khi tạo: chưa kết nối, mã hết hạn, trùng tên, trang bị nền tảng khoá / xoá, thiếu trang, chưa ghi được sheet.
- Cần **thêm nền tảng mới** (vd Cloudflare Pages, Surge) hoặc **sửa / dựng lại** công cụ.
- Không dùng cho: đăng bài lên trang có sẵn hàng loạt (đó là công cụ "Share social đa kênh"), tạo tài khoản thay người dùng.

## Các bước làm (tạo social cho 1 thương hiệu)

1. **Chọn dự án** trên thanh dự án. Mỗi dự án có bộ kết nối riêng — không dùng kết nối của dự án này cho dự án khác.
2. **Kết nối tài khoản gốc** cho từng nền tảng (bước 1 cài app, bước 2 kết nối cho dự án). Nền tảng bán tự động
   (WordPress.com, Blogger, Tumblr, Mastodon) cần người dùng **tự tạo trang / blog / tài khoản trống 1 lần** rồi chọn trong app.
   Cách kết nối từng nơi: `references/nen-tang.md`.
3. **Nhập thông tin thương hiệu** (hoặc đọc từ sheet) + **Tên trang mong muốn**, bấm "Lấy màu, logo từ website" để app tự đọc
   logo, màu, font, ảnh, sản phẩm, liên hệ từ website chính.
4. **Xem trước** 4 trang và URL dự kiến của từng nền tảng; kiểm tra tên trang đúng y nguyên.
5. **Bấm Tạo** (có 5 giây để Huỷ, đang chạy có nút Dừng). Các nền tảng chạy song song, lỗi nơi này không ảnh hưởng nơi khác.
6. **Đọc kết quả**: mỗi nền tảng 1 link trang chủ công khai + Copy. Nền tảng lỗi hiện "chuyện gì xảy ra · cần làm gì · link sửa"
   và giờ agent tự thử lại (nếu lỗi tự hết được).
7. **Ghi sheet theo dõi** (tự động nếu đã cài sheet: chọn tab, dòng tiêu đề, cột Nền tảng / Link / Ngày / Tài khoản).
8. **Đợi agent kiểm tra** (2–16 phút tuỳ nền tảng): xem ô ✅ / ⚠️ / ⏳ dưới mỗi social và thẻ "Nhật ký agent"; chỉ làm tay
   những việc agent ghi 🙋 "Cần anh/chị làm". Cơ chế agent: `references/agent.md`.

## Các bước làm (sửa lỗi / thêm nền tảng)

1. Đọc lỗi gốc (ô "Lỗi gốc" trên app) và đối chiếu `references/bay-da-gap.md` trước khi đoán.
2. Cần xem lệnh thật gửi lên nền tảng: chạy `npx wrangler tail social-creator --format pretty` trong thư mục `worker/`.
3. Thêm nền tảng: viết hàm tạo trả `{ siteUrl, adminUrl, siteId, pages }` (hỗ trợ `resume` để thử lại không tạo trùng) →
   thêm vào `SOCIAL_PLATFORM_NAME` + `createOnPlatform` (`worker/src/index.ts`), `removeOnPlatform`, `postToSocial` →
   thêm vào danh sách `PLATFORMS` ở giao diện kèm link lấy mã → thêm link quản trị + mẫu lỗi vào `agent.ts`.
4. Kiểm tra kiểu: `npx tsc --noEmit -p .` trong `worker/` và `web/` → commit → push `main` (Cloudflare tự deploy ~1–2 phút)
   → xác nhận bằng `npx wrangler deployments list`.

## Đầu ra mong muốn

- Mỗi nền tảng: **1 link trang chủ công khai mở được** (HTTP 200, có tên thương hiệu, không chặn Google), đủ 4 trang
  (Trang chủ, Giới thiệu, Danh mục sản phẩm, Blog), có logo / ảnh / màu của website gốc, header + footer đầy đủ, link về website chính.
- Link trang chủ đã ghi vào đúng dòng nền tảng trong sheet theo dõi.
- Báo cáo agent: việc đã tự sửa (✅) và việc cần người làm (🙋) kèm link bấm thẳng — trên app và Lark.

## Lưu ý (quy tắc đã chốt — không tự ý đổi)

1. **Tên trang mong muốn dùng y nguyên** trên mọi nền tảng; trùng thì báo lỗi, **không tự thêm số / đổi tên**.
2. **Kết quả chính là link trần công khai**; link trang quản trị chỉ để nhỏ ở cuối.
3. **Quy tắc trước, AI sau**: soạn trang bằng quy tắc; AI chỉ khi khó hoặc người dùng chọn; AI lỗi vẫn phải ra kết quả.
4. **Tránh bị khoá vì nghi spam**: WordPress dựng trang chủ ngay, 3 trang còn lại cách ~4 phút; không xoá → khôi phục → dựng lại
   hàng loạt trên cùng 1 trang; ô "Xoá sạch nội dung cũ" để tắt.
5. Cái gì tạo / chọn được thì có **nút xoá**; xoá hẳn trên nền tảng chỉ khi người dùng bấm và xác nhận.
6. **Không gõ mật khẩu, không tạo tài khoản, không giải captcha** thay người dùng.
7. **Khoá bí mật không ghi vào mã**: đặt trên Worker bằng `npx wrangler secret put` và đọc từ biến môi trường —
   `ENCRYPTION_KEY` (mã hoá mọi kết nối đã lưu, mất là mất hết), `BREVO_API_KEY` (gửi OTP), tuỳ chọn `GEMINI_API_KEY`.
   Mã truy cập của người dùng lưu mã hoá trong KV, không bao giờ trả về trình duyệt.
8. Bản sao mã trong `scripts/app/` là ảnh chụp lúc đóng gói — bản chuẩn luôn là repo.

## Tài liệu kèm theo

- `references/nen-tang.md` — từng nền tảng: cách kết nối, địa chỉ, app dựng gì, vì sao nhóm thủ công không tự động.
- `references/agent.md` — agent 3 tầng: đọc lỗi, tự thử lại, tự kiểm tra / dựng bù, việc phải nhờ người.
- `references/bay-da-gap.md` — các lỗi đã gặp thật (WordPress.com client_id / API cũ bị tắt / 410 / bị khoá…) và cách sửa.
- `references/cau-truc-ma.md` — mã nằm ở đâu, các khoá lưu trữ KV, lịch chạy nền.
- `scripts/app/` — bản sao mã nguồn (Cloudflare Worker + giao diện Next.js).
