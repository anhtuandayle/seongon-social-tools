// Mastodon: người dùng tạo tài khoản tay 1 lần (đăng ký phải xác nhận email), dán mã truy cập → app tự điền hồ sơ
// (tên, bio, ảnh đại diện = logo, ảnh bìa, 4 ô thông tin, bật cho Google index), đăng bài Giới thiệu (ghim) + bài Danh mục sản phẩm.
// Mã lưu dạng "<máy chủ>|<mã>" trong kết nối của dự án.
import type { BusinessInfo } from "../types";
import { imageUrl } from "./site";
import type { SocialTemplate } from "./template";

export const parseMasto = (stored: string) => {
  const [instance, token] = stored.includes("|") ? stored.split("|") : ["mastodon.social", stored];
  return { base: `https://${instance!.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`, token: token! };
};

async function j<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw new Error(`Mastodon: ${data?.error || text.slice(0, 200) || res.status}`);
  return data as T;
}

export async function verifyMastodon(stored: string) {
  const { base, token } = parseMasto(stored);
  const r = await fetch(`${base}/api/v1/accounts/verify_credentials`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("Mastodon từ chối mã này — kiểm tra máy chủ và tạo lại mã ở Cài đặt → Phát triển (quyền read + write)");
  const a = (await r.json()) as { acct: string };
  return `@${a.acct}@${new URL(base).host}`;
}

/** Tải ảnh về để gửi lên Mastodon (ảnh đại diện ≤ 2MB, ảnh bìa ≤ 5MB). Lỗi thì bỏ qua. */
async function fileFrom(url: string, name: string, max: number) {
  const u = imageUrl(url);
  if (!u) return null;
  try {
    const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) });
    const type = r.headers.get("content-type") ?? "";
    if (!r.ok || !/^image\/(png|jpe?g|gif|webp)/.test(type)) return null;
    const buf = await r.arrayBuffer();
    if (buf.byteLength > max) return null;
    return new File([buf], `${name}.${type.split("/")[1]!.replace("jpeg", "jpg")}`, { type });
  } catch {
    return null;
  }
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s\S*$/, "")}…` : s);

async function status(base: string, token: string, text: string, image?: string) {
  const media: string[] = [];
  const f = image ? await fileFrom(image, "anh", 8 * 1024 * 1024) : null;
  if (f) {
    const fd = new FormData();
    fd.append("file", f);
    const m = await j<{ id: string }>(await fetch(`${base}/api/v2/media`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd })).catch(() => null);
    if (m) media.push(m.id);
  }
  return j<{ id: string; url: string }>(await fetch(`${base}/api/v1/statuses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ status: cut(text, 500), visibility: "public", language: "vi", media_ids: media }),
  }));
}

export async function createMastodon(stored: string, tpl: SocialTemplate, biz: BusinessInfo) {
  const { base, token } = parseMasto(stored);
  const auth = { Authorization: `Bearer ${token}` };
  const site = biz.targetUrl;
  // 1. hồ sơ
  const fd = new FormData();
  fd.append("display_name", cut(biz.brandName, 30));
  fd.append("note", cut([biz.bio || tpl.tagline || biz.slogan, site].filter(Boolean).join("\n"), 500));
  const fields: [string, string | undefined][] = [["Website", site], ["Địa chỉ", biz.address], ["Điện thoại", biz.phone], ["Email", biz.email]];
  fields.filter(([, v]) => v && v.trim()).slice(0, 4).forEach(([k, v], i) => {
    fd.append(`fields_attributes[${i}][name]`, k);
    fd.append(`fields_attributes[${i}][value]`, cut(v!.trim(), 255));
  });
  fd.append("discoverable", "true");
  fd.append("indexable", "true");
  fd.append("locked", "false");
  fd.append("bot", "false");
  const avatar = await fileFrom(biz.avatarUrl || biz.logoUrl || tpl.assets.logo, "avatar", 2 * 1024 * 1024);
  if (avatar) fd.append("avatar", avatar);
  const header = await fileFrom(biz.coverUrl || biz.coverWideUrl || tpl.assets.cover, "header", 5 * 1024 * 1024);
  if (header) fd.append("header", header);
  const acc = await j<{ id: string; url: string }>(await fetch(`${base}/api/v1/accounts/update_credentials`, { method: "PATCH", headers: auth, body: fd }));

  // 2. bài Giới thiệu (ghim lên đầu trang) + bài Danh mục sản phẩm
  const about = (biz.about || biz.bio || tpl.tagline || "").replace(/\s+/g, " ").trim();
  const intro = await status(base, token, `Giới thiệu ${biz.brandName}\n\n${cut(about, 380)}\n\n${site}`, tpl.assets.cover);
  await fetch(`${base}/api/v1/statuses/${intro.id}/pin`, { method: "POST", headers: auth }).catch(() => null);
  const prods = tpl.assets.products.slice(0, 8);
  const prodText = prods.length
    ? `Sản phẩm và dịch vụ của ${biz.brandName}:\n${prods.map((p) => `• ${p.name}`).join("\n")}\n\nXem thêm: ${site}`
    : `Sản phẩm và dịch vụ của ${biz.brandName} được cập nhật tại: ${site}`;
  const products = await status(base, token, prodText, prods.find((p) => p.image)?.image);
  return {
    siteUrl: acc.url,
    siteId: acc.id,
    pages: [
      { label: "Trang chủ", url: acc.url },
      { label: "Giới thiệu", url: intro.url },
      { label: "Danh mục sản phẩm", url: products.url },
      { label: "Blog", url: acc.url },
    ],
  };
}

/** Share 1 bài: đoạn ngắn (≤ 500 ký tự) gồm tiêu đề, tóm tắt, link bài gốc, kèm ảnh nếu có. */
export async function postMastodon(stored: string, p: { title: string; summary: string; image?: string; link?: string }) {
  const { base, token } = parseMasto(stored);
  const link = p.link ? `\n\n${p.link}` : "";
  const s = await status(base, token, `${p.title}\n\n${cut(p.summary || "", 500 - p.title.length - link.length - 8)}${link}`, p.image);
  return s.url;
}

/** Gỡ: xoá các bài đã đăng của tài khoản (Mastodon không cho phần mềm xoá tài khoản). */
export async function clearMastodon(stored: string, accountId: string) {
  const { base, token } = parseMasto(stored);
  const auth = { Authorization: `Bearer ${token}` };
  for (let round = 0; round < 10; round++) {
    const list = await j<{ id: string }[]>(await fetch(`${base}/api/v1/accounts/${accountId}/statuses?limit=40`, { headers: auth }));
    if (!list.length) break;
    for (const st of list) await fetch(`${base}/api/v1/statuses/${st.id}`, { method: "DELETE", headers: auth });
  }
}
