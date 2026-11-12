// Blogger theo "Cách 1": Google không cho phần mềm tạo blog mới → người dùng tạo blog trống bằng tay 1 lần (đặt tên + địa chỉ),
// rồi kết nối Google (Blogger API v3, OAuth). Bấm "Tạo social" là app tự dựng trang Trang chủ · Giới thiệu · Danh mục sản phẩm
// trên blog đó (có logo, ảnh, màu thương hiệu), blog chính là trang Blog. Không lưu mật khẩu — chỉ mã làm mới (refresh token) đã mã hoá.
import { decrypt, encrypt, randomToken } from "../store";
import type { BusinessInfo, Env } from "../types";
import { fetchJson } from "../util";
import { SOCIAL_PAGE_LABEL, type SocialTemplate } from "./template";

export type GoogleApp = { clientId: string; clientSecret: string };
export type BloggerAccount = { refreshToken: string; username: string; connectedAt: string; app: GoogleApp };

const API = "https://www.googleapis.com/blogger/v3";
// App (Client ID/Secret) dùng chung cho mọi dự án của 1 người; tài khoản kết nối thì riêng từng dự án (owner = "<email>#<id dự án>")
const appKey = (owner: string) => `google-app:${owner.split("#")[0]}`;
const accKey = (owner: string) => `blogger:${owner}`;

export async function googleApp(env: Env, owner: string): Promise<GoogleApp | null> {
  const own = await decrypt<GoogleApp | null>(env, (await env.DATA.get(appKey(owner))) ?? undefined, null);
  return own?.clientId && own.clientSecret ? own : null;
}
export async function saveGoogleApp(env: Env, owner: string, app: GoogleApp | null) {
  if (app) await env.DATA.put(appKey(owner), await encrypt(env, app));
  else await env.DATA.delete(appKey(owner));
}
export const googleRedirectUri = (env: Env) => `${(env.PUBLIC_URL || "").replace(/\/+$/, "")}/api/google/callback`;

export async function bloggerAuthorizeUrl(env: Env, owner: string) {
  const app = await googleApp(env, owner);
  if (!app) throw new Error("Chưa nhập Client ID / Client Secret của Google");
  const state = randomToken(16);
  await env.DATA.put(`google-state:${state}`, owner, { expirationTtl: 600 });
  const q = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: googleRedirectUri(env),
    response_type: "code",
    scope: "https://www.googleapis.com/auth/blogger https://www.googleapis.com/auth/userinfo.email",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

/** Đổi mã Google trả về thành refresh token, lưu (mã hoá) cho đúng dự án đã bấm Kết nối. Trả owner. */
export async function bloggerFinish(env: Env, email: string, code: string, state: string): Promise<string> {
  const owner = await env.DATA.get(`google-state:${state}`);
  await env.DATA.delete(`google-state:${state}`);
  if (!owner || (owner !== email && !owner.startsWith(`${email}#`))) throw new Error("Phiên kết nối Google đã hết hạn — bấm Kết nối lại");
  const app = await googleApp(env, owner);
  if (!app) throw new Error("Chưa nhập Client ID / Client Secret của Google");
  const tok = await fetchJson<{ access_token?: string; refresh_token?: string }>("Google", "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: googleRedirectUri(env), code, grant_type: "authorization_code" }),
  });
  if (!tok.refresh_token) throw new Error("Google không trả mã làm mới — vào myaccount.google.com/permissions gỡ quyền app rồi kết nối lại");
  const me = await fetchJson<{ email?: string }>("Google", "https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } }).catch(() => ({ email: "" }));
  const acc: BloggerAccount = { refreshToken: tok.refresh_token, username: me.email || "Google", connectedAt: new Date().toISOString(), app };
  await env.DATA.put(accKey(owner), await encrypt(env, acc));
  return owner;
}

export const bloggerAccount = async (env: Env, owner: string) => decrypt<BloggerAccount | null>(env, (await env.DATA.get(accKey(owner))) ?? undefined, null);
export const bloggerDisconnect = (env: Env, owner: string) => env.DATA.delete(accKey(owner));

async function accessToken(acc: BloggerAccount) {
  const t = await fetchJson<{ access_token?: string }>("Google", "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: acc.app.clientId, client_secret: acc.app.clientSecret, refresh_token: acc.refreshToken, grant_type: "refresh_token" }),
  });
  if (!t.access_token) throw new Error("Kết nối Google đã hết hạn — bấm Ngắt rồi Kết nối Blogger lại");
  return t.access_token;
}

