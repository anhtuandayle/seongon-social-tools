# SEONGON Social Tools — Tạo social + Share social

Kho tổng hợp mã và tài liệu của **2 công cụ social** trong cổng Trợ lý AI SEONGON
(`https://seongon.tro-ly-ai.workers.dev`), để cùng đọc, thu thập thông tin và đề xuất tối ưu.

| Thư mục | Công cụ | Làm gì | Chạy thật trên |
|---|---|---|---|
| [`tao-social/`](tao-social/) | **Tạo social** (agent dựng site vệ tinh) | Đọc website thương hiệu → soạn 4 trang → dựng cùng lúc lên WordPress.com, Blogger, Tumblr, Mastodon, Netlify, Vercel, GitHub Pages, Codeberg, Telegraph → ghi link vào sheet → agent tự thử lại / kiểm tra / dựng bù | Cloudflare Workers — cổng → Tạo social |
| [`share-social/`](share-social/) | **Share social đa kênh** | Dán link bài → đọc tiêu đề, nội dung, ảnh → AI tóm tắt / viết bài ngắn, dài → share đồng loạt lên các nền tảng + các social đã tạo ở công cụ trên | Netlify — cổng → Share social |

## Đọc từ đâu

- Tạo social: [`tao-social/tai-lieu/TONG-QUAN.md`](tao-social/tai-lieu/TONG-QUAN.md) (luồng chạy, quy tắc đã chốt),
  rồi `tai-lieu/nen-tang.md`, `agent.md`, `bay-da-gap.md`, `cau-truc-ma.md`. Mã: `tao-social/worker/src/social/` + `tao-social/web/src/`.
- Share social: [`share-social/HUONG-DAN-CONG-TAC.md`](share-social/HUONG-DAN-CONG-TAC.md) (cấu trúc, quy ước, **hợp đồng kết nối** với Tạo social).
  Mã: `share-social/netlify/` + `share-social/dang-bai/`.

## Quan trọng: bản đang chạy deploy từ đâu

Kho này là **bản tổng hợp để đọc và đề xuất** (chụp ngày 12/11/2026). App thật vẫn tự cập nhật từ 2 kho gốc:

- Tạo social → `anhtuandayle/tro-ly-ai-seongon` (Cloudflare tự deploy nhánh `main`)
- Share social → `anhtuandayle/quan-ly-cong-viec` (Netlify tự deploy nhánh `main`)

Muốn thay đổi lên app thật: sửa ở kho gốc tương ứng (nhánh riêng → Pull Request → anh Tuấn duyệt), hoặc mở Issue /
Pull Request ở kho này để anh Tuấn chuyển sang.

## Bảo mật

Không có khoá, mật khẩu, token hay dữ liệu khách hàng trong kho. Các giá trị riêng trong `tao-social/worker/wrangler.toml`
đã thay bằng `<...>`. Bí mật của app đặt trên máy chủ bằng biến môi trường (`wrangler secret put`, biến môi trường Netlify),
mã kết nối của người dùng lưu mã hoá trong kho dữ liệu của app — không bao giờ commit vào đây.
