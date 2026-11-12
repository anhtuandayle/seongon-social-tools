// Dựng trang tĩnh theo mẫu 4 trang (dùng cho Netlify, Vercel, GitHub Pages…): menu, màu thương hiệu,
// thẻ mô tả cho Google, sitemap.xml + robots.txt để Google quét và index.
import type { BusinessInfo } from "../types";
import { escapeAttr, escapeHtml } from "../util";
import { luminance } from "./scrape";
import { SOCIAL_PAGE_LABEL, type SocialPageKind, type SocialTemplate } from "./template";

export type SiteFile = { path: string; content: string }; // path không có "/" đầu, vd "gioi-thieu/index.html"
/** Bài share lên trang social (mỗi bài 1 trang blog/<slug>/, hiện trong danh sách trang Blog + sitemap). */
export type SitePost = { slug: string; title: string; html: string; summary: string; date: string; image?: string };

const DIR: Record<SocialPageKind, string> = { home: "", about: "gioi-thieu/", products: "danh-muc-san-pham/", blog: "blog/" };

/** Link Google Drive (…/file/d/ID/…, open?id=ID) → link ảnh hiển thị được; link ảnh thường giữ nguyên. */
export function imageUrl(u?: string): string {
  const s = (u ?? "").trim();
  if (!/^https?:\/\//.test(s)) return "";
  const id = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{10,})/)?.[1];
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1600` : s;
}

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const meta = (s: string) => {
  const t = plain(s);
  return t.length > 158 ? `${t.slice(0, 155).replace(/\s\S*$/, "")}…` : t;
};

/** baseUrl: địa chỉ gốc của trang sau khi tạo (để ghi sitemap / canonical), vd https://ten.netlify.app/ */
export function renderStaticSite(tpl: SocialTemplate, biz: BusinessInfo, baseUrl: string, posts: SitePost[] = []): SiteFile[] {
  // Bộ thiết kế: màu người dùng chọn > màu đọc từ website; màu phụ, chữ, font, bo góc lấy từ website
  const d = tpl.assets?.design;
  const hex = (v?: string) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v : "");
  const color = hex(biz.brandColor) || hex(d?.primary) || "#0d53f0";
  const accent = hex(d?.secondary) || color;
  const ink = hex(d?.text) || "#1f2328";
  const onColor = luminance(color) > 0.62 ? "#14171a" : "#ffffff"; // chữ trên nền màu chính: màu sáng thì dùng chữ tối
  const onAccent = luminance(accent) > 0.62 ? "#14171a" : "#ffffff";
  const radius = Math.max(0, Math.min(d?.radius ?? 10, 999));
  const fontsHref = d?.fontsHref && /^https:\/\/fonts\.googleapis\.com\//.test(d.fontsHref) ? d.fontsHref : "";
  const stack = (f?: string) => `${f ? `'${f.replace(/['"<>;{}]/g, "")}',` : ""}-apple-system,Segoe UI,Roboto,Arial,sans-serif`;
  const bodyFont = stack(fontsHref ? d?.bodyFont : "");
  const headFont = stack(fontsHref ? d?.headingFont : "");
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const files: SiteFile[] = [];
  const logo = imageUrl(biz.logoUrl) || imageUrl(biz.avatarUrl) || imageUrl(tpl.assets?.logo);
  const cover = imageUrl(biz.coverWideUrl) || imageUrl(biz.coverUrl) || imageUrl(tpl.assets?.cover);
  const cards = (tpl.assets?.products ?? []).filter((x) => x.image).slice(0, 6);
  const socials = tpl.assets?.socials ?? [];
  const site = biz.targetUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  // Đầu trang / chân trang kiểu website thật: thanh thông tin, menu, nút liên hệ, 4 cột chân trang, dữ liệu doanh nghiệp cho Google
  const tel = (biz.phone ?? "").replace(/[^\d+]/g, "");
  const prodLinks = (tpl.assets?.products ?? []).slice(0, 6);
  const socialName = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "").split(".")[0]!.replace(/^./, (c) => c.toUpperCase()); } catch { return "Link"; } };
  const about = (biz.bio || tpl.tagline || biz.slogan || "").trim();
  const orgLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: biz.companyName || biz.brandName,
    alternateName: biz.companyName ? biz.brandName : undefined,
    url: biz.targetUrl,
    logo: logo || undefined,
    description: about || undefined,
    telephone: biz.phone || undefined,
    email: biz.email || undefined,
    address: biz.address ? { "@type": "PostalAddress", streetAddress: biz.address, postalCode: biz.zipCode || undefined, addressCountry: "VN" } : undefined,
    sameAs: [biz.targetUrl, ...socials].filter(Boolean),
  }).replace(/</g, "\\u003c");
  const contact = [biz.address && `Địa chỉ: ${escapeHtml(biz.address)}${biz.zipCode ? ` (${escapeHtml(biz.zipCode)})` : ""}`, biz.phone && `Điện thoại: ${escapeHtml(biz.phone)}`, biz.email && `Email: ${escapeHtml(biz.email)}`].filter(Boolean).join(" · ");
  const sorted = [...posts].sort((a, b) => b.date.localeCompare(a.date));
  const vnDate = (iso: string) => new Date(iso).toLocaleDateString("vi-VN");
  const postList = (up: string) =>
    sorted.length
      ? `<div class="cards">${sorted.map((x) => `<a class="card" href="${up}blog/${x.slug}/">${x.image ? `<img src="${escapeAttr(x.image)}" alt="${escapeAttr(x.title)}" loading="lazy">` : ""}<span>${escapeHtml(x.title)}<small style="display:block;font-weight:400;color:#6b7280;margin-top:4px">${vnDate(x.date)}</small></span></a>`).join("")}</div>`
      : `<p>Bài viết của ${escapeHtml(biz.brandName)} sẽ được cập nhật tại đây.</p>`;
  type Pg = { path: string; depth: number; active: SocialPageKind; title: string; h1: string; desc: string; body: string; home?: boolean; ogType?: string; image?: string };
  const pagesToRender: Pg[] = tpl.pages.map((p) => ({
    path: `${DIR[p.kind]}index.html`,
    depth: DIR[p.kind] ? 1 : 0,
    active: p.kind,
    title: p.kind === "home" ? `${tpl.siteTitle}${tpl.tagline ? ` — ${tpl.tagline}` : ""}` : `${p.title} — ${tpl.siteTitle}`,
    h1: p.title,
    desc: p.kind === "blog" ? `Blog của ${biz.brandName} — tin tức, kiến thức về ${biz.industry}.` : p.kind === "home" && biz.bio ? meta(biz.bio) : meta(p.html),
    body: p.kind === "blog" ? postList("../") : p.kind === "home" && sorted.length ? `${p.html}<h2>Bài viết mới</h2>${postList("./")}` : p.html,
    home: p.kind === "home",
  }));
  for (const x of sorted) {
    pagesToRender.push({
      path: `blog/${x.slug}/index.html`,
      depth: 2,
      active: "blog",
      title: `${x.title} — ${tpl.siteTitle}`,
      h1: x.title,
      desc: meta(x.summary || x.html),
      body: `<p style="color:#6b7280;margin-top:-8px">${vnDate(x.date)} · ${escapeHtml(biz.brandName)}</p>${x.image ? `<figure><img src="${escapeAttr(x.image)}" alt="${escapeAttr(x.title)}"></figure>` : ""}${x.html}<p><a href="../">← Tất cả bài viết</a></p>`,
      ogType: "article",
      image: x.image,
    });
  }
  for (const pg of pagesToRender) {
    const up = pg.depth === 2 ? "../../" : pg.depth ? "../" : "./";
    const nav = tpl.pages
      .map((x) => `<a href="${up}${DIR[x.kind]}"${x.kind === pg.active ? ' aria-current="page"' : ""}>${SOCIAL_PAGE_LABEL[x.kind]}</a>`)
      .join("");
    const canonical = `${base}${pg.path.replace(/index.html$/, "")}`;
    const ogImage = pg.image || cover;
    files.push({
      path: pg.path,
      content: `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(pg.title.slice(0, 70))}</title>