export type BlogInfo = { id: string; name: string; url: string; pages: number; posts: number };

/** Các blog của tài khoản đã kết nối — người dùng chọn blog trống vừa tạo để dựng social. */
export async function listBlogs(acc: BloggerAccount): Promise<BlogInfo[]> {
  const token = await accessToken(acc);
  type R = { items?: { id: string; name: string; url: string; pages?: { totalItems?: number }; posts?: { totalItems?: number } }[] };
  const get = (q: string) => fetchJson<R>("Blogger", `${API}/users/self/blogs${q}`, { headers: { Authorization: `Bearer ${token}` } });
  // Một số tài khoản Google bị Blogger trả 400 khi kèm view=ADMIN → thử lại không kèm tham số
  const r = await get("?view=ADMIN").catch(() =>
    get("").catch((e) => {
      throw new Error(
        `Google chưa cho xem danh sách blog (${e instanceof Error ? e.message : e}). Kiểm tra: (1) Gmail đã kết nối chính là Gmail tạo blog; (2) đã vào blogger.com tạo ít nhất 1 blog; (3) Blogger API đã bật (Enable) trong Google Cloud. Xong bấm Tải lại.`,
      );
    }),
  );
  return (r.items ?? []).map((b) => ({ id: b.id, name: b.name, url: b.url.replace(/^http:/, "https:"), pages: b.pages?.totalItems ?? 0, posts: b.posts?.totalItems ?? 0 }));
}

/**
 * Dựng social trên blog đã chọn: tạo (hoặc cập nhật nếu đã có cùng tên) các trang Trang chủ, Giới thiệu, Danh mục sản phẩm.
 * Blog chính là trang Blog (danh sách bài, để trống). Nội dung đã có khối thương hiệu (logo, ảnh, màu).
 */
export async function createBloggerSocial(acc: BloggerAccount, blogId: string, tpl: SocialTemplate, biz: BusinessInfo) {
  if (!/^\d{5,30}$/.test(blogId)) throw new Error("Chưa chọn blog Blogger — tạo blog trống trên Blogger rồi chọn ở bước 3");
  const token = await accessToken(acc);
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const blog = await fetchJson<{ url: string; name: string }>("Blogger", `${API}/blogs/${blogId}`, { headers: auth });
  const existing = await fetchJson<{ items?: { id: string; title: string; url: string }[] }>("Blogger", `${API}/blogs/${blogId}/pages?status=live&status=draft`, { headers: auth }).catch(() => ({ items: [] }));
  const pages: { label: string; url: string }[] = [];
  for (const p of tpl.pages.filter((x) => x.kind !== "blog")) {
    const title = p.kind === "home" ? `${biz.brandName} – Trang chủ` : p.title;
    const old = (existing.items ?? []).find((x) => x.title.trim().toLowerCase() === title.toLowerCase());
    const body = JSON.stringify({ title, content: p.html });
    const saved = old
      ? await fetchJson<{ url: string }>("Blogger", `${API}/blogs/${blogId}/pages/${old.id}?publish=true`, { method: "PUT", headers: auth, body: JSON.stringify({ id: old.id, title, content: p.html }) })
      : await fetchJson<{ url: string }>("Blogger", `${API}/blogs/${blogId}/pages?isDraft=false`, { method: "POST", headers: auth, body });
    pages.push({ label: SOCIAL_PAGE_LABEL[p.kind], url: saved.url.replace(/^http:/, "https:") });
  }
  const siteUrl = blog.url.replace(/^http:/, "https:");
  pages.push({ label: SOCIAL_PAGE_LABEL.blog, url: siteUrl });
  return { siteUrl, adminUrl: `https://www.blogger.com/blog/pages/${blogId}`, siteId: blogId, pages };
}
