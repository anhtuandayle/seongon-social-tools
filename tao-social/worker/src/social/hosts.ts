// Tạo trang social mới trên các nền tảng lưu trữ trang tĩnh (Netlify, Vercel, GitHub Pages) và Telegraph.
// Mỗi hàm: tạo trang mới → đưa 4 trang theo mẫu lên → trả địa chỉ. Địa chỉ trùng thì tự thêm số.
import type { BusinessInfo } from "../types";
import { pushCodeberg, pushGithub } from "./post";
import { pageUrls, renderStaticSite } from "./site";
import { SOCIAL_PAGE_LABEL, socialSubdomain, type SocialTemplate } from "./template";

export type HostResult = { siteUrl: string; adminUrl?: string; siteId?: string; pages: { label: string; url: string }[] }; // siteId: để share bài về sau

const UA = { "User-Agent": "tro-ly-ai-seongon" };
async function j<T>(res: Response, who: string): Promise<T> {
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) throw Object.assign(new Error(`${who}: ${data?.message || data?.error?.message || data?.error || text.slice(0, 200) || res.status}`), { status: res.status });
  return data as T;
}
const sha1 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
};
/** Quy tắc chuẩn: có tên mong muốn thì CHỈ dùng đúng tên đó (không tự thêm số); để trống mới tự đặt theo tên thương hiệu. */
export const wantedName = (wanted?: string) => (wanted ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 50);
const names = (brand: string, wanted?: string) =>
  wantedName(wanted)
    ? [wantedName(wanted)]
    : [socialSubdomain(brand), ...[1, 2, 3].map(() => socialSubdomain(brand, `-${Math.floor(Math.random() * 9000 + 1000)}`))];
const taken = (platform: string, wanted?: string) =>
  new Error(wantedName(wanted) ? `${platform}: tên “${wantedName(wanted)}” đã có người dùng — đổi Tên trang mong muốn rồi tạo lại` : `${platform}: không tìm được địa chỉ trống — nhập Tên trang mong muốn`);