<meta name="description" content="${escapeHtml(pg.desc)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${escapeHtml(pg.h1)}">
<meta property="og:description" content="${escapeHtml(pg.desc)}">
<meta property="og:type" content="${pg.ogType ?? "website"}">
${logo ? `<link rel="icon" href="${escapeAttr(logo)}">` : ""}
${ogImage ? `<meta property="og:image" content="${escapeAttr(ogImage)}">` : ""}
${fontsHref ? `<link rel="stylesheet" href="${escapeAttr(fontsHref)}">` : ""}
<meta name="theme-color" content="${color}">
<script type="application/ld+json">${orgLd}</script>${pg.home ? "" : `\n<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Trang chủ", item: base }, { "@type": "ListItem", position: 2, name: pg.h1, item: canonical }] }).replace(/</g, "\\u003c")}</script>`}
<style>
:root{--c:${color};--c2:${accent};--on:${onColor};--on2:${onAccent};--ink:${ink};--r:${radius}px}*{box-sizing:border-box}body{margin:0;font-family:${bodyFont};line-height:1.7;color:var(--ink);background:#fff}h1,h2,h3,.brand{font-family:${headFont}}
.w{max-width:1080px;margin:0 auto;padding:0 20px}a{color:var(--c)}img{max-width:100%;height:auto}
.topbar{background:var(--c);color:var(--on);font-size:13.5px}.topbar .w{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;justify-content:space-between;padding-block:7px}.topbar a{color:var(--on);text-decoration:none}.topbar .l,.topbar .r{display:flex;flex-wrap:wrap;gap:6px 16px}
.site-header{background:#fff;border-bottom:1px solid #e6e8eb;box-shadow:0 2px 12px rgb(0 0 0/.05);position:sticky;top:0;z-index:5}.site-header .w{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-block:12px}
.cta{display:inline-flex;align-items:center;gap:6px;background:var(--c);color:var(--on);font-weight:700;padding:10px 18px;border-radius:var(--r);text-decoration:none;white-space:nowrap}
.mnav-btn{display:none;cursor:pointer;border:1px solid #e6e8eb;border-radius:10px;padding:8px 12px;font-weight:700}#mnav{display:none}
.crumbs{font-size:14px;color:#6b7280;margin-bottom:6px}.crumbs a{color:#6b7280;text-decoration:none}.crumbs a:hover{color:var(--c)}
.brand{display:flex;align-items:center;gap:12px;font-weight:800;font-size:19px;color:#1f2328;text-decoration:none}.brand img{height:48px;width:auto;max-width:180px;object-fit:contain}
nav{display:flex;flex-wrap:wrap;gap:6px}nav a{color:#1f2328;text-decoration:none;padding:8px 14px;border-radius:999px;font-weight:600;font-size:15px}nav a:hover{background:#f2f4f7}nav a[aria-current]{background:var(--c);color:var(--on)}
.hero{position:relative;color:var(--on);background:linear-gradient(120deg,var(--c),color-mix(in srgb,var(--c) 70%,var(--c2)))}.hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.35}.hero .w{position:relative;padding-block:72px}
.hero h1{font-size:40px;line-height:1.2;margin:0 0 12px;max-width:760px}.hero p{font-size:19px;max-width:680px;margin:0 0 24px;opacity:.95}
.btn{display:inline-block;background:var(--c2);color:var(--on2);font-weight:700;padding:12px 26px;border-radius:var(--r);text-decoration:none;box-shadow:0 4px 14px rgb(0 0 0/.15)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:18px;margin:8px 0 28px}.card{border:1px solid #e6e8eb;border-radius:calc(var(--r) + 4px);overflow:hidden;text-decoration:none;color:#1f2328;background:#fff}
.card img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:#f2f4f7}.card span{display:block;padding:12px 14px;font-weight:700}
main .w{padding-block:36px}main h1{font-size:34px;line-height:1.25;margin:0 0 18px}h2{margin-top:34px;color:var(--c)}figure{margin:18px 0}figure img{border-radius:var(--r);display:block}h2::after{content:"";display:block;width:48px;height:4px;margin-top:8px;border-radius:2px;background:var(--c2)}
.site-footer{background:#0f172a;color:#cbd5e1;font-size:15px;border-top:4px solid var(--c)}.site-footer a{color:#e2e8f0;text-decoration:none}.site-footer a:hover{color:#fff;text-decoration:underline}
.f-grid{display:grid;grid-template-columns:1.4fr 1fr 1fr 1.2fr;gap:28px;padding-block:44px 28px}.f-grid h4{color:#fff;font-size:16px;margin:0 0 14px}.f-grid ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.f-logo{height:44px;width:auto;max-width:180px;background:#fff;border-radius:8px;padding:5px 8px;object-fit:contain}.f-about{margin:12px 0;line-height:1.6}.f-social{display:flex;flex-wrap:wrap;gap:8px}.f-social a{border:1px solid #334155;border-radius:999px;padding:4px 12px;font-size:13px}
.f-bottom{border-top:1px solid #1e293b}.f-bottom .w{display:flex;flex-wrap:wrap;gap:8px 16px;justify-content:space-between;padding-block:16px;font-size:13.5px;color:#94a3b8}
@media(max-width:860px){.f-grid{grid-template-columns:1fr 1fr}}
@media(max-width:760px){.mnav-btn{display:inline-block}.site-header nav{display:none;position:absolute;left:0;right:0;top:100%;background:#fff;flex-direction:column;padding:10px 20px 16px;border-bottom:1px solid #e6e8eb;box-shadow:0 12px 20px rgb(0 0 0/.08)}#mnav:checked~nav{display:flex}.site-header .cta{display:none}.topbar .r{display:none}}
@media(max-width:600px){.hero h1{font-size:28px}main h1{font-size:26px}.f-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
${biz.phone || biz.email || biz.address ? `<div class="topbar"><div class="w"><div class="l">${biz.phone ? `<a href="tel:${escapeAttr(tel)}">☎ ${escapeHtml(biz.phone)}</a>` : ""}${biz.email ? `<a href="mailto:${escapeAttr(biz.email)}">✉ ${escapeHtml(biz.email)}</a>` : ""}${biz.address ? `<span>📍 ${escapeHtml(biz.address.length > 70 ? biz.address.slice(0, 68) + "…" : biz.address)}</span>` : ""}</div><div class="r"><a href="${escapeAttr(biz.targetUrl)}">Website chính thức →</a></div></div></div>` : ""}
<header class="site-header"><div class="w" style="position:relative"><a class="brand" href="${up}">${logo ? `<img src="${escapeAttr(logo)}" alt="Logo ${escapeAttr(biz.brandName)}">` : `<span>${escapeHtml(biz.brandName)}</span>`}</a><input type="checkbox" id="mnav" aria-label="Mở menu"><label for="mnav" class="mnav-btn">☰ Menu</label><nav>${nav}</nav>${tel ? `<a class="cta" href="tel:${escapeAttr(tel)}">☎ Gọi ngay</a>` : `<a class="cta" href="${escapeAttr(biz.targetUrl)}">Liên hệ</a>`}</div></header>
${pg.home ? `<section class="hero">${cover ? `<img src="${escapeAttr(cover)}" alt="">` : ""}<div class="w"><h1>${escapeHtml(tpl.siteTitle)}</h1>${tpl.tagline ? `<p>${escapeHtml(tpl.tagline)}</p>` : ""}<a class="btn" href="${escapeAttr(biz.targetUrl)}">Xem website chính thức</a></div></section>` : ""}
<main><div class="w">
${pg.home ? "" : `<div class="crumbs"><a href="${up}">Trang chủ</a> › ${pg.depth === 2 ? `<a href="../">Blog</a> › ` : ""}<span>${escapeHtml(pg.h1.length > 60 ? pg.h1.slice(0, 58) + "…" : pg.h1)}</span></div><h1>${escapeHtml(pg.h1)}</h1>`}
${pg.home && cards.length ? `<h2>Sản phẩm nổi bật</h2><div class="cards">${cards.map((c) => `<a class="card" href="${escapeAttr(c.href || biz.targetUrl)}"><img src="${escapeAttr(c.image!)}" alt="${escapeAttr(c.name)}" loading="lazy"><span>${escapeHtml(c.name)}</span></a>`).join("")}</div>` : ""}
${pg.body}
</div></main>
<footer class="site-footer"><div class="w f-grid">
<div>${logo ? `<img class="f-logo" src="${escapeAttr(logo)}" alt="${escapeAttr(biz.brandName)}">` : `<h4>${escapeHtml(biz.brandName)}</h4>`}${about ? `<p class="f-about">${escapeHtml(about.length > 200 ? about.slice(0, 198) + "…" : about)}</p>` : ""}${socials.length ? `<div class="f-social">${socials.map((x) => `<a href="${escapeAttr(x)}" rel="noopener" target="_blank">${escapeHtml(socialName(x))}</a>`).join("")}</div>` : ""}</div>
<div><h4>Danh mục</h4><ul>${tpl.pages.map((x) => `<li><a href="${up}${DIR[x.kind]}">${SOCIAL_PAGE_LABEL[x.kind]}</a></li>`).join("")}<li><a href="${escapeAttr(biz.targetUrl)}">Website chính thức</a></li></ul></div>
<div><h4>Sản phẩm &amp; dịch vụ</h4><ul>${prodLinks.length ? prodLinks.map((x) => `<li><a href="${escapeAttr(x.href || biz.targetUrl)}">${escapeHtml(x.name.length > 48 ? x.name.slice(0, 46) + "…" : x.name)}</a></li>`).join("") : `<li><a href="${up}danh-muc-san-pham/">Xem danh mục sản phẩm</a></li>`}</ul></div>
<div><h4>Liên hệ</h4><ul>${biz.companyName ? `<li>${escapeHtml(biz.companyName)}</li>` : ""}${biz.address ? `<li>📍 ${escapeHtml(biz.address)}${biz.zipCode ? ` (${escapeHtml(biz.zipCode)})` : ""}</li>` : ""}${biz.phone ? `<li>☎ <a href="tel:${escapeAttr(tel)}">${escapeHtml(biz.phone)}</a></li>` : ""}${biz.email ? `<li>✉ <a href="mailto:${escapeAttr(biz.email)}">${escapeHtml(biz.email)}</a></li>` : ""}<li>🌐 <a href="${escapeAttr(biz.targetUrl)}">${escapeHtml(site)}</a></li></ul></div>
</div><div class="f-bottom"><div class="w"><span>© ${new Date().getFullYear()} ${escapeHtml(biz.companyName || biz.brandName)}. Bảo lưu mọi quyền.</span><a href="#">↑ Lên đầu trang</a></div></div></footer>
</body>
</html>
`,
    });
  }
  const now = new Date().toISOString().slice(0, 10);
  files.push({
    path: "sitemap.xml",
    content: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...tpl.pages.map((p) => `  <url><loc>${base}${DIR[p.kind]}</loc><lastmod>${now}</lastmod></url>`), ...sorted.map((x) => `  <url><loc>${base}blog/${x.slug}/</loc><lastmod>${x.date.slice(0, 10)}</lastmod></url>`)].join("\n")}\n</urlset>\n`,
  });
  files.push({ path: "robots.txt", content: `User-agent: *\nAllow: /\nSitemap: ${base}sitemap.xml\n` });
  return files;
}

export const pageUrls = (tpl: SocialTemplate, baseUrl: string) => {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return tpl.pages.map((p) => ({ label: SOCIAL_PAGE_LABEL[p.kind], url: `${base}${DIR[p.kind]}` }));
};
