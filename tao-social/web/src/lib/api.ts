// Kiểu dữ liệu + hàm gọi Backend (Cloudflare Worker).

export type Platform = "wordpress" | "blogger" | "pinterest" | "wix" | "googlesites" | "other";

/** Kế hoạch kết nối AI tự tìm cho "Phương án khác". */
export interface OtherPlan {
  supported: boolean;
  reason: string;
  platformName: string;
  rootDomain: string;
  authType: "bearer" | "header" | "basic" | "query" | "none";
  credentialLabel: string;
  steps: string[];
  extraFields: { key: string; label: string }[];
  [k: string]: unknown;
}

export const PLATFORM_NAMES: Record<Platform, string> = {
  wordpress: "WordPress (tự cài)",
  blogger: "Blogger",
  pinterest: "Pinterest",
  wix: "Wix",
  googlesites: "Google Sites",
  other: "Phương án khác (AI tự tìm cách)",
};

export interface BusinessInfo {
  brandName: string;
  industry: string;
  slogan: string;
  logoUrl: string;
  targetUrl: string;
  brandColor: string;
  // Thông tin bổ sung (không bắt buộc)
  companyName: string;
  about: string;
  products: string;
  address: string;
  phone: string;
  email: string;
  hashtags: string;
  // Hồ sơ tài khoản social (mẫu sheet đầu vào)
  birthday?: string;
  gender?: string;
  occupation?: string;
  relationship?: string;
  zipCode?: string;
  verifyPhone?: string;
  bio?: string;
  avatarUrl?: string;
  coverUrl?: string;
  coverWideUrl?: string;
  licenseUrl?: string;
  guidelinesUrl?: string;
  note?: string;
  socialUsername?: string; // Tên trang mong muốn khi tạo social (lưu theo dự án)
}

export interface Credentials {
  wordpress: { siteUrl: string; username: string; appPassword: string; setupSite: boolean };
  blogger: { blogId: string; clientId: string; clientSecret: string; refreshToken: string };
  pinterest: { accessToken: string; sandbox: boolean };
  wix: { apiKey: string; siteId: string; memberId: string };
  googlesites: { cookies: string };
  other: { domain: string; token: string; extra: Record<string, string>; plan: OtherPlan | null };
}

export interface GeneratedPage {
  kind: "home" | "about" | "blog";
  title: string;
  slug: string;
  metaDescription: string;
  html: string;
}

export interface GeneratedContent {
  pages: GeneratedPage[];
}

export interface PublishResult {
  platform: Platform;
  ok: boolean;
  items: { label: string; url: string }[];
  error?: string;
}

/** Phiên đăng nhập hết hạn — giao diện quay về màn hình đăng nhập. */
export class NeedLoginError extends Error {}

// Giao diện và API chung 1 địa chỉ -> đường dẫn tương đối, cookie đăng nhập tự gửi kèm.
async function call<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST", signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw new Error("Đã dừng");
    throw new Error("Không kết nối được máy chủ — kiểm tra mạng rồi thử lại");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data?.needLogin) throw new NeedLoginError(data.error || "Cần đăng nhập lại");
  if (!res.ok) throw new Error(data?.error || `Máy chủ trả lỗi HTTP ${res.status}`);
  return data as T;
}

// ---------- Đăng nhập ----------

export interface Me {
  email: string;
  hasGeminiKey: boolean;
  hasSharedKey: boolean;
}

export const getMe = () => call<Me>("/api/me");
export const requestCode = (email: string) => call<{ ok: boolean; devCode?: string }>("/api/auth/request", { email });
export const verifyCode = (email: string, code: string) => call<{ email: string }>("/api/auth/verify", { email, code });
export const logout = () => call("/api/auth/logout", {});
export const saveGeminiKey = (key: string) => call<{ hasGeminiKey: boolean }>("/api/me/gemini", { key });

// ---------- Dự án ----------

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  brandName: string;
}