// ---------------- Netlify: ten.netlify.app ----------------
export async function createNetlify(token: string, brand: string, tpl: SocialTemplate, biz: BusinessInfo, wanted?: string, resume = false): Promise<HostResult> {
  const h = { ...UA, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  let site: { id: string; name: string; ssl_url?: string; url: string; admin_url?: string } | null = null;
  for (const name of names(brand, wanted)) {
    const r = await fetch("https://api.netlify.com/api/v1/sites", { method: "POST", headers: h, body: JSON.stringify({ name }) });
    if (r.status === 422) {
      // agent thử lại: tên này có thể chính là trang lần trước tạo dở trong tài khoản này → dùng lại
      if (resume) {
        const mine = (await fetch(`https://api.netlify.com/api/v1/sites?name=${encodeURIComponent(name)}&filter=all`, { headers: h }).then((x) => (x.ok ? x.json() : [])).catch(() => [])) as { id: string; name: string; ssl_url?: string; url: string; admin_url?: string }[];
        site = mine.find((x) => x?.name === name) ?? null;
        if (site) break;
      }
      continue; // tên đã có người dùng
    }
    site = await j(r, "Netlify");
    break;
  }
  if (!site) throw taken("Netlify", wanted);
  const base = (site.ssl_url || site.url).replace(/^http:/, "https:");
  const files = renderStaticSite(tpl, biz, base);
  const digests: Record<string, string> = {};
  const byHash = new Map<string, string>();
  for (const f of files) {
    const d = await sha1(f.content);
    digests[`/${f.path}`] = d;
    byHash.set(d, f.path);
  }
  const deploy = await j<{ id: string; required?: string[] }>(await fetch(`https://api.netlify.com/api/v1/sites/${site.id}/deploys`, { method: "POST", headers: h, body: JSON.stringify({ files: digests }) }), "Netlify");
  for (const d of deploy.required ?? []) {
    const path = byHash.get(d)!;
    const f = files.find((x) => x.path === path)!;
    await j(await fetch(`https://api.netlify.com/api/v1/deploys/${deploy.id}/files/${path.split("/").map(encodeURIComponent).join("/")}`, { method: "PUT", headers: { ...UA, Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" }, body: f.content }), "Netlify");
  }
  return { siteUrl: base, adminUrl: site.admin_url, siteId: site.id, pages: pageUrls(tpl, base) };
}

// ---------------- Vercel: ten.vercel.app ----------------
export async function createVercel(token: string, brand: string, tpl: SocialTemplate, biz: BusinessInfo, wanted?: string): Promise<HostResult> {
  const name = names(brand, wanted)[0]!;
  const guess = `https://${name}.vercel.app`;
  const files = renderStaticSite(tpl, biz, guess);
  const r = await fetch("https://api.vercel.com/v13/deployments?skipAutoDetectionConfirmation=1", {
    method: "POST",
    headers: { ...UA, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, target: "production", projectSettings: { framework: null }, files: files.map((f) => ({ file: f.path, data: f.content })) }),
  });
  const dep = await j<{ id: string; url: string; alias?: string[] }>(r, "Vercel");
  // Chờ bản dựng xong để lấy đúng địa chỉ chính (tên trùng thì Vercel tự thêm đuôi)
  let alias = dep.alias ?? [];
  for (let i = 0; i < 20 && !alias.length; i++) {
    await new Promise((res) => setTimeout(res, 2000));
    const d = await j<{ readyState?: string; alias?: string[] }>(await fetch(`https://api.vercel.com/v13/deployments/${dep.id}`, { headers: { ...UA, Authorization: `Bearer ${token}` } }), "Vercel");
    if (d.readyState === "ERROR") throw new Error("Vercel: dựng trang bị lỗi");
    alias = d.alias ?? [];
  }
  // Địa chỉ ngắn đúng tên người dùng muốn (vd ten.vercel.app). Tài khoản thuộc "team" thì Vercel tự gắn đuôi tên team
  // (ten-ten-team.vercel.app) → tự gắn thêm địa chỉ ngắn; tên đã có người dùng thì thử tên + đuôi số ngắn.
  let host = alias.find((a) => a === `${name}.vercel.app`) ?? "";
  for (const want of host ? [] : [name]) {
    // gắn vào dự án (không phải 1 bản dựng) để các lần cập nhật sau — vd share bài — vẫn giữ địa chỉ này
    const r = await fetch(`https://api.vercel.com/v10/projects/${encodeURIComponent(name)}/domains`, {
      method: "POST",
      headers: { ...UA, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: `${want}.vercel.app` }),
    });
    if (r.ok) { host = `${want}.vercel.app`; break; }
  }
  if (!host) {
    // không giành được đúng tên → xoá dự án vừa tạo, báo lỗi (không để địa chỉ dài / tên khác)
    await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(name)}`, { method: "DELETE", headers: { ...UA, Authorization: `Bearer ${token}` } }).catch(() => null);
    throw taken("Vercel", name);
  }
  const base = `https://${host}`;
  return { siteUrl: base, adminUrl: `https://vercel.com/dashboard`, siteId: name, pages: pageUrls(tpl, base) };
}

// ---------------- GitHub Pages: tai-khoan.github.io/ten ----------------
export async function createGithubPages(token: string, login: string, brand: string, tpl: SocialTemplate, biz: BusinessInfo, wanted?: string, resume = false): Promise<HostResult> {
  const h = { ...UA, Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" };
  // Trang ở ĐỊA CHỈ GỐC của tài khoản: https://<tài khoản>.github.io/ (kho phải tên đúng <tài khoản>.github.io, mỗi tài khoản 1 trang)
  const repo = `${login.toLowerCase()}.github.io`;
  const r = await fetch("https://api.github.com/user/repos", { method: "POST", headers: h, body: JSON.stringify({ name: repo, description: tpl.tagline || tpl.siteTitle, homepage: `https://${repo}/`, has_issues: false, has_wiki: false }) });
  if (r.status === 422 && resume) {
    // agent thử lại: kho trang gốc là của chính tài khoản này (lần trước tạo dở) → ghi đè nội dung + bật Pages
    const base = `https://${repo}/`;
    await pushGithub(token, `${login}/${repo}`, renderStaticSite(tpl, biz, base), "Agent dựng tiếp trang social");
    await fetch(`https://api.github.com/repos/${login}/${repo}/pages`, { method: "POST", headers: h, body: JSON.stringify({ build_type: "legacy", source: { branch: "main", path: "/" } }) }).catch(() => null);
    return { siteUrl: base, adminUrl: `https://github.com/${login}/${repo}/settings/pages`, siteId: `${login}/${repo}`, pages: pageUrls(tpl, base) };
  }
  if (r.status === 422) throw new Error(`GitHub: tài khoản ${login} đã có trang gốc https://${repo}/ — mỗi tài khoản GitHub chỉ có 1 trang gốc. Xoá kho ${repo} cũ (hoặc nút Xoá hẳn) rồi tạo lại, hoặc dùng tài khoản GitHub khác cho dự án này`);
  await j(r, "GitHub");
  const base = `https://${repo}/`;
  for (const f of renderStaticSite(tpl, biz, base)) {
    await j(await fetch(`https://api.github.com/repos/${login}/${repo}/contents/${f.path}`, { method: "PUT", headers: h, body: JSON.stringify({ message: `Thêm ${f.path}`, content: b64(f.content), branch: "main" }) }), "GitHub");
  }
  const pages = await fetch(`https://api.github.com/repos/${login}/${repo}/pages`, { method: "POST", headers: h, body: JSON.stringify({ build_type: "legacy", source: { branch: "main", path: "/" } }) });
  if (!pages.ok && pages.status !== 409) await j(pages, "GitHub Pages");
  return { siteUrl: base, adminUrl: `https://github.com/${login}/${repo}/settings/pages`, siteId: `${login}/${repo}`, pages: pageUrls(tpl, base) };
}

// ---------------- Codeberg Pages: tai-khoan.codeberg.page/ten (nhánh "pages" của kho) ----------------
export async function createCodebergPages(token: string, login: string, brand: string, tpl: SocialTemplate, biz: BusinessInfo, wanted?: string, resume = false): Promise<HostResult> {
  const h = { ...UA, Authorization: `token ${token}`, "Content-Type": "application/json", Accept: "application/json" };
  // Trang ở ĐỊA CHỈ GỐC của tài khoản: https://<tài khoản>.codeberg.page/ (kho phải tên "pages", mỗi tài khoản 1 trang)
  const repo = "pages";
  const r = await fetch("https://codeberg.org/api/v1/user/repos", { method: "POST", headers: h, body: JSON.stringify({ name: repo, description: tpl.tagline || tpl.siteTitle, website: `https://${login.toLowerCase()}.codeberg.page/`, auto_init: true, default_branch: "pages", private: false }) });
  if (r.status === 409 && resume) {
    const base = `https://${login.toLowerCase()}.codeberg.page/`;
    await pushCodeberg(token, `${login}/${repo}`, renderStaticSite(tpl, biz, base), "Agent dựng tiếp trang social");
    return { siteUrl: base, adminUrl: `https://codeberg.org/${login}/${repo}`, siteId: `${login}/${repo}`, pages: pageUrls(tpl, base) };
  }
  if (r.status === 409) throw new Error(`Codeberg: tài khoản ${login} đã có trang gốc (kho "pages") — mỗi tài khoản chỉ có 1 trang gốc. Xoá kho đó rồi tạo lại, hoặc dùng tài khoản Codeberg khác`);
  await j(r, "Codeberg");
  const base = `https://${login.toLowerCase()}.codeberg.page/`;
  const files = renderStaticSite(tpl, biz, base);
  await j(
    await fetch(`https://codeberg.org/api/v1/repos/${login}/${repo}/contents`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ branch: "pages", message: "Tạo trang social", files: files.map((f) => ({ operation: "create", path: f.path, content: b64(f.content) })) }),
    }),
    "Codeberg",
  );
  return { siteUrl: base, adminUrl: `https://codeberg.org/${login}/${repo}`, siteId: `${login}/${repo}`, pages: pageUrls(tpl, base) };
}

// ---------------- Telegraph: telegra.ph/… (không cần tài khoản) ----------------
type TNode = string | { tag: string; attrs?: Record<string, string>; children?: TNode[] };
const T_ALLOWED = new Set(["a", "b", "blockquote", "br", "em", "h3", "h4", "hr", "i", "li", "ol", "p", "strong", "u", "ul", "figure", "img", "figcaption"]);

/** HTML đơn giản (h2/h3/p/ul/li/a/strong…) → định dạng nút của Telegraph. h2→h3, h3→h4. */
export function htmlToTelegraph(html: string): TNode[] {
  const root: { tag: string; children: TNode[] } = { tag: "root", children: [] };
  const stack: { tag: string; attrs?: Record<string, string>; children: TNode[] }[] = [root];
  const re = /<\/?([a-z0-9]+)([^>]*)>|([^<]+)/gi;
  let m: RegExpExecArray | null;
  const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  while ((m = re.exec(html))) {
    if (m[3] !== undefined) {
      const text = decode(m[3]);
      if (text.trim() || stack.length > 1) stack[stack.length - 1]!.children.push(text);
      continue;
    }
    let tag = m[1]!.toLowerCase();
    tag = tag === "h2" ? "h3" : tag === "h3" ? "h4" : tag === "h1" ? "h3" : tag;
    const closing = m[0].startsWith("</");
    if (!T_ALLOWED.has(tag)) continue;
    if (closing) {
      const i = stack.map((s) => s.tag).lastIndexOf(tag);
      if (i > 0) stack.length = i;
      continue;
    }
    const attrs: Record<string, string> = {};
    const href = m[2]!.match(/href=["']([^"']+)["']/i);
    if (tag === "a" && href) attrs.href = href[1]!;
    const src = m[2]!.match(/src=["']([^"']+)["']/i);
    if (tag === "img") { if (!src || !/^https?:/.test(src[1]!)) continue; attrs.src = decode(src[1]!); }
    const node = { tag, ...(Object.keys(attrs).length ? { attrs } : {}), children: [] as TNode[] };
    stack[stack.length - 1]!.children.push(node);
    if (!["br", "hr", "img"].includes(tag)) stack.push(node);
  }
  return root.children;
}

export async function telegraphAccount(brand: string, targetUrl: string): Promise<string> {
  const r = await j<{ ok: boolean; result?: { access_token: string }; error?: string }>(
    await fetch("https://api.telegra.ph/createAccount", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ short_name: brand.slice(0, 32) || "social", author_name: brand.slice(0, 128), author_url: targetUrl }) }),
    "Telegraph",
  );
  if (!r.ok || !r.result) throw new Error(`Telegraph: ${r.error ?? "không tạo được tài khoản"}`);
  return r.result.access_token;
}

