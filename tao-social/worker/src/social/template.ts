// Mẫu social chuẩn: 4 trang Trang chủ · Giới thiệu · Danh mục sản phẩm · Blog (Blog là trang danh sách bài, để trống).
// App tự soạn 3 trang có chữ từ thông tin thương hiệu + dữ liệu đọc từ website gốc bằng quy tắc (logo, ảnh, sản phẩm, liên hệ).
// Chỉ gọi AI khi thông tin quá ít hoặc người dùng chọn; AI lỗi / chưa có khoá thì vẫn dùng bản quy tắc, không chặn việc tạo social.
import { callAIJson, extraInfo, parseJsonLoose } from "../ai";
import type { BusinessInfo, Env } from "../types";
import { cleanHtml, escapeAttr, escapeHtml, slugify } from "../util";
import type { BrandImage, BrandProduct, SiteBrand, SiteDesign } from "./scrape";

export type SocialPageKind = "home" | "about" | "products" | "blog";
export interface SocialPage {
  kind: SocialPageKind;
  title: string;
  slug: string;
  html: string; // trang Blog: rỗng (nền tảng tự hiện danh sách bài)
}
export interface SocialTemplate {
  siteTitle: string;
  tagline: string;
  pages: SocialPage[];
  source: "rules" | "ai"; // soạn bằng quy tắc hay nhờ AI
  note?: string; // lý do không dùng được AI
  assets: { logo: string; cover: string; images: BrandImage[]; products: BrandProduct[]; socials: string[]; design?: SiteDesign };
}

export const SOCIAL_PAGE_ORDER: SocialPageKind[] = ["home", "about", "products", "blog"];
export const SOCIAL_PAGE_LABEL: Record<SocialPageKind, string> = { home: "Trang chủ", about: "Giới thiệu", products: "Danh mục sản phẩm", blog: "Blog" };
const SLUG: Record<Exclude<SocialPageKind, "blog">, string> = { home: "trang-chu", about: "gioi-thieu", products: "danh-muc-san-pham" };
const blogPage = (): SocialPage => ({ kind: "blog", title: "Blog", slug: "blog", html: "" });

/** "Tên: mô tả" / "Tên - mô tả" / "Tên" — mỗi dòng (hoặc dấu ;) 1 sản phẩm; ghép ảnh + link sâu từ website nếu trùng tên. */
function productList(b: BusinessInfo, site?: SiteBrand): BrandProduct[] {
  const fromSite = site?.products ?? [];
  const typed = (b.products || "")
    .split(/\r?\n|;/)
    .map((l) => l.replace(/^[\s\-•*+\d.)]+/, "").trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((l) => {
      const m = l.match(/^(.{2,80}?)\s*(?::|–|—|\s-\s)\s*(.+)$/);
      const name = (m ? m[1]! : l).trim();
      const hit = fromSite.find((p) => p.name.toLowerCase() === name.toLowerCase());
      return { name, desc: m?.[2]?.trim(), href: hit?.href ?? "", image: hit?.image };
    });
  return typed.length ? typed : fromSite.slice(0, 12);
}

/** Thông tin đủ để soạn bằng quy tắc: có đoạn giới thiệu (hoặc bio) và có sản phẩm. */
export function enoughForRules(b: BusinessInfo, site?: SiteBrand) {
  return (b.about || b.bio || "").trim().length >= 80 && productList(b, site).length > 0;
}

const paras = (t: string) =>
  t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${escapeHtml(x)}</p>`).join("");
const img = (src: string, alt: string) => `<figure><img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" loading="lazy"></figure>`;

function assetsOf(b: BusinessInfo, site?: SiteBrand): SocialTemplate["assets"] {
  return {
    logo: b.logoUrl || b.avatarUrl || site?.logo || "",
    cover: b.coverWideUrl || b.coverUrl || site?.ogImage || site?.images[0]?.src || "",
    images: site?.images ?? [],
    products: productList(b, site),
    socials: site?.socials ?? [],
    design: site?.design,
  };
}

