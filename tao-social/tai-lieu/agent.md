# Agent tạo social — 3 tầng

Nguyên tắc: **quy tắc trước, AI sau**; tự sửa những gì sửa được, chỉ nhờ người khi hết cách; mọi việc đều ghi nhật ký.

## Tầng 1 — Xử lý sự cố (đã làm)

Lúc bấm Tạo: mỗi nền tảng chạy qua `runWithAgent` (`social/agent.ts`).

- `diagnoseRule(platform, name, err)` đọc lỗi bằng mẫu: `suspended` (bị khoá), `gone` (410 / đã xoá), `setup` (chưa kết nối/chọn),
  `auth` (401, token hết hạn, thiếu quyền), `name` (trùng tên 422/409), `limit` (429), `transient` (5xx, timeout, mạng),
  "endpoint disabled" (nền tảng tắt API cũ → cần sửa code).
- Lỗi lạ → `diagnoseAI` (Gemini chế độ nhanh, trả JSON `{kind,message,fix,retry}`); AI lỗi → câu chung, không hỏng kết quả.
- Tự thử lại ngay (3s, 8s) **chỉ ở WordPress** (tạo trang theo slug, có rồi thì cập nhật → không trùng).
- Lỗi có `retry=true` → vào hàng chờ `social-retry-queue`: cron tự thử lại **sau 10 phút**, còn lỗi thì **lần cuối sau 30 phút**,
  gọi `createOnPlatform(..., resume=true)`:
  - Netlify: tên đã tồn tại trong chính tài khoản → dùng lại site đó.
  - GitHub: kho `<login>.github.io` đã có → ghi đè nội dung + bật Pages.
  - Codeberg: kho `pages` đã có → ghi đè nội dung.
  - WordPress: luôn an toàn (theo slug); không xoá sạch khi thử lại.
  - Telegraph / Mastodon / Blogger: thử lại có thể tạo 1 bản trùng nếu lần trước đã đăng được một phần.
- Người dùng tự bấm "Thử lại" thành công → `cancelRetry` huỷ lượt chờ (không tạo trùng).
- Giao diện `AgentError`: chuyện gì xảy ra · 👉 Cần làm · link "Mở trang cần sửa" · 🔁 giờ agent tự thử lại · lỗi gốc thu gọn.

## Tầng 2 — Người kiểm tra (đã làm)

- Sau khi tạo, `enqueueCheck`: WordPress +16 phút (đợi đủ 4 trang), GitHub/Codeberg +4 phút (đợi build), nơi khác +2 phút.
- `checkSocial` mở từng trang (`checkPage`): mã HTTP, chữ "archived or suspended", tên thương hiệu có trong trang, `noindex`.
- Tự sửa:
  - WordPress thiếu trang → hàng chờ dựng bù (`repair: true`, không đụng menu).
  - Trang tĩnh thiếu sau lần chờ đầu → `redeploySite` dựng lại cả site từ ảnh chụp `social-site:<owner>:<id>`.
  - WordPress còn "Sắp ra mắt"/noindex → `wpRelaunch`.
  - Sheet chưa ghi → ghi lại.
- Đang dựng/build → kiểm tra lại sau 6 phút, tối đa 3 vòng.
- Lưu `rec.check` (hiện ô ✅/⚠️/⏳ dưới mỗi social + nút "Kiểm tra lại" = `POST /api/social/:id/check`),
  ghi `agent-log:<owner>`, nhắn Lark nếu người dùng có dòng trong bảng D1 `lark_settings`.

## Việc agent KHÔNG tự làm (báo người, kèm 1 việc cần làm + link)

- Tên trùng với người khác (rule: không tự đổi tên).
- Mã kết nối hết hạn (phải đăng nhập lấy mã mới).
- Trang bị nền tảng khoá / xoá (kháng nghị / khôi phục bằng tài khoản người dùng).
- Nền tảng đổi API (phải sửa code).

## Tầng 3 — Trực kỹ thuật hằng ngày (CHƯA làm, anh Tuấn để sau)

Ý tưởng: mỗi sáng chạy thử nhẹ từng nền tảng bằng tài khoản thử riêng, phát hiện API bị tắt trước khi người dùng gặp, báo kèm đề xuất sửa.
Hướng "Claude điều khiển Chrome trên máy người dùng cho nền tảng không có API" anh Tuấn đang cân nhắc — giới hạn cố định: không gõ mật khẩu,
không tạo tài khoản, không giải captcha, không đổi cài đặt bảo mật (người dùng tự làm, agent dừng đúng chỗ và nhắn).
