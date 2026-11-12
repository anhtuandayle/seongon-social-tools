// Tài khoản gốc của từng người cho các nền tảng dán mã truy cập (Netlify, Vercel, GitHub) + tài khoản Telegraph app tự tạo.
// Lưu mã hoá trong KV theo email — mỗi người chỉ thấy/dùng tài khoản của mình.
import { decrypt, encrypt } from "../store";
import type { Env } from "../types";
import { verifyMastodon } from "./mastodon";

export type TokenPlatform = "netlify" | "vercel" | "github" | "codeberg" | "mastodon";
export type Conn = { token: string; username: string; connectedAt: string };
export type Conns = Partial<Record<TokenPlatform | "telegraph", Conn>>;

const key = (email: string) => `social-conn:${email}`;

export const getConns = async (env: Env, email: string) => decrypt<Conns>(env, (await env.DATA.get(key(email))) ?? undefined, {});
export async function setConn(env: Env, email: string, platform: keyof Conns, conn: Conn | null) {
  const all = await getConns(env, email);
  if (conn) all[platform] = conn;
  else delete all[platform];
  await env.DATA.put(key(email), await encrypt(env, all));
}

/** Thử mã với nền tảng, trả tên tài khoản (để hiện "Đã kết nối: …"). Mã sai → báo lỗi tiếng Việt. */
export async function verifyToken(platform: TokenPlatform, token: string): Promise<string> {
  const t = token.trim();
  if (platform === "mastodon") return verifyMastodon(t); // mã dạng "<máy chủ>|<mã>"
  const req = (url: string, h: Record<string, string>) => fetch(url, { headers: { ...h, "User-Agent": "tro-ly-ai-seongon" }, signal: AbortSignal.timeout(15_000) });
  if (platform === "netlify") {
    const r = await req("https://api.netlify.com/api/v1/user", { Authorization: `Bearer ${t}` });
    if (!r.ok) throw new Error("Netlify từ chối mã này — tạo lại mã ở User settings → Applications → Personal access tokens");
    const j = (await r.json()) as { email?: string; full_name?: string; slug?: string };
    return j.full_name || j.slug || j.email || "Netlify";
  }
  if (platform === "vercel") {
    const r = await req("https://api.vercel.com/v2/user", { Authorization: `Bearer ${t}` });
    if (!r.ok) throw new Error("Vercel từ chối mã này — tạo lại mã ở Account Settings → Tokens");
    const j = (await r.json()) as { user?: { username?: string; email?: string } };
    return j.user?.username || j.user?.email || "Vercel";
  }
  if (platform === "codeberg") {
    const r = await req("https://codeberg.org/api/v1/user", { Authorization: `token ${t}` });
    if (!r.ok) throw new Error("Codeberg từ chối mã này — tạo lại mã ở Settings → Applications (quyền repository: Read and write)");
    const j = (await r.json()) as { login?: string };
    if (!j.login) throw new Error("Codeberg không trả tên tài khoản");
    return j.login;
  }
  const r = await req("https://api.github.com/user", { Authorization: `Bearer ${t}`, Accept: "application/vnd.github+json" });
  if (!r.ok) throw new Error("GitHub từ chối mã này — tạo lại mã (classic, quyền repo) ở Settings → Developer settings → Tokens");
  const j = (await r.json()) as { login?: string };
  if (!j.login) throw new Error("GitHub không trả tên tài khoản");
  return j.login;
}