/** Soạn 4 trang chỉ từ thông tin được cung cấp + website gốc — không bịa, không cần AI. */
export function rulesTemplate(b: BusinessInfo, site?: SiteBrand): SocialTemplate {
  const assets = assetsOf(b, site);
  const name = b.brandName.trim();
  const brand = escapeHtml(name);
  const field = escapeHtml((b.occupation || b.industry || "").trim());
  const link = (href: string, label: string) => `<a href="${escapeAttr(href)}">${escapeHtml(label)}</a>`;
  const home_url = b.targetUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const intro = (b.bio || b.slogan || site?.description || "").trim();
  const about = (b.about || b.bio || site?.description || "").trim();
  const items = assets.products;
  const gallery = assets.images.filter((i) => i.src !== assets.cover).slice(0, 3);

  const home = [
    intro ? `<p><strong>${brand}</strong> — ${escapeHtml(intro)}</p>` : `<p><strong>${brand}</strong>${field ? ` hoạt động trong lĩnh vực ${field}` : ""}.</p>`,
    // đoạn đầu của Giới thiệu trùng câu mở đầu thì lấy đoạn kế tiếp
    paras(about.split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !intro.startsWith(x.slice(0, 60)) && !x.startsWith(intro.slice(0, 60)))[0] ?? ""),
    items.length
      ? `<h2>Sản phẩm và dịch vụ của ${brand}</h2><ul>${items.slice(0, 8).map((i) => `<li>${i.href ? link(i.href, i.name) : escapeHtml(i.name)}</li>`).join("")}</ul>`
      : "",
    gallery.length ? `<h2>Hình ảnh ${brand}</h2>${gallery.map((g) => img(g.src, g.alt || name)).join("")}` : "",
    `<p>Thông tin đầy đủ có tại website chính thức của ${brand}: ${link(b.targetUrl, home_url)}.</p>`,
  ].join("");

  const contact = [
    b.companyName && ["Đơn vị", b.companyName],
    b.address && ["Địa chỉ", b.address],
    b.phone && ["Điện thoại", b.phone],
    b.email && ["Email", b.email],
  ].filter(Boolean) as [string, string][];
  const aboutHtml = [
    `<h2>Về ${brand}</h2>`,
    about ? paras(about) : `<p>${brand}${field ? ` hoạt động trong lĩnh vực ${field}` : ""}.</p>`,
    assets.images[1] ? img(assets.images[1].src, assets.images[1].alt || name) : "",
    `<h2>Thông tin liên hệ</h2><ul>${contact.map(([k, v]) => `<li><strong>${k}:</strong> ${escapeHtml(v)}</li>`).join("")}<li><strong>Website:</strong> ${link(b.targetUrl, home_url)}</li></ul>`,
    assets.socials.length ? `<p>Kênh chính thức: ${assets.socials.map((s) => link(s, new URL(s).hostname.replace(/^www\./, "").split(".")[0]!)).join(" · ")}</p>` : "",
  ].join("");

  const productsHtml = items.length
    ? items
        .map((i) =>
          [
            `<h2>${escapeHtml(i.name)}</h2>`,
            i.image ? img(i.image, i.name) : "",
            `<p>${i.desc ? escapeHtml(i.desc) : `Thông tin chi tiết về ${escapeHtml(i.name)}`}${i.href ? ` — xem tại ${link(i.href, `${name}`)}` : ""}.</p>`,
          ].join(""),
        )
        .join("") + `<p>Danh mục đầy đủ và cập nhật mới nhất: ${link(b.targetUrl, home_url)}</p>`
    : `<p>Danh mục sản phẩm và dịch vụ của ${brand} được cập nhật tại ${link(b.targetUrl, home_url)}.</p>`;

  return {
    siteTitle: [name, (b.occupation || b.industry || "").trim()].filter(Boolean).join(" – ").slice(0, 60),
    tagline: (b.slogan || b.bio || site?.description || "").trim().slice(0, 120),
    source: "rules",
    assets,
    pages: [
      { kind: "home", title: name.slice(0, 120), slug: SLUG.home, html: cleanHtml(home) },
      { kind: "about", title: `Giới thiệu ${name}`.slice(0, 120), slug: SLUG.about, html: cleanHtml(aboutHtml) },
      { kind: "products", title: "Danh mục sản phẩm", slug: SLUG.products, html: cleanHtml(productsHtml) },
      blogPage(),
    ],
  };
}

/**
 * Soạn mẫu 4 trang. Mặc định dùng quy tắc; gọi AI khi người dùng chọn (useAI) hoặc thông tin quá ít.
 * AI lỗi hoặc chưa có khoá thì trả bản quy tắc kèm ghi chú.
 */
