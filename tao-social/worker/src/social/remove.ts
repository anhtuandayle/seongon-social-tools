// Xoá hẳn trang social trên chính nền tảng (link thành 404) — để Google không thấy nội dung trùng lặp khi tạo lại.
// Nền tảng không cho xoá qua cổng (Blogger: blog; Telegraph: trang) thì gỡ sạch nội dung và báo phần còn lại phải làm tay.
import type { Env } from "../types";
import { bloggerAccount } from "./blogger";
import { getConns } from "./connections";
import { wpcomAccount } from "./wpcom";
import { clearMastodon } from "./mastodon";
import { clearTumblr } from "./tumblr";

export type RemovableRecord = { key?: string; platform: string; siteUrl: string; siteId?: string; pages: { label: string; url: string }[] };
const UA = { "User-Agent": "tro-ly-ai-seongon" };

async function ok(res: Response, who: string, allow404 = true) {
  if (res.ok || (allow404 && res.status === 404)) return;
  const t = await res.text().catch(() => "");
  let msg = t.slice(0, 200);
  try { const j = JSON.parse(t); msg = j.message || j.error?.message || j.error || msg; } catch {}
  throw Object.assign(new Error(`${who}: ${msg || res.status}`), { status: res.status });
}

const keyOf = (r: RemovableRecord) =>
  r.key ?? ({ "WordPress.com": "wpcom", Blogger: "blogger", Netlify: "netlify", Vercel: "vercel", "GitHub Pages": "github", "Codeberg Pages": "codeberg", Telegraph: "telegraph", Mastodon: "mastodon", Tumblr: "tumblr" } as Record<string, string>)[r.platform] ?? "";