export interface Project {
  id: string;
  name: string;
  updatedAt: string;
  business: Partial<BusinessInfo>;
  selected: Platform[];
  sheetUrl?: string;
  credentials: Partial<Credentials>;
  savedSecrets: Record<string, boolean>; // vd { "wordpress.appPassword": true } — giá trị thật không bao giờ gửi về trình duyệt
}

export const listProjects = () => call<{ projects: ProjectSummary[] }>("/api/projects").then((r) => r.projects);
export const getProject = (id: string) => call<{ project: Project }>(`/api/projects/${id}`).then((r) => r.project);
export const deleteProject = (id: string) => call(`/api/projects/${id}`, undefined, "DELETE");
export const clearSecret = (id: string, platform: Platform, field: string) =>
  call(`/api/projects/${id}/clear-secret`, { platform, field });
export const saveProject = (p: {
  id?: string;
  name: string;
  business: BusinessInfo;
  selected: Platform[];
  sheetUrl: string;
  credentials: Partial<Credentials>; // ô để trống = giữ nguyên giá trị đã lưu
}) => call<{ project: Project }>("/api/projects", p).then((r) => r.project);

// ---------- Tạo nội dung & đăng ----------

export interface SheetResult {
  records: Partial<BusinessInfo>[];
  method: "table" | "key-value" | "ai";
  mapping: Partial<Record<keyof BusinessInfo, string>>;
}

/** Đọc Google Sheet (link) hoặc nội dung file CSV, tự nhận diện thông tin doanh nghiệp. */
export const readSheet = (input: { url?: string; csv?: string }) => call<SheetResult>("/api/sheet", input);

/** "Phương án khác": nhờ AI tìm cách kết nối 1 nền tảng bất kỳ. */
export const planOther = (domain: string) => call<{ plan: OtherPlan }>("/api/other/plan", { domain }).then((r) => r.plan);

export const generate = (business: BusinessInfo) =>
  call<{ content: GeneratedContent }>("/api/generate", { business }).then((r) => r.content);

/** Đăng lên 1 nền tảng — khoá lấy từ dự án đã lưu trên máy chủ, trình duyệt không gửi khoá. */
export async function publishOne(projectId: string, platform: Platform, business: BusinessInfo, content: GeneratedContent) {
  const r = await call<{ results: PublishResult[] }>("/api/publish", { projectId, business, content, platforms: [platform] });
  return r.results[0];
}

// ---------- Nhắc việc qua Lark ----------

export interface LarkSetting {
  configured: boolean; // quản trị đã kết nối bot ứng dụng Lark chưa (nhắn theo email)
  enabled: boolean;
  hasWebhook: boolean; // đã lưu link bot nhóm (giá trị thật không gửi về trình duyệt)
  larkEmail: string;
  thuKy: boolean;
  hocTap: boolean;
  lastError: string | null;
}

export const getLark = () => call<LarkSetting>("/api/lark");
export const saveLark = (s: { enabled: boolean; larkEmail: string; thuKy: boolean; hocTap: boolean; webhookUrl?: string }) =>
  call("/api/lark", s, "PUT");
export const testLark = () => call("/api/lark/test", {});

// ---------- Lịch sử ----------

export interface RunRecord {
  id: string;
  at: string;
  projectId?: string;
  projectName?: string;
  brandName: string;
  results: { platform: Platform; ok: boolean; urls: string[]; error?: string }[];
}

export const listRuns = () => call<{ runs: RunRecord[] }>("/api/runs").then((r) => r.runs);
export const saveRun = (run: { id: string; projectId: string; projectName: string; brandName: string; results: PublishResult[] }) =>
  call("/api/runs", run);

