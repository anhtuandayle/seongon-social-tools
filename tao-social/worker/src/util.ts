// Hàm tiện ích: gọi HTTP an toàn, làm sạch HTML, cắt meta description.
import type { PublishedItem } from "./types";

export class HttpError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public where: string,
  ) {
    super(`[${where}] HTTP ${status}: ${detail}`);
  }
}

/**
 * fetch + parse JSON, có timeout. Lỗi HTTP được ném ra kèm mã lỗi và thông điệp
 * gốc của nền tảng để hiển thị ở bảng kết quả.
 */
export async function fetchJson<T = any>(
  where: string,
  url: string,
  init: RequestInit = {},
  timeoutMs = 60_000,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  let res: Response;
  try {
    const headers = new Headers(init.headers);
    if (!headers.has("User-Agent")) headers.set("User-Agent", "Mozilla/5.0 (compatible; TroLyAI-SEONGON/1.0; +https://seongon.tro-ly-ai.workers.dev)");
    res = await fetchImpl(url, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new HttpError(0, `Không kết nối được (${msg})`, where);
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail =
      (body && typeof body === "object" && (body.message || body.error?.message || body.error_description || body.error)) ||
      (typeof body === "string" ? body.slice(0, 300) : "") ||
      res.statusText;
    throw new HttpError(res.status, typeof detail === "string" ? detail : JSON.stringify(detail), where);
  }
  return body as T;
}

export const PAGE_LABEL = { home: "Trang chủ", about: "Giới thiệu", blog: "Blog" } as const;

/** Gom kết quả allSettled: có ít nhất 1 mục thành công thì trả về, lỗi ghi kèm. */
export function collect(results: PromiseSettledResult<PublishedItem>[]): PublishedItem[] {
  const ok = results
    .filter((r): r is PromiseFulfilledResult<PublishedItem> => r.status === "fulfilled")
    .map((r) => r.value);
  const errs = results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => errorMessage(r.reason));
  if (ok.length === 0) throw new Error(errs.join(" | "));
  if (errs.length) ok.push({ label: `Lỗi một phần: ${errs.join(" | ")}`, url: "" });
  return ok;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Bỏ script/style/iframe, thuộc tính on*, javascript: — giữ HTML sạch. */
export function cleanHtml(html: string): string {
  return html
    .replace(/```(?:html)?/gi, "")
    .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|object|embed)[^>]*\/?>/gi, "")
    .replace(/\s(on\w+|style|class|id)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/href\s*=\s*(["'])\s*javascript:[^"']*\1/gi, 'href="#"')
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "<h2>$1</h2>") // H1 do nền tảng tự tạo từ tiêu đề
    .trim();
}

/** Cắt meta description ≤ max ký tự, không cắt giữa từ. */
export function clampMeta(text: string, max = 160): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 100 ? cut.slice(0, lastSpace) : cut).replace(/[,.;:\-–\s]+$/, "") + "…";
}

/** Nếu AI quên chèn link về website chính thì thêm 1 câu có link ở cuối. */
export function ensureTargetLink(html: string, targetUrl: string, brandName: string): string {
  const host = safeHost(targetUrl);
  const hasLink = new RegExp(`<a[^>]+href=["']https?://(www\\.)?${escapeRegex(host)}`, "i").test(html);
  if (hasLink) return html;
  return `${html}\n<p>Tìm hiểu thêm tại <a href="${escapeAttr(targetUrl)}">${escapeHtml(brandName)}</a>.</p>`;
}

export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}
