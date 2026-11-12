// Đọc website chính của thương hiệu bằng quy tắc (không dùng AI): logo, ảnh, màu thương hiệu, mô tả,
// danh mục sản phẩm (kèm ảnh + link sâu), liên hệ. Dùng để điền chỗ còn trống và làm trang social có dấu ấn thương hiệu.
import type { BusinessInfo } from "../types";

export interface BrandImage { src: string; alt: string }
export interface BrandProduct { name: string; href: string; image?: string; desc?: string }
export interface SiteBrand {
  url: string;
  name: string;
  title: string;
  description: string;
  logo: string;
  ogImage: string;
  color: string; // = design.primary
  design: SiteDesign;
  images: BrandImage[];
  products: BrandProduct[];
  paragraphs: string[];
  phones: string[];
  emails: string[];
  address: string;
  socials: string[];
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const text = (html: string) => decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => decode(tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))?.slice(2).find((x) => x !== undefined) ?? "");
const metaContent = (html: string, key: string) => {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const t = m[0];
    if ((attr(t, "property") || attr(t, "name")).toLowerCase() === key) return attr(t, "content").trim();
  }
  return "";
};

function abs(u: string, base: string) {
  try {
    const x = new URL(u.trim(), base);
    return /^https?:$/.test(x.protocol) ? x.href : "";
  } catch {
    return "";
  }
}

const JUNK_IMG = /sprite|icon|pixel|spacer|blank|loading|placeholder|avatar-default|1x1|\.svg(\?|$)|data:|facebook\.com\/tr|google-analytics|doubleclick/i;
const JUNK_START = /^(tải|download|tìm hiểu|xem|đọc|liên hệ|đăng ký|nhận|gọi|chat|mua ngay|order|learn|read|view|get|see)(?:\s|$)/i;
const JUNK_LINK = /^(icon|image|img|logo|banner|trang chủ|home|liên hệ|contact|giới thiệu|about|tin tức|news|blog|tuyển dụng|careers?|đăng nhập|login|đăng ký|register|giỏ hàng|cart|tìm kiếm|search|chính sách|policy|điều khoản|faq|hỏi đáp|sitemap|xem thêm|chi tiết|more|tiếng việt|english|vi|en)$/i;

// ---------- Bộ thiết kế: màu chính/phụ, màu chữ, font, độ bo góc — đọc từ HTML + file CSS của website ----------

/** "#abc" / "#aabbcc" / "rgb(…)" → "#aabbcc"; màu trong suốt hoặc lạ → "". */
function toHex(v: string) {
  const s = v.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) return `#${[...m[1]!].map((c) => c + c).join("")}`;
  m = s.match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/);
  if (m) return `#${m[1]}`;
  const r = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[,/]\s*([\d.]+%?))?/);
  if (r) {
    if (r[4] && parseFloat(r[4]) < (r[4].endsWith("%") ? 60 : 0.6)) return "";
    return `#${[r[1], r[2], r[3]].map((x) => Math.min(255, +x!).toString(16).padStart(2, "0")).join("")}`;
  }
  return "";
}
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
/** Có màu sắc rõ (không phải trắng/đen/xám). */
const vivid = (h: string) => { const [r, g, b] = rgb(h); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx - mn >= 45 && mx >= 60; };
const hue = (h: string) => {
  const [r, g, b] = rgb(h).map((x) => x / 255) as [number, number, number];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (x * 60 + 360) % 360;
};
/** Độ sáng cảm nhận 0–1 (để chọn chữ trắng hay chữ tối trên nền màu). */
export const luminance = (h: string) => { const [r, g, b] = rgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

export interface SiteDesign {
  primary: string; // màu chính (nút, header, link)
  secondary: string; // màu phụ để nhấn
  text: string; // màu chữ nội dung
  headingFont: string; // tên font Google Fonts (nếu website dùng), rỗng = font hệ thống
  bodyFont: string;
  fontsHref: string; // link Google Fonts để trang social nạp đúng font
  radius: number; // độ bo góc nút/thẻ (px)
}

const LIB_VAR = /swiper|wp--|wp-admin|bs-|bootstrap|elementor|woocommerce|fa-|plyr|slick|mejs/i;
const LIB_SEL = /\.has-[\w-]+|\.wp-block|#wpadminbar|\.swiper|\.slick|\.mejs|\.elementor-kit|\.fa-|\.select2|\.flatpickr/;
const LIB_COLORS = new Set(["#007aff", "#0693e3", "#00d084", "#cf2e2e", "#ff6900", "#fcb900", "#7bdcb5", "#8ed1fc", "#9b51e0", "#abb8c3", "#f78da7", "#0073aa", "#2271b1", "#007cba", "#135e96", "#0d6efd", "#3858e9", "#1877f2", "#25d366", "#0068ff", "#ff0000", "#00ff00", "#0000ff"]);
const ICON_FONT = /awesome|icon|material symbols|material icons|glyph|dashicons|swiper|slick|eicons|themify|ionicons/i;
const GENERIC = /^(inherit|initial|unset|serif|sans-serif|monospace|cursive|system-ui|-apple-system|blinkmacsystemfont|arial|helvetica|segoe ui|roboto|tahoma|verdana|times new roman|georgia)$/i;

/** Tải tối đa 4 file CSS cùng website (mỗi file ≤ 400KB) + CSS nội tuyến. Lỗi thì bỏ qua. */
async function siteCss(html: string, base: string) {
  const inline = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  const host = new URL(base).host;
  const hrefs = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((t) => /stylesheet/i.test(attr(t, "rel")))
    .map((t) => abs(attr(t, "href") || attr(t, "data-pmdelayedstyle") || attr(t, "data-href") || attr(t, "data-lazy-href"), base))
    .filter((u) => u && new URL(u).host === host && !/\/plugins\/|font-?awesome|swiper|slick|animate|bootstrap(?:\.min)?\.css|jquery|wp-includes/i.test(u))
    .sort((a, b) => +/main|core|style|theme|app|custom/i.test(b) - +/main|core|style|theme|app|custom/i.test(a))
    .slice(0, 4);
  const files = await Promise.all(
    hrefs.map((u) =>
      fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000) })
        .then((r) => (r.ok ? r.text() : ""))
        .then((t) => t.slice(0, 1_200_000))
        .catch(() => ""),
    ),
  );
  return `${inline}\n${files.join("\n")}`;
}