// ---------- Tạo social mới tự động (mẫu 4 trang) ----------
export interface SocialRecord {
  key?: string; // mã nền tảng (wpcom, netlify…) — social tạo trước 04/11 có thể thiếu
  id: string;
  at: string;
  brand: string;
  platform: string;
  siteUrl: string;
  adminUrl?: string;
  indexable?: boolean;
  pages: { label: string; url: string }[];
  check?: CheckReport; // agent kiểm tra sau khi tạo
}
export type CheckReport = { at: string; ok: boolean; summary: string; items: { label: string; url: string; status: number; ok: boolean; note?: string }[]; fixed: string[]; pending?: boolean };
export type Diagnosis = { kind: string; message: string; fix?: string; link?: string; retry: boolean; by: "rule" | "ai" };
export type SocialCreateResult = { platform: SocialPlatform; name: string; ok: boolean; error?: string; social?: SocialRecord; diagnosis?: Diagnosis; steps?: string[]; autoRetryAt?: string };
export type AgentLogItem = { at: string; platform: string; ok: boolean; text: string; link?: string };
export const getAgentLog = (project: string) => call<{ items: AgentLogItem[]; retries: { platform: string; attempt: number; due: string; firstError: string }[] }>(`/api/social/agent-log?${pq(project)}`);
export const checkSocialNow = (project: string, id: string) => call<{ ok: true; check: CheckReport; social: SocialRecord }>(`/api/social/${id}/check?${pq(project)}`, {}, "POST");
// Mọi thao tác tạo social gắn với 1 dự án (?project=) — mỗi dự án tài khoản gốc + danh sách social riêng
const pq = (project: string) => `project=${encodeURIComponent(project)}`;
export const listSocials = (project: string) => call<{ items: SocialRecord[] }>(`/api/social?${pq(project)}`);
export type SocialPlatform = "blogger" | "tumblr" | "mastodon" | "wpcom" | "netlify" | "vercel" | "github" | "codeberg" | "telegraph";
export type SocialConnections = Record<SocialPlatform, { connected: boolean; username: string | null; configured?: boolean; ownApp?: boolean; redirectUri?: string }> & {
  sheets?: { connected: boolean; username: string | null; trackSheet: string };
};
export type SheetWriteResult = { platform: string; ok: boolean; cell?: string; action?: "dien" | "them"; error?: string };
export type TrackCols = { platform: string; link: string; date: string; account: string };
export type TrackMap = { gid?: string; headerRow: number; cols: TrackCols };
export type SheetInspect = { tabs: { gid: string; title: string }[]; tab: { gid: string; title: string }; headerRow: number; columns: { col: string; text: string; sample: string }[]; cols: TrackCols; saved: boolean };
export const saveTrackSheet = (project: string, url: string, map?: TrackMap) => call<{ ok: true }>(`/api/social/track-sheet?project=${encodeURIComponent(project)}`, { url, map }, "PUT");
export const inspectTrackSheet = (project: string, gid?: string, row?: number) =>
  call<SheetInspect>(`/api/social/track-sheet/inspect?project=${encodeURIComponent(project)}${gid ? `&gid=${gid}` : ""}${row ? `&row=${row}` : ""}`);