export async function createTelegraph(accessToken: string, tpl: SocialTemplate, biz: BusinessInfo): Promise<HostResult> {
  const make = async (title: string, content: TNode[]) => {
    const r = await j<{ ok: boolean; result?: { url: string }; error?: string }>(
      await fetch("https://api.telegra.ph/createPage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access_token: accessToken, title: title.slice(0, 256), author_name: biz.brandName.slice(0, 128), author_url: biz.targetUrl, content, return_content: false }) }),
      "Telegraph",
    );
    if (!r.ok || !r.result) throw new Error(`Telegraph: ${r.error ?? "không tạo được trang"}`);
    return r.result.url;
  };
  // Trang con trước, Trang chủ sau cùng (có menu link tới các trang con)
  const urls: Partial<Record<string, string>> = {};
  for (const p of tpl.pages.filter((x) => x.kind !== "home")) {
    const body = p.kind === "blog" ? [{ tag: "p", children: [`Bài viết của ${biz.brandName} sẽ được cập nhật tại đây.`] }] : htmlToTelegraph(p.html);
    urls[p.kind] = await make(`${p.title} — ${tpl.siteTitle}`, body);
  }
  const home = tpl.pages.find((x) => x.kind === "home")!;
  const menu: TNode = {
    tag: "p",
    children: tpl.pages
      .filter((x) => x.kind !== "home")
      .flatMap((x, i) => [...(i ? [" · "] : []), { tag: "a", attrs: { href: urls[x.kind]! }, children: [SOCIAL_PAGE_LABEL[x.kind]] } as TNode]),
  };
  urls.home = await make(tpl.siteTitle, [menu, ...htmlToTelegraph(home.html)]);
  return { siteUrl: urls.home!, siteId: new URL(urls.blog!).pathname.slice(1), pages: tpl.pages.map((p) => ({ label: SOCIAL_PAGE_LABEL[p.kind], url: urls[p.kind]! })) };
}