/** Trả { full: true } nếu đã xoá hẳn; full: false kèm note nếu chỉ gỡ được nội dung, phần còn lại cần làm tay. */
export async function removeOnPlatform(env: Env, owner: string, r: RemovableRecord): Promise<{ full: boolean; note?: string }> {
  const k = keyOf(r);
  const host = new URL(r.siteUrl).hostname;
  const conns = await getConns(env, owner);
  const need = (p: "netlify" | "vercel" | "github" | "codeberg") => {
    const c = conns[p];
    if (!c) throw new Error(`Dự án chưa kết nối ${r.platform} nên không xoá được — kết nối lại tài khoản đã tạo trang này, hoặc tự xoá trên ${r.platform}`);
    return c.token;
  };
  if (k === "netlify") {
    await ok(await fetch(`https://api.netlify.com/api/v1/sites/${r.siteId || host}`, { method: "DELETE", headers: { ...UA, Authorization: `Bearer ${need("netlify")}` } }), "Netlify");
    return { full: true };
  }
  if (k === "vercel") {
    const project = r.siteId || host.replace(/\.vercel\.app$/, "");
    await ok(await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(project)}`, { method: "DELETE", headers: { ...UA, Authorization: `Bearer ${need("vercel")}` } }), "Vercel");
    return { full: true };
  }
  if (k === "github" || k === "codeberg") {
    const sub = new URL(r.siteUrl).pathname.split("/").filter(Boolean)[0];
    const repo = r.siteId || `${host.split(".")[0]}/${sub ?? (k === "github" ? host : "pages")}`; // không có đường dẫn = trang gốc của tài khoản
    const res = k === "github"
      ? await fetch(`https://api.github.com/repos/${repo}`, { method: "DELETE", headers: { ...UA, Authorization: `Bearer ${need("github")}`, Accept: "application/vnd.github+json" } })
      : await fetch(`https://codeberg.org/api/v1/repos/${repo}`, { method: "DELETE", headers: { ...UA, Authorization: `token ${need("codeberg")}` } });
    if (k === "github" && res.status === 403) {
      throw new Error(`GitHub: mã truy cập chưa có quyền xoá kho (delete_repo). Tự xoá tại https://github.com/${repo}/settings (cuối trang: Delete this repository), hoặc tạo mã mới tích thêm delete_repo rồi kết nối lại`);
    }
    await ok(res, r.platform);
    return { full: true };
  }
  if (k === "wpcom") {
    const acc = await wpcomAccount(env, owner);
    if (!acc) throw new Error("Dự án chưa kết nối WordPress.com nên không xoá được");
    await ok(await fetch(`https://public-api.wordpress.com/rest/v1.1/sites/${r.siteId || host}/delete`, { method: "POST", headers: { Authorization: `Bearer ${acc.token}` } }), "WordPress.com");
    return { full: true };
  }
  if (k === "blogger") {
    // Google không cho xoá blog qua cổng → xoá hết trang + bài trên blog (hết nội dung trùng), blog trống thì tự xoá tay
    const acc = await bloggerAccount(env, owner);
    if (!acc || !r.siteId) throw new Error("Dự án chưa kết nối Blogger nên không gỡ được — tự xoá blog trong Blogger → Cài đặt → Xoá blog");
    const t = (await (await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: acc.app.clientId, client_secret: acc.app.clientSecret, refresh_token: acc.refreshToken, grant_type: "refresh_token" }),
    })).json()) as { access_token?: string };
    const h = { Authorization: `Bearer ${t.access_token}` };
    const api = `https://www.googleapis.com/blogger/v3/blogs/${r.siteId}`;
    for (const kind of ["pages", "posts"]) {
      const list = (await (await fetch(`${api}/${kind}?status=live&status=draft&maxResults=200`, { headers: h })).json().catch(() => ({}))) as { items?: { id: string }[] };
      for (const it of list.items ?? []) await ok(await fetch(`${api}/${kind}/${it.id}`, { method: "DELETE", headers: h }), "Blogger");
    }
    return { full: false, note: `Đã xoá hết trang và bài trên ${r.siteUrl}. Google không cho phần mềm xoá cả blog — muốn gỡ hẳn địa chỉ thì vào Blogger → Cài đặt → Xoá blog.` };
  }
  if (k === "tumblr") {
    if (!r.siteId) throw new Error("Không rõ blog Tumblr nào — tự xoá trong Tumblr");
    await clearTumblr(env, owner, r.siteId);
    return { full: false, note: `Đã xoá các bài trên blog ${r.siteUrl}. Tumblr không cho phần mềm xoá blog — muốn gỡ hẳn: Tumblr → Cài đặt blog → Xoá blog.` };
  }
  if (k === "mastodon") {
    const m = conns.mastodon;
    if (!m || !r.siteId) throw new Error("Dự án chưa kết nối Mastodon nên không gỡ được");
    await clearMastodon(m.token, r.siteId);
    return { full: false, note: "Đã xoá các bài trên tài khoản Mastodon. Mastodon không cho phần mềm xoá tài khoản — muốn xoá hẳn: Cài đặt → Tài khoản → Xoá tài khoản." };
  }
  if (k === "telegraph") {
    // Telegraph không có lệnh xoá → thay nội dung mọi trang bằng 1 dòng "đã gỡ" (hết nội dung trùng lặp)
    const tg = conns.telegraph;
    if (!tg) throw new Error("Không tìm thấy tài khoản Telegraph của dự án");
    for (const p of r.pages) {
      const path = decodeURIComponent(new URL(p.url).pathname.slice(1));
      await fetch(`https://api.telegra.ph/editPage/${encodeURIComponent(path)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: tg.token, title: "Trang đã gỡ", content: [{ tag: "p", children: ["Trang này đã được gỡ."] }] }),
      });
    }
    return { full: false, note: "Telegraph không cho xoá trang — app đã thay toàn bộ nội dung bằng dòng “Trang này đã được gỡ” nên không còn nội dung trùng." };
  }
  throw new Error(`Chưa hỗ trợ xoá trên ${r.platform}`);
}