export async function generateSocialTemplate(getEnv: () => Promise<Env>, b: BusinessInfo, opts: { useAI?: boolean; site?: SiteBrand } = {}): Promise<SocialTemplate> {
  const rules = rulesTemplate(b, opts.site);
  if (!opts.useAI && enoughForRules(b, opts.site)) return rules;
  try {
    const ai = await aiTemplate(await getEnv(), b);
    return { ...ai, assets: rules.assets };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return { ...rules, note: `Đã soạn bằng quy tắc từ thông tin có sẵn (thử nhờ AI viết thêm nhưng chưa được: ${why.slice(0, 160)}).` };
  }
}

const SYSTEM = `Bạn dựng nội dung cho 1 trang social (website vệ tinh Web 2.0) của doanh nghiệp, theo MẪU CHUẨN gồm các trang:
1. kind="home" — Trang chủ: giới thiệu ngắn thương hiệu, nhóm sản phẩm/dịch vụ chính, lý do chọn, lời mời ghé website chính. 250–400 từ.
2. kind="about" — Giới thiệu: câu chuyện, sứ mệnh, giá trị, thông tin liên hệ (chỉ dùng thông tin được cung cấp). 200–350 từ.
3. kind="products" — Danh mục sản phẩm: mỗi sản phẩm/dịch vụ 1 mục <h2> + 1–2 câu mô tả. Chỉ dùng sản phẩm được cung cấp; không có danh sách thì nêu các nhóm dịch vụ chung của ngành, KHÔNG bịa tên sản phẩm cụ thể, giá, khuyến mãi.
Không viết trang Blog (app tự tạo trang Blog trống).
Định dạng html: Clean HTML chỉ dùng <h2>,<h3>,<p>,<ul>,<li>,<strong>,<a>; không <h1>, không class/style/script. Mỗi trang chèn 1–2 thẻ <a href="{TARGET_URL}"> với anchor tự nhiên.
siteTitle: tên trang social (thường là tên thương hiệu + ngành ngắn gọn, tối đa 60 ký tự). tagline: 1 câu mô tả tối đa 120 ký tự.
Văn phong chuyên nghiệp, không bịa số liệu/giải thưởng, không khẳng định tuyệt đối ("số 1", "tốt nhất", "cam kết 100%").
Trả JSON: {"siteTitle":"","tagline":"","pages":[{"kind":"home","title":"","html":""},{"kind":"about","title":"","html":""},{"kind":"products","title":"","html":""}]}`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    siteTitle: { type: "STRING" },
    tagline: { type: "STRING" },
    pages: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { kind: { type: "STRING", enum: ["home", "about", "products"] }, title: { type: "STRING" }, html: { type: "STRING" } }, required: ["kind", "title", "html"] },
    },
  },
  required: ["siteTitle", "tagline", "pages"],
};

async function aiTemplate(env: Env, b: BusinessInfo): Promise<Omit<SocialTemplate, "assets">> {
  const raw = await callAIJson(env, {
    system: SYSTEM,
    user: `Thông tin doanh nghiệp:\n- Tên thương hiệu: ${b.brandName}\n- Ngành nghề: ${b.industry}\n- Slogan: ${b.slogan || "(không có)"}\n- Website chính (TARGET_URL): ${b.targetUrl}\n${extraInfo(b)}\nMọi thẻ <a> trỏ về đúng: ${b.targetUrl}`,
    geminiSchema: SCHEMA,
    temperature: 0.6,
  });
  const j = parseJsonLoose(raw) as { siteTitle?: string; tagline?: string; pages?: { kind?: string; title?: string; html?: string }[] };
  const pages: SocialPage[] = SOCIAL_PAGE_ORDER.map((kind) => {
    if (kind === "blog") return blogPage();
    const p = (j.pages ?? []).find((x) => x?.kind === kind);
    if (!p?.html || !p.title) throw new Error(`AI thiếu trang "${SOCIAL_PAGE_LABEL[kind]}"`);
    return { kind, title: p.title.trim().slice(0, 120), slug: SLUG[kind], html: cleanHtml(p.html.replaceAll("{TARGET_URL}", b.targetUrl)) };
  });
  return {
    source: "ai",
    siteTitle: (j.siteTitle || b.brandName).trim().slice(0, 60),
    tagline: (j.tagline || b.slogan || "").trim().slice(0, 120),
    pages,
  };
}

/** Địa chỉ con gợi ý cho trang social: chữ thường không dấu, chỉ chữ + số (WordPress.com không nhận gạch ngang). */
export function socialSubdomain(brand: string, suffix = ""): string {
  const base = slugify(brand).replace(/-/g, "").slice(0, 40) || "social";
  return `${base}${suffix}`.slice(0, 50);
}
