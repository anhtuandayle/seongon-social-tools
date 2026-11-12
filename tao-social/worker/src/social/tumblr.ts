// Tumblr theo "Cách 1" (giống Blogger): Tumblr không cho phần mềm tạo blog mới, không cho đổi tên/mô tả/ảnh blog
// → người dùng tạo blog tay 1 lần, kết nối Tumblr (OAuth2), chọn blog; app đăng bài Giới thiệu + Danh mục sản phẩm có ảnh, share bài về sau.
// App (Client ID/Secret) dùng chung mọi dự án của 1 người; tài khoản kết nối riêng từng dự án (owner = "<email>#<id dự án>").
import { decrypt, encrypt, randomToken } from "../store";
import type { BusinessInfo, Env } from "../types";
import { fetchJson } from "../util";
import { imageUrl } from "./site";
import type { SocialTemplate } from "./template";

export type TumblrApp = { clientId: string; clientSecret: string };
type TumblrAccount = { access: string; refresh: string; expires: number; username: string; app: TumblrApp };
const appKey = (owner: string) => `tumblr-app:${owner.split("#")[0]}`;
const accKey = (owner: string) => `tumblr:${owner}`;
const API = "https://api.tumblr.com/v2";

export async function tumblrApp(env: Env, owner: string): Promise<TumblrApp | null> {
  const a = await decrypt<TumblrApp | null>(env, (await env.DATA.get(appKey(owner))) ?? undefined, null);
  return a?.clientId && a.clientSecret ? a : null;
}
export async function saveTumblrApp(env: Env, owner: string, app: TumblrApp | null) {
  if (app) await env.DATA.put(appKey(owner), await encrypt(env, app));
  else await env.DATA.delete(appKey(owner));
}
export const tumblrRedirectUri = (env: Env) => `${(env.PUBLIC_URL || "").replace(/\/+$/, "")}/api/tumblr/callback`;
export const tumblrAccount = async (env: Env, owner: string) => decrypt<TumblrAccount | null>(env, (await env.DATA.get(accKey(owner))) ?? undefined, null);
export const tumblrDisconnect = (env: Env, owner: string) => env.DATA.delete(accKey(owner));

export async function tumblrAuthorizeUrl(env: Env, owner: string) {
  const app = await tumblrApp(env, owner);
  if (!app) throw new Error("Chưa nhập Client ID / Client Secret của app Tumblr");
  const state = randomToken(16);
  await env.DATA.put(`tumblr-state:${state}`, owner, { expirationTtl: 600 });
  const q = new URLSearchParams({ client_id: app.clientId, response_type: "code", scope: "basic write offline_access", state, redirect_uri: tumblrRedirectUri(env) });
  return `https://www.tumblr.com/oauth2/authorize?${q}`;
}

