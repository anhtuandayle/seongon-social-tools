// Kiểu dữ liệu dùng chung cho toàn bộ Worker.

export interface Env {
  // Trình duyệt ẩn của Cloudflare (Browser Rendering) — dùng cho Google Sites.
  MYBROWSER: Fetcher;
  // Giao diện web tĩnh + kho dữ liệu người dùng
  ASSETS: Fetcher;
  DATA: KVNamespace;
  DB: D1Database; // công cụ ghi nhiều (Thư ký công việc)
  US_EGRESS?: DurableObjectNamespace; // trạm chuyển tiếp ở Mỹ cho Gemini (xem egress.ts)
  ENCRYPTION_KEY?: string; // base64 32 byte — mã hoá khoá của người dùng trước khi lưu
  // Gửi mã đăng nhập qua email (Brevo)
  BREVO_API_KEY?: string;
  MAIL_FROM?: string;
  MAIL_FROM_NAME?: string;
  ALLOWED_EMAIL_DOMAINS?: string;
  ALLOWED_EMAILS?: string;
  DEV_SHOW_OTP?: string; // CHỈ dùng khi chạy thử trên máy: trả mã OTP thẳng trong phản hồi
  // AI: chọn "gemini" hoặc "openai".
  AI_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  // "vertex" = khoá Google Cloud / Vertex AI (express mode) — gọi cổng aiplatform.googleapis.com
  GEMINI_ENDPOINT?: string;
  GEMINI_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  // Hệ thống Lộ trình học tập (Google Apps Script) — cổng xin vé hộ người đã đăng nhập
  HOC_TAP_URL?: string; // địa chỉ ứng dụng web Apps Script, dạng https://script.google.com/macros/s/.../exec
  HOC_TAP_SECRET?: string; // khoá chung giữa cổng và hệ thống học tập (đặt bằng wrangler secret)
  // Bot Lark (larksuite.com) nhắc việc cho từng người — App ID/Secret của "Custom App" (đặt bằng wrangler secret)
  LARK_APP_ID?: string;
  LARK_APP_SECRET?: string;
  PUBLIC_URL?: string; // địa chỉ cổng, dùng cho nút "Mở công cụ" trong tin nhắn
  // Share social đa kênh (Netlify): cổng ký "vé" ECDSA P-256 cho người đã đăng nhập — khoá bí mật dạng JWK (wrangler secret)
  SHARE_SIGNING_KEY?: string;
  // WordPress.com: app OAuth đăng ký tại developer.wordpress.com/apps — để "Tạo social" tự tạo trang ten.wordpress.com
  WPCOM_CLIENT_ID?: string;
  WPCOM_CLIENT_SECRET?: string;
  SHARE_URL?: string; // địa chỉ Netlify, vd https://quan-ly-cong-viec-sn.netlify.app
}

export interface BusinessInfo {
  brandName: string;
  industry: string;
  slogan: string;
  logoUrl: string;
  targetUrl: string;
  brandColor: string; // mã màu dạng #RRGGBB, dùng cho banner trang chủ
  // Thông tin bổ sung (không bắt buộc) — AI dùng đúng nguyên văn, không tự bịa
  companyName?: string;
  about?: string;
  products?: string;
  address?: string;
  phone?: string;
  email?: string;
  hashtags?: string;
  // Hồ sơ tài khoản social (mẫu sheet đầu vào thống nhất với khách)
  birthday?: string; // ngày sinh / ngày thành lập
  gender?: string;
  occupation?: string;
  relationship?: string;
  zipCode?: string;
  verifyPhone?: string;
  bio?: string;
  avatarUrl?: string;
  coverUrl?: string; // 851x315
  coverWideUrl?: string; // 1280x720
  licenseUrl?: string;
  guidelinesUrl?: string;
  note?: string;
  socialUsername?: string; // Tên trang mong muốn khi tạo social (lưu theo dự án)
}

export type PageKind = "home" | "about" | "blog";

export interface GeneratedPage {
  kind: PageKind;
  title: string; // dùng làm H1 (các nền tảng tự hiển thị tiêu đề là H1)
  slug: string;
  metaDescription: string; // tối đa 160 ký tự
  html: string; // Clean HTML, bắt đầu từ H2 (không lặp H1)
}

export interface GeneratedContent {
  pages: GeneratedPage[];
}

export type Platform = "wordpress" | "blogger" | "pinterest" | "wix" | "googlesites" | "other";

/** Kế hoạch kết nối do AI tự tìm cho một nền tảng bất kỳ ("Phương án khác"). */
export interface OtherPlan {
  supported: boolean;
  reason: string;
  platformName: string;
  rootDomain: string; // tên miền gốc người dùng nhập — mọi yêu cầu chỉ được gửi tới tên miền này
  authType: "bearer" | "header" | "basic" | "query" | "none";
  authName?: string; // tên header (authType=header) hoặc tham số (authType=query)
  credentialLabel: string;
  steps: string[]; // hướng dẫn lấy khoá, tiếng Việt
  extraFields: { key: string; label: string }[]; // thông tin thêm cần người dùng nhập (vd tên blog)
  preRequest?: { method: "GET" | "POST"; url: string; extract: { name: string; path: string }[] };
  request?: { method: "POST" | "PUT"; url: string; contentType: "json" | "form"; bodyTemplate: unknown };
  resultUrlPath?: string;
  contentFormat: "html" | "markdown";
  sources?: string[];
}

export interface Credentials {
  // setupSite: đặt luôn tên site, logo, trang chủ tĩnh, trang Blog (ghi đè cấu hình site hiện tại).
  wordpress?: { siteUrl: string; username: string; appPassword: string; setupSite?: boolean };
  blogger?: { blogId: string; clientId: string; clientSecret: string; refreshToken: string };
  pinterest?: { accessToken: string; sandbox?: boolean };
  wix?: { apiKey: string; siteId: string; memberId?: string };
  googlesites?: { cookies: string };
  other?: { domain: string; token: string; extra?: Record<string, string>; plan?: OtherPlan };
}

export interface PublishedItem {
  label: string;
  url: string;
}

export interface PublishResult {
  platform: Platform;
  ok: boolean;
  items: PublishedItem[];
  error?: string;
}