function readDesign(html: string, css: string): SiteDesign {
  const score = new Map<string, number>();
  const add = (v: string, w: number) => { const h = toHex(v); if (h && vivid(h) && !LIB_COLORS.has(h)) score.set(h, (score.get(h) ?? 0) + w); };
  // biến CSS đặt tên rõ: --primary, --main-color, --brand…
  for (const m of css.matchAll(/--([\w-]*(?:primary|main|brand|theme|accent|secondary)[\w-]*)\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\))/gi)) { if (LIB_VAR.test(m[1]!)) continue; add(m[2]!, /secondary|accent/i.test(m[1]!) ? 6 : 14); }
  const theme = metaContent(html, "theme-color");
  if (theme) add(theme, 12);
  let text = "", radius = -1, bodyFamily = "", headFamily = "";
  for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const sel = m[1]!.trim().toLowerCase(), body = m[2]!;
    if (LIB_SEL.test(sel)) continue;
    const important = /btn|button|primary|header|nav|menu|cta|hero|banner|\ba\b|a:hover|link|highlight|title/.test(sel) ? 3 : 1;
    for (const d of body.matchAll(/(?:^|;)\s*(background(?:-color)?|color|border(?:-[a-z]+)?-color|fill)\s*:\s*([^;!]+)/gi)) {
      const v = d[2]!.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]+\)/i)?.[0];
      if (v) add(v, important * (d[1]!.startsWith("background") ? 2 : 1));
    }
    if (/(^|,)\s*(body|html)\s*($|,)/.test(sel)) {
      const c = body.match(/(?:^|;)\s*color\s*:\s*([^;!]+)/i)?.[1];
      if (c && toHex(c)) text = toHex(c);
      const f = body.match(/font-family\s*:\s*([^;!]+)/i)?.[1];
      if (f) bodyFamily = f;
    }
    if (/(^|,)\s*h[1-3]\b/.test(sel) && !headFamily) headFamily = body.match(/font-family\s*:\s*([^;!]+)/i)?.[1] ?? "";
    if (radius < 0 && /btn|button/.test(sel)) {
      const r = body.match(/border-radius\s*:\s*([\d.]+)(px|rem)/i);
      if (r) radius = Math.min(999, Math.round(parseFloat(r[1]!) * (r[2] === "rem" ? 16 : 1)));
    }
  }
  // HTML nội tuyến (style="…") cũng tính, trọng số thấp
  for (const m of html.matchAll(/style=["'][^"']*?(background(?:-color)?|color)\s*:\s*(#[0-9a-f]{3,8}\b|rgba?\([^)]+\))/gi)) add(m[2]!, m[1]!.startsWith("background") ? 4 : 2);
  for (const m of html.replace(/<style[\s\S]*?<\/style>/gi, "").matchAll(/#[0-9a-f]{6}\b/gi)) add(m[0], 0.5);
  const ranked = [...score].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  const primary = ranked[0] ?? "";
  const secondary = ranked.find((h) => h !== primary && Math.min(Math.abs(hue(h) - hue(primary)), 360 - Math.abs(hue(h) - hue(primary))) > 30) ?? "";

  // font: ưu tiên Google Fonts website đang nạp
  const gf = [...html.matchAll(/<link\b[^>]*href=["']([^"']*fonts\.googleapis\.com\/css2?\?[^"']+)["'][^>]*>/gi)].map((m) => decode(m[1]!)).find((u) => !ICON_FONT.test(u)) ?? "";
  const gfFamilies = gf ? [...gf.matchAll(/family=([^:&]+)/g)].map((m) => decodeURIComponent(m[1]!.replace(/\+/g, " "))).filter((f) => !ICON_FONT.test(f)) : [];
  const first = (stack: string) => stack.split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).find((x) => x && !GENERIC.test(x) && !ICON_FONT.test(x) && !/^var\(/.test(x)) ?? "";
  const bodyFont = first(bodyFamily) || gfFamilies[0] || "";
  const headingFont = first(headFamily) || gfFamilies[1] || bodyFont;
  const inGoogle = (f: string) => gfFamilies.some((g) => g.toLowerCase() === f.toLowerCase());
  return {
    primary,
    secondary,
    text: text && !vivid(text) ? text : "",
    headingFont,
    bodyFont,
    fontsHref: gf && (inGoogle(bodyFont) || inGoogle(headingFont)) ? gf : "",
    radius: radius < 0 ? 10 : radius,
  };
}

function findLogo(html: string, base: string) {
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const cand = imgs.find((t) => /logo/i.test(`${attr(t, "class")} ${attr(t, "id")} ${attr(t, "alt")} ${attr(t, "src")} ${attr(t, "data-src")}`));
  if (cand) {
    const u = abs(attr(cand, "data-src") || attr(cand, "src"), base);
    if (u && !u.startsWith("data:")) return u;
  }
  const ld = html.match(/"logo"\s*:\s*(?:\{[^}]*?"url"\s*:\s*)?"([^"]+)"/i)?.[1];
  if (ld) return abs(ld.replace(/\\\//g, "/"), base);
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = attr(m[0], "rel").toLowerCase();
    if (rel.includes("apple-touch-icon")) return abs(attr(m[0], "href"), base);
  }
  return "";
}

function findImages(html: string, base: string, skip: Set<string>) {
  const out: BrandImage[] = [];
  const seen = new Set(skip);
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const t = m[0];
    const srcset = attr(t, "data-srcset") || attr(t, "srcset");
    const big = srcset ? srcset.split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).pop() : "";
    const u = abs(attr(t, "data-src") || attr(t, "data-lazy-src") || big || attr(t, "src"), base);
    if (!u || seen.has(u) || JUNK_IMG.test(u)) continue;
    const w = +attr(t, "width") || 0, h = +attr(t, "height") || 0;
    if ((w && w < 200) || (h && h < 120)) continue;
    if (/logo/i.test(`${attr(t, "class")} ${attr(t, "alt")} ${u}`)) continue;
    seen.add(u);
    out.push({ src: u, alt: attr(t, "alt").trim() });
    if (out.length >= 24) break;
  }
  return out;
}

/** Sản phẩm / dịch vụ: thẻ có ảnh + tiêu đề + link nội bộ (card), rồi mục menu chính. */
function findProducts(html: string, base: string) {
  const host = new URL(base).host;
  const out: BrandProduct[] = [];
  const seen = new Set<string>();
  const push = (p: BrandProduct) => {
    const key = p.name.toLowerCase();
    p.href = p.href.replace(/[#?].*$/, "").replace(/\/$/, "");
    if (seen.has(key) || seen.has(p.href) || JUNK_LINK.test(p.name) || JUNK_START.test(p.name) || p.name.length < 3 || p.name.length > 80) return;
    seen.add(key);
    seen.add(p.href);
    out.push(p);
  };
  // card: <a href=...> ... <img> ... tên </a>
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]{0,1500}?)<\/a>/gi)) {
    const href = abs(attr(`<a ${m[1]}>`, "href"), base);
    if (!href || new URL(href).host !== host || href.replace(/[#?].*$/, "").replace(/\/$/, "") === base.replace(/\/$/, "")) continue;
    const inner = m[2]!;
    const img = inner.match(/<img\b[^>]*>/i)?.[0];
    if (!img) continue;
    const name = text(inner.match(/<h[2-5][^>]*>([\s\S]*?)<\/h[2-5]>/i)?.[1] ?? "") || attr(`<a ${m[1]}>`, "title") || attr(img, "alt") || text(inner);
    const src = abs(attr(img, "data-src") || attr(img, "src"), base);
    if (name) push({ name: name.slice(0, 80), href, image: src && !JUNK_IMG.test(src) ? src : undefined });
    if (out.length >= 12) break;
  }
  // menu chính
  if (out.length < 4) {
    const navHtml = (html.match(/<nav\b[\s\S]*?<\/nav>/gi) ?? []).join(" ") || (html.match(/<header\b[\s\S]*?<\/header>/i)?.[0] ?? "");
    for (const m of navHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href = abs(attr(`<a ${m[1]}>`, "href"), base);
      const name = text(m[2]!);
      if (!href || new URL(href).host !== host) continue;
      push({ name, href });
      if (out.length >= 10) break;
    }
  }
  return out;
}

function findContacts(html: string, base: string) {
  const plain = text(html);
  const phones = [...new Set([...html.matchAll(/href=["']tel:([^"']+)["']/gi)].map((m) => decode(m[1]!).replace(/\s+/g, " ").trim()))];
  if (!phones.length) for (const m of plain.matchAll(/(?:\+84|0)(?:[\s.]?\d){8,10}/g)) { phones.push(m[0].trim()); if (phones.length >= 2) break; }
  const emails = [...new Set([...html.matchAll(/mailto:([^"'?\s>]+)/gi)].map((m) => decode(m[1]!)).concat(plain.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []))]
    .filter((e) => !/\.(png|jpe?g|webp|gif|svg)$/i.test(e) && !/example|sentry|wixpress/i.test(e)).slice(0, 2);
  const address = plain.match(/(?:Địa chỉ|Trụ sở(?: chính)?|Address)\s*[:：]\s*([^|•\n]{10,160}?)(?=\s{2,}|Điện thoại|Hotline|Email|Tel|Phone|$)/i)?.[1]?.trim() ?? "";
  const socials = [...new Set([...html.matchAll(/href=["'](https?:\/\/(?:www\.)?(?:facebook|instagram|youtube|tiktok|linkedin|twitter|x|zalo|pinterest)\.(?:com|me|vn)\/[^"'#?]+)["']/gi)].map((m) => m[1]!))].slice(0, 8);
  return { phones: phones.slice(0, 2), emails, address, socials: socials.map((s) => abs(s, base)).filter(Boolean) };
}

export async function scrapeBrand(url: string): Promise<SiteBrand> {
  if (!/^https?:\/\//.test(url)) throw new Error("Website chưa đúng — cần bắt đầu bằng http:// hoặc https://");
  const ctrl = AbortSignal.timeout(12000);
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "vi,en;q=0.8" }, redirect: "follow", signal: ctrl });
  if (!r.ok) throw new Error(`Website trả lỗi ${r.status} — kiểm tra lại địa chỉ hoặc website đang chặn truy cập tự động`);
  const html = (await r.text()).slice(0, 1_500_000);
  const base = r.url || url;
  const design = readDesign(html, await siteCss(html, base));
  const title = text(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const ogImage = abs(metaContent(html, "og:image") || metaContent(html, "twitter:image"), base);
  const logo = findLogo(html, base);
  const name = metaContent(html, "og:site_name") || title.split(/\s[|\-–—]\s/)[0]!.trim();
  const description = metaContent(html, "description") || metaContent(html, "og:description");
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => text(m[1]!)).filter((t) => t.length >= 80 && t.length <= 700 && !/cookie|bản quyền|copyright|©/i.test(t)).slice(0, 6);
  const images = findImages(html, base, new Set([logo, ogImage]));
  return {
    url: base,
    name,
    title,
    description,
    logo,
    ogImage,
    color: design.primary,
    design,
    images: ogImage ? [{ src: ogImage, alt: name }, ...images] : images,
    products: findProducts(html, base),
    paragraphs,
    ...findContacts(html, base),
  };
}

/** Điền các ô CÒN TRỐNG từ website — không ghi đè thông tin người dùng / sheet đã có. */
export function fillFromSite(b: BusinessInfo, s: SiteBrand): { business: BusinessInfo; filled: (keyof BusinessInfo)[] } {
  const out: BusinessInfo = { ...b };
  const filled: (keyof BusinessInfo)[] = [];
  const set = (k: keyof BusinessInfo, v: string | undefined) => {
    if (!v || String(out[k] ?? "").trim()) return;
    (out as unknown as Record<string, string>)[k] = v;
    filled.push(k);
  };
  set("logoUrl", s.logo);
  set("coverWideUrl", s.ogImage || s.images[0]?.src);
  set("bio", s.description.slice(0, 300));
  set("about", [s.description, ...s.paragraphs.slice(0, 3)].filter(Boolean).join("\n\n").slice(0, 2500));
  set("products", s.products.map((p) => p.name).join("\n"));
  set("phone", s.phones[0]);
  set("email", s.emails[0]);
  set("address", s.address);
  if ((!out.brandColor || out.brandColor.toLowerCase() === "#0d53f0") && s.color) {
    out.brandColor = s.color;
    filled.push("brandColor");
  }
  return { business: out, filled };
}
