// Share bài lên các trang social ĐÃ TẠO bằng Trợ lý tạo social — dùng tài khoản đã kết nối của dự án, không cần chọn/kết nối lại.
// Trang tĩnh (Netlify, Vercel, GitHub, Codeberg): thêm trang blog/<slug>/, cập nhật danh sách trang Blog + sitemap rồi đưa lên lại.
// WordPress.com, Blogger: đăng bài qua cổng chính thức. Telegraph: tạo trang bài + cập nhật trang Blog.
import type { BusinessInfo, Env } from "../types";
import { escapeAttr, escapeHtml, slugify } from "../util";
import { bloggerAccount } from "./blogger";
import { getConns } from "./connections";
import { htmlToTelegraph } from "./hosts";
import { renderStaticSite, type SiteFile, type SitePost } from "./site";
import type { SocialTemplate } from "./template";
import { wpcomAccount } from "./wpcom";
import { postMastodon } from "./mastodon";
import { postTumblr } from "./tumblr";

/** Ảnh chụp lúc tạo social — đủ để dựng lại trang tĩnh khi thêm bài. Lưu ở KV `social-site:<owner>:<id>`. */
export type SiteSnapshot = { platform: string; siteId: string; base: string; tpl: SocialTemplate; biz: BusinessInfo; posts: SitePost[] };
export const snapKey = (owner: string, id: string) => `social-site:${owner}:${id}`;

export type SharePost = { title: string; html: string; summary: string; image?: string; link?: string };

const UA = { "User-Agent": "tro-ly-ai-seongon" };
async function j<T>(res: Response, who: string): Promise<T> {
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw new Error(`${who}: ${data?.message || data?.error?.message || data?.error || text.slice(0, 200) || res.status}`);
  return data as T;
}
const sha1 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
};