export const writeLinksToSheet = (project: string, ids?: string[]) => call<{ ket_qua: SheetWriteResult[] }>(`/api/social/write-sheet?project=${encodeURIComponent(project)}`, { ids });
export const disconnectSheets = () => call<{ ok: true }>("/api/google/sheets", undefined, "DELETE");
export const saveWpcomApp = (clientId: string, clientSecret: string) => call<{ ok: true }>("/api/wpcom/app", { clientId, clientSecret }, "PUT");
export const deleteWpcomApp = () => call<{ ok: true }>("/api/wpcom/app", undefined, "DELETE");
export const saveGoogleApp = (clientId: string, clientSecret: string) => call<{ ok: true }>("/api/google/app", { clientId, clientSecret }, "PUT");
export const saveTumblrApp = (clientId: string, clientSecret: string) => call<{ ok: true }>("/api/tumblr/app", { clientId, clientSecret }, "PUT");
export const deleteTumblrApp = () => call<{ ok: true }>("/api/tumblr/app", undefined, "DELETE");
export const listTumblrBlogs = (project: string) => call<{ blogs: BlogInfo[] }>(`/api/social/tumblr/blogs?project=${encodeURIComponent(project)}`).then((r) => r.blogs);
export const deleteGoogleApp = () => call<{ ok: true }>("/api/google/app", undefined, "DELETE");
export type WpcomSiteInfo = { id: string; name: string; url: string; posts: number; deleted?: boolean };
export const listWpcomSites = (project: string) => call<{ sites: WpcomSiteInfo[] }>(`/api/social/wpcom/sites?project=${encodeURIComponent(project)}`).then((r) => r.sites);
export type BlogInfo = { id: string; name: string; url: string; pages: number; posts: number };
export const listBloggerBlogs = (project: string) => call<{ blogs: BlogInfo[] }>(`/api/social/blogger/blogs?project=${encodeURIComponent(project)}`).then((r) => r.blogs);
export const getSocialConnections = (project: string) => call<SocialConnections>(`/api/social/connections?${pq(project)}`);
export const saveSocialConnection = (project: string, platform: "netlify" | "vercel" | "github" | "codeberg" | "mastodon", token: string) =>
  call<{ username: string }>(`/api/social/connections/${platform}?${pq(project)}`, { token }, "PUT");
export const deleteSocialConnection = (project: string, platform: SocialPlatform) => call<{ ok: true }>(`/api/social/connections/${platform}?${pq(project)}`, undefined, "DELETE");
export const createSocial = (project: string, business: BusinessInfo, platforms: SocialPlatform[], subdomain?: string, opts: SocialOpts = {}) =>
  call<{ results: SocialCreateResult[]; source: "rules" | "ai"; note?: string; sheet?: { ok: boolean; ket_qua?: SheetWriteResult[]; error?: string } | null }>(`/api/social/create?${pq(project)}`, { business, platforms, subdomain, useAI: opts.useAI, site: opts.site, bloggerBlogId: opts.bloggerBlogId, tumblrBlog: opts.tumblrBlog, wpcomSiteId: opts.wpcomSiteId, wpcomClean: opts.wpcomClean }, "POST", opts.signal);
/** hard = true: xoá hẳn trên nền tảng (link thành 404); false: chỉ bỏ khỏi danh sách. */
export const deleteSocialRecord = (project: string, id: string, hard = false) => call<{ ok: true; note?: string }>(`/api/social/${id}?${pq(project)}${hard ? "&hard=1" : ""}`, undefined, "DELETE");
export interface BrandImage { src: string; alt: string }
export interface BrandProduct { name: string; href: string; image?: string; desc?: string }
/** Dữ liệu app đọc được từ website chính của thương hiệu (bằng quy tắc, không dùng AI). */
export interface SiteBrand {
  url: string; name: string; title: string; description: string; logo: string; ogImage: string; color: string;
  design: { primary: string; secondary: string; text: string; headingFont: string; bodyFont: string; fontsHref: string; radius: number };
  images: BrandImage[]; products: BrandProduct[]; paragraphs: string[]; phones: string[]; emails: string[]; address: string; socials: string[];
}
export interface SocialTemplate {
  siteTitle: string;
  tagline: string;
  pages: { kind: "home" | "about" | "products" | "blog"; title: string; slug: string; html: string }[];
  source: "rules" | "ai";
  note?: string;
  assets: { logo: string; cover: string; images: BrandImage[]; products: BrandProduct[]; socials: string[] };
}
export type SocialOpts = { useAI?: boolean; site?: SiteBrand | null; bloggerBlogId?: string; tumblrBlog?: string; wpcomSiteId?: string; wpcomClean?: boolean; signal?: AbortSignal };
export const scrapeSite = (url: string) => call<{ site: SiteBrand }>("/api/social/scrape", { url }).then((r) => r.site);
export const previewSocial = (business: BusinessInfo, opts: SocialOpts = {}) => call<SocialTemplate>("/api/social/preview", { business, ...opts });