async function token(app: TumblrApp, body: Record<string, string>) {
  return fetchJson<{ access_token: string; refresh_token?: string; expires_in?: number }>("Tumblr", `${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, ...body }),
  });
}

export async function tumblrFinish(env: Env, email: string, code: string, state: string): Promise<string> {
  const owner = await env.DATA.get(`tumblr-state:${state}`);
  await env.DATA.delete(`tumblr-state:${state}`);
  if (!owner || (owner !== email && !owner.startsWith(`${email}#`))) throw new Error("Phiên kết nối Tumblr đã hết hạn — bấm Kết nối lại");
  const app = await tumblrApp(env, owner);
  if (!app) throw new Error("Chưa nhập Client ID / Client Secret của app Tumblr");
  const t = await token(app, { grant_type: "authorization_code", code, redirect_uri: tumblrRedirectUri(env) });
  const me = await fetchJson<{ response?: { user?: { name?: string } } }>("Tumblr", `${API}/user/info`, { headers: { Authorization: `Bearer ${t.access_token}` } });
  const acc: TumblrAccount = { access: t.access_token, refresh: t.refresh_token ?? "", expires: Date.now() + (t.expires_in ?? 2400) * 1000, username: me.response?.user?.name ?? "Tumblr", app };
  await env.DATA.put(accKey(owner), await encrypt(env, acc));
  return owner;
}

/** Mã truy cập còn hạn (tự làm mới; Tumblr đổi cả mã làm mới mỗi lần → lưu lại). */
async function access(env: Env, owner: string) {
  const acc = await tumblrAccount(env, owner);
  if (!acc) throw new Error("Dự án chưa kết nối Tumblr");
  if (acc.expires > Date.now() + 60_000) return acc.access;
  if (!acc.refresh) throw new Error("Kết nối Tumblr đã hết hạn — bấm Ngắt rồi Kết nối lại");
  const t = await token(acc.app, { grant_type: "refresh_token", refresh_token: acc.refresh });
  await env.DATA.put(accKey(owner), await encrypt(env, { ...acc, access: t.access_token, refresh: t.refresh_token ?? acc.refresh, expires: Date.now() + (t.expires_in ?? 2400) * 1000 }));
  return t.access_token;
}

export async function listTumblrBlogs(env: Env, owner: string) {
  const r = await fetchJson<{ response?: { user?: { blogs?: { name: string; url: string; title: string; posts?: number }[] } } }>("Tumblr", `${API}/user/info`, { headers: { Authorization: `Bearer ${await access(env, owner)}` } });
  return (r.response?.user?.blogs ?? []).map((b) => ({ id: b.name, name: b.title || b.name, url: b.url.replace(/^http:/, "https:"), posts: b.posts ?? 0 }));
}

type Block = Record<string, unknown>;
const text = (t: string, subtype?: string): Block => ({ type: "text", text: t, ...(subtype ? { subtype } : {}) });
const linkLine = (label: string, url: string): Block => ({ type: "text", text: `${label}${url}`, formatting: [{ start: label.length, end: label.length + url.length, type: "link", url }] });
const image = (u?: string): Block[] => {
  const src = imageUrl(u);
  return src ? [{ type: "image", media: [{ url: src, type: /\.png(\?|$)/i.test(src) ? "image/png" : "image/jpeg" }] }] : [];
};

async function createPost(env: Env, owner: string, blog: string, content: Block[], tags: string[]) {
  const tok = await access(env, owner);
  const r = await fetchJson<{ response?: { id?: string; id_string?: string } }>("Tumblr", `${API}/blog/${blog}/posts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content, tags: tags.join(","), state: "published" }),
  });
  const id = r.response?.id_string ?? r.response?.id;
  return `https://www.tumblr.com/${blog}/${id}`;
}

const paras = (s: string) => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 4).map((x) => text(x));

export async function createTumblrSocial(env: Env, owner: string, blog: string, tpl: SocialTemplate, biz: BusinessInfo) {
  if (!blog) throw new Error("Chưa chọn blog Tumblr — tạo blog trên Tumblr rồi chọn ở bước 3");
  const site = biz.targetUrl;
  const tags = [biz.brandName, biz.industry].filter(Boolean);
  const about = biz.about || biz.bio || tpl.tagline || "";
  const intro = await createPost(env, owner, blog, [text(`Giới thiệu ${biz.brandName}`, "heading1"), ...image(tpl.assets.cover), ...paras(about), linkLine("Website chính thức: ", site)], tags);
  const prods = tpl.assets.products.slice(0, 10);
  const products = await createPost(env, owner, blog, [
    text(`Sản phẩm và dịch vụ của ${biz.brandName}`, "heading1"),
    ...image(prods.find((p) => p.image)?.image),
    ...(prods.length
      ? prods.map((p): Block => (p.href ? { type: "text", text: `• ${p.name}`, formatting: [{ start: 2, end: 2 + p.name.length, type: "link", url: p.href }] } : text(`• ${p.name}`)))
      : [text("Danh mục sản phẩm được cập nhật tại website chính thức.")]),
    linkLine("Xem đầy đủ tại: ", site),
  ], tags);
  const url = `https://${blog}.tumblr.com/`;
  return {
    siteUrl: url,
    siteId: blog,
    pages: [{ label: "Trang chủ", url }, { label: "Giới thiệu", url: intro }, { label: "Danh mục sản phẩm", url: products }, { label: "Blog", url }],
  };
}

export async function postTumblr(env: Env, owner: string, blog: string, p: { title: string; summary: string; html: string; image?: string; link?: string }) {
  const body = p.html.replace(/<\/p>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  return createPost(env, owner, blog, [text(p.title, "heading1"), ...image(p.image), ...body.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 30).map((x) => text(x)), ...(p.link ? [linkLine("Bài gốc: ", p.link)] : [])], []);
}

/** Gỡ: xoá các bài trên blog (Tumblr không cho phần mềm xoá blog). */
export async function clearTumblr(env: Env, owner: string, blog: string) {
  const tok = await access(env, owner);
  for (let round = 0; round < 10; round++) {
    const r = await fetchJson<{ response?: { posts?: { id_string: string }[] } }>("Tumblr", `${API}/blog/${blog}/posts?limit=50`, { headers: { Authorization: `Bearer ${tok}` } });
    const posts = r.response?.posts ?? [];
    if (!posts.length) break;
    for (const p of posts) {
      await fetch(`${API}/blog/${blog}/post/delete`, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id_string }) });
    }
  }
}