/** Chữ thường → HTML đoạn văn; link gốc gắn cuối bài. */
export function textToHtml(text: string, sourceUrl?: string) {
  const paras = text.replace(/\r/g, "").split(/\n{2,}|\n/).map((x) => x.trim()).filter(Boolean)
    .map((x) => `<p>${escapeHtml(x).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${escapeAttr(u)}">${u}</a>`)}</p>`);
  if (sourceUrl && !text.includes(sourceUrl)) paras.push(`<p>Xem bài gốc: <a href="${escapeAttr(sourceUrl)}">${escapeHtml(sourceUrl)}</a></p>`);
  return paras.join("");
}

// ---------- đưa trang tĩnh lên lại ----------

async function deployNetlify(token: string, siteId: string, files: SiteFile[]) {
  const h = { ...UA, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const digests: Record<string, string> = {};
  const byHash = new Map<string, SiteFile>();
  for (const f of files) { const d = await sha1(f.content); digests[`/${f.path}`] = d; byHash.set(d, f); }
  const dep = await j<{ id: string; required?: string[] }>(await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys`, { method: "POST", headers: h, body: JSON.stringify({ files: digests }) }), "Netlify");
  for (const d of dep.required ?? []) {
    const f = byHash.get(d)!;
    await j(await fetch(`https://api.netlify.com/api/v1/deploys/${dep.id}/files/${f.path.split("/").map(encodeURIComponent).join("/")}`, { method: "PUT", headers: { ...UA, Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" }, body: f.content }), "Netlify");
  }
}

async function deployVercel(token: string, project: string, files: SiteFile[]) {
  await j(await fetch("https://api.vercel.com/v13/deployments?skipAutoDetectionConfirmation=1", {
    method: "POST",
    headers: { ...UA, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: project, target: "production", projectSettings: { framework: null }, files: files.map((f) => ({ file: f.path, data: f.content })) }),
  }), "Vercel");
}

/** GitHub: chỉ ghi các file thay đổi (bài mới, trang Blog, Trang chủ, sitemap). */
export async function pushGithub(token: string, repoPath: string, files: SiteFile[], message: string) {
  const h = { ...UA, Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" };
  for (const f of files) {
    const cur = await fetch(`https://api.github.com/repos/${repoPath}/contents/${f.path}?ref=main`, { headers: h });
    const sha = cur.ok ? ((await cur.json()) as { sha?: string }).sha : undefined;
    await j(await fetch(`https://api.github.com/repos/${repoPath}/contents/${f.path}`, { method: "PUT", headers: h, body: JSON.stringify({ message, content: b64(f.content), branch: "main", ...(sha ? { sha } : {}) }) }), "GitHub");
  }
}

export async function pushCodeberg(token: string, repoPath: string, files: SiteFile[], message: string) {
  const h = { ...UA, Authorization: `token ${token}`, "Content-Type": "application/json", Accept: "application/json" };
  const ops = [];
  for (const f of files) {
    const cur = await fetch(`https://codeberg.org/api/v1/repos/${repoPath}/contents/${f.path}?ref=pages`, { headers: h });
    const sha = cur.ok ? ((await cur.json()) as { sha?: string }).sha : undefined;
    ops.push({ operation: sha ? "update" : "create", path: f.path, content: b64(f.content), ...(sha ? { sha } : {}) });
  }
  await j(await fetch(`https://codeberg.org/api/v1/repos/${repoPath}/contents`, { method: "POST", headers: h, body: JSON.stringify({ branch: "pages", message, files: ops }) }), "Codeberg");
}

/** Agent dựng lại toàn bộ trang tĩnh (Netlify/Vercel/GitHub/Codeberg) từ ảnh chụp đã lưu — dùng khi kiểm tra thấy thiếu trang. */
export async function redeploySite(env: Env, owner: string, snap: SiteSnapshot): Promise<boolean> {
  const p = snap.platform as "netlify" | "vercel" | "github" | "codeberg";
  if (!["netlify", "vercel", "github", "codeberg"].includes(p)) return false;
  const c = (await getConns(env, owner))[p];
  if (!c) throw new Error("Dự án đã ngắt kết nối nền tảng này");
  const files = renderStaticSite(snap.tpl, snap.biz, snap.base, snap.posts);
  if (p === "netlify") await deployNetlify(c.token, snap.siteId, files);
  else if (p === "vercel") await deployVercel(c.token, snap.siteId, files);
  else if (p === "github") await pushGithub(c.token, snap.siteId, files, "Agent dựng lại trang còn thiếu");
  else await pushCodeberg(c.token, snap.siteId, files, "Agent dựng lại trang còn thiếu");
  return true;
}

/** Đăng 1 bài lên 1 social đã tạo. Trả link công khai của bài. */
export async function postToSocial(env: Env, owner: string, snap: SiteSnapshot, post: SharePost): Promise<{ url: string; snap: SiteSnapshot }> {
  const p = snap.platform;
  if (p === "wpcom") {
    const acc = await wpcomAccount(env, owner);
    if (!acc) throw new Error("Dự án chưa kết nối WordPress.com");
    const body = { title: post.title, content: (post.image ? `<figure><img src="${escapeAttr(post.image)}" alt="${escapeAttr(post.title)}"></figure>` : "") + post.html, excerpt: post.summary, status: "publish" };
    // bộ lệnh mới, chế độ "bọc kết quả" (_envelope) để luôn nhận đủ phản hồi
    const v2 = await fetch(`https://public-api.wordpress.com/wp/v2/sites/${snap.siteId}/posts?_envelope=1`, { method: "POST", headers: { Authorization: `Bearer ${acc.token}`, "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (compatible; TroLyAI-SEONGON/1.0)" }, body: JSON.stringify(body) });
    const wrap = (await v2.json().catch(() => null)) as { status?: number; body?: { link?: string } } | null;
    if (wrap && (wrap.status ?? 200) < 400 && wrap.body?.link) return { url: wrap.body.link, snap };
    const r = await j<{ URL: string }>(await fetch(`https://public-api.wordpress.com/rest/v1.1/sites/${snap.siteId}/posts/new`, {
      method: "POST",
      headers: { Authorization: `Bearer ${acc.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: post.title, content: (post.image ? `<figure><img src="${escapeAttr(post.image)}" alt="${escapeAttr(post.title)}"></figure>` : "") + post.html, excerpt: post.summary, status: "publish" }),
    }), "WordPress.com");
    return { url: r.URL, snap };
  }
  if (p === "blogger") {
    const acc = await bloggerAccount(env, owner);
    if (!acc) throw new Error("Dự án chưa kết nối Blogger");
    const t = await j<{ access_token?: string }>(await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: acc.app.clientId, client_secret: acc.app.clientSecret, refresh_token: acc.refreshToken, grant_type: "refresh_token" }),
    }), "Google");
    const r = await j<{ url: string }>(await fetch(`https://www.googleapis.com/blogger/v3/blogs/${snap.siteId}/posts/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: post.title, content: (post.image ? `<p><img src="${escapeAttr(post.image)}" alt="${escapeAttr(post.title)}" style="max-width:100%"></p>` : "") + post.html }),
    }), "Blogger");
    return { url: r.url.replace(/^http:/, "https:"), snap };
  }
  const conns = await getConns(env, owner);
  if (p === "tumblr") return { url: await postTumblr(env, owner, snap.siteId, post), snap };
  if (p === "mastodon") {
    const m = conns.mastodon;
    if (!m) throw new Error("Dự án chưa kết nối Mastodon");
    return { url: await postMastodon(m.token, post), snap };
  }
  if (p === "telegraph") {
    const tg = conns.telegraph;
    if (!tg) throw new Error("Không tìm thấy tài khoản Telegraph của dự án");
    const call = async (method: string, body: object) => {
      const r = await j<{ ok: boolean; result?: { url: string }; error?: string }>(await fetch(`https://api.telegra.ph/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access_token: tg.token, ...body }) }), "Telegraph");
      if (!r.ok || !r.result) throw new Error(`Telegraph: ${r.error ?? "lỗi"}`);
      return r.result.url;
    };
    const content = htmlToTelegraph((post.image ? `<figure><img src="${escapeAttr(post.image)}"></figure>` : "") + post.html);
    const url = await call("createPage", { title: post.title.slice(0, 256), author_name: snap.biz.brandName.slice(0, 128), author_url: snap.biz.targetUrl, content });
    const posts = [{ slug: url, title: post.title, html: "", summary: post.summary, date: new Date().toISOString() }, ...snap.posts];
    // cập nhật trang Blog: danh sách bài mới nhất
    await call(`editPage/${snap.siteId}`, {
      title: `Blog — ${snap.tpl.siteTitle}`.slice(0, 256),
      author_name: snap.biz.brandName.slice(0, 128),
      author_url: snap.biz.targetUrl,
      content: [{ tag: "ul", children: posts.slice(0, 100).map((x) => ({ tag: "li", children: [{ tag: "a", attrs: { href: x.slug }, children: [x.title] }] })) }],
    }).catch(() => null);
    return { url, snap: { ...snap, posts } };
  }

  // trang tĩnh: thêm bài, dựng lại, đưa lên
  const used = new Set(snap.posts.map((x) => x.slug));
  let slug = slugify(post.title).slice(0, 70) || "bai-viet";
  for (let i = 2; used.has(slug); i++) slug = `${slugify(post.title).slice(0, 66)}-${i}`;
  const posts = [...snap.posts, { slug, title: post.title, html: post.html, summary: post.summary, image: post.image, date: new Date().toISOString() }];
  const all = renderStaticSite(snap.tpl, snap.biz, snap.base, posts);
  const changed = all.filter((f) => f.path === `blog/${slug}/index.html` || f.path === "blog/index.html" || f.path === "index.html" || f.path === "sitemap.xml");
  const msg = `Thêm bài: ${post.title}`.slice(0, 120);
  if (p === "netlify") { const t = conns.netlify; if (!t) throw new Error("Dự án chưa kết nối Netlify"); await deployNetlify(t.token, snap.siteId, all); }
  else if (p === "vercel") { const t = conns.vercel; if (!t) throw new Error("Dự án chưa kết nối Vercel"); await deployVercel(t.token, snap.siteId, all); }
  else if (p === "github") { const t = conns.github; if (!t) throw new Error("Dự án chưa kết nối GitHub"); await pushGithub(t.token, snap.siteId, changed, msg); }
  else if (p === "codeberg") { const t = conns.codeberg; if (!t) throw new Error("Dự án chưa kết nối Codeberg"); await pushCodeberg(t.token, snap.siteId, changed, msg); }
  else throw new Error(`Chưa hỗ trợ share lên ${p}`);
  const base = snap.base.endsWith("/") ? snap.base : `${snap.base}/`;
  return { url: `${base}blog/${slug}/`, snap: { ...snap, posts } };
}
