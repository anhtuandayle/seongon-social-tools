// WordPress.com: kết nối tài khoản gốc 1 lần (OAuth) → mỗi lần "Tạo social" app tự tạo trang mới ten.wordpress.com
// với đủ 4 trang theo mẫu, đặt Trang chủ làm trang đầu, trang Blog làm trang danh sách bài.
import { decrypt, encrypt, randomToken } from "../store";
import type { Env } from "../types";
import { fetchJson, HttpError } from "../util";
import { SOCIAL_PAGE_LABEL, socialSubdomain, type SocialPage, type SocialTemplate } from "./template";

const API = "https://public-api.wordpress.com/rest/v1.1";
// owner = "<email>#<id dự án>" — mỗi dự án 1 tài khoản WordPress.com riêng
const keyOf = (owner: string) => `wpcom:${owner}`;

export type WpcomApp = { clientId: string; clientSecret: string };
export type WpcomAccount = { token: string; username: string; connectedAt: string; app?: WpcomApp };

// App (Client ID/Secret) dùng chung cho mọi dự án của 1 người — chỉ là danh tính app, tài khoản kết nối vẫn riêng từng dự án
const appKey = (owner: string) => `wpcom-app:${owner.split("#")[0]}`;
/** App WordPress.com dùng để kết nối: app người dùng tự đăng ký (dán trên web) — không có thì dùng app chung quản trị viên cài (nếu có). */
export async function wpcomApp(env: Env, email: string): Promise<WpcomApp | null> {
  const own = await decrypt<WpcomApp | null>(env, (await env.DATA.get(appKey(email))) ?? undefined, null);
  if (own?.clientId && own.clientSecret) return own;
  return env.WPCOM_CLIENT_ID && env.WPCOM_CLIENT_SECRET ? { clientId: env.WPCOM_CLIENT_ID, clientSecret: env.WPCOM_CLIENT_SECRET } : null;
}
export const wpcomHasOwnApp = async (env: Env, email: string) => !!(await env.DATA.get(appKey(email)));
export async function saveWpcomApp(env: Env, email: string, app: WpcomApp | null) {
  if (app) await env.DATA.put(appKey(email), await encrypt(env, app));
  else await env.DATA.delete(appKey(email));
}
export const wpcomRedirectUri = (env: Env) => `${(env.PUBLIC_URL || "").replace(/\/+$/, "")}/api/wpcom/callback`;
const redirectUri = wpcomRedirectUri;

export async function wpcomAuthorizeUrl(env: Env, email: string): Promise<string> {
  const app = await wpcomApp(env, email);
  if (!app) throw new Error("Chưa nhập Client ID / Client Secret của app WordPress.com");
  const state = randomToken(16);
  await env.DATA.put(`wpcom-state:${state}`, email, { expirationTtl: 600 });
  const q = new URLSearchParams({ client_id: app.clientId, redirect_uri: redirectUri(env), response_type: "code", scope: "global", state });
  return `https://public-api.wordpress.com/oauth2/authorize?${q}`;
}

/** Đổi mã WordPress.com trả về thành token, lưu (mã hoá) cho đúng người đã bấm Kết nối. */
export async function wpcomFinish(env: Env, email: string, code: string, state: string): Promise<string> {
  const owner = await env.DATA.get(`wpcom-state:${state}`);
  await env.DATA.delete(`wpcom-state:${state}`);
  if (!owner || (owner !== email && !owner.startsWith(`${email}#`))) throw new Error("Phiên kết nối WordPress.com đã hết hạn — bấm Kết nối lại");
  const app = await wpcomApp(env, owner);
  if (!app) throw new Error("Chưa nhập Client ID / Client Secret của app WordPress.com");
  const tok = await fetchJson<{ access_token?: string }>("WordPress.com", "https://public-api.wordpress.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirectUri(env), code, grant_type: "authorization_code" }),
  });
  if (!tok.access_token) throw new Error("WordPress.com không trả mã truy cập");
  const me = await fetchJson<{ username?: string; display_name?: string }>("WordPress.com", `${API}/me`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
  const acc: WpcomAccount = { token: tok.access_token, username: me.username || me.display_name || "", connectedAt: new Date().toISOString(), app };
  await env.DATA.put(keyOf(owner), await encrypt(env, acc));
  return owner;
}

export const wpcomAccount = async (env: Env, email: string) => decrypt<WpcomAccount | null>(env, (await env.DATA.get(keyOf(email))) ?? undefined, null);
export const wpcomDisconnect = (env: Env, email: string) => env.DATA.delete(keyOf(email));

/** Tạo trang social mới trên WordPress.com theo mẫu. Địa chỉ trùng thì tự thêm số. */
const V2 = "https://public-api.wordpress.com/wp/v2/sites";
/** WordPress.com đang tắt dần các lệnh cũ (rest/v1.1) — dùng bộ lệnh mới (wp/v2) trước, lệnh cũ chỉ làm dự phòng. Lỗi ghi rõ bước. */
async function wpTry<T>(step: string, tries: (() => Promise<T>)[]): Promise<T> {
  const errs: string[] = [];
  for (const [i, t] of tries.entries()) {
    try { return await t(); } catch (e) { errs.push(`cách ${i + 1}: ${e instanceof Error ? e.message.replace(/^\[WordPress\.com\]\s*/, "") : e}`); }
  }
  throw new Error(`WordPress.com — bước “${step}” lỗi (${errs.join(" | ")})`);
}

/** Gọi WordPress REST (wp/v2). base: cổng chung public-api hoặc chính tên miền trang (…wordpress.com/wp-json). */
function makeRest(token: string) {
  const auth = { Authorization: `Bearer ${token}` };
  return async <T>(base: string, path: string, body?: Record<string, unknown>): Promise<T> => {
    const u = `${base}${path}${path.includes("?") ? "&" : "?"}_envelope=1`;
    const res = await fetch(u, {
      method: body ? "POST" : "GET",
      headers: { ...auth, Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; TroLyAI-SEONGON/1.0)", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    console.log("WPCOM", body ? "POST" : "GET", u.replace(/\?.*/, ""), res.status, res.headers.get("content-type"), text.length, res.headers.get("location") ?? "", text.slice(0, 300));
    if (res.status >= 300 && res.status < 400) throw new Error(`WordPress chuyển hướng ${res.status} → ${res.headers.get("location") ?? "?"}`);
    let env: { status?: number; body?: any } | null = null;
    try { env = text ? JSON.parse(text) : null; } catch {}
    if (!env || typeof env !== "object") throw new Error(`WordPress trả về rỗng (mã ${res.status}, ${text.length} ký tự${text ? `: ${text.slice(0, 120)}` : ""})`);
    if (!("body" in env)) return env as T; // trang không hỗ trợ "bọc kết quả" → dữ liệu trả thẳng
    if ((env.status ?? res.status) >= 400) throw new Error(`HTTP ${env.status}: ${env.body?.message || env.body?.code || "lỗi"}`);
    return env.body as T;
  };
}
type Rest = ReturnType<typeof makeRest>;
type CreatedPage = { kind: string; id: number; url: string; title: string };

/** Tạo (hoặc cập nhật nếu đã có cùng slug) 1 trang — thử cổng chung trước, rồi chính tên miền trang. */
async function createPage(rest: Rest, siteId: string, siteUrl: string, p: SocialPage): Promise<CreatedPage> {
  const r = await wpTry(`tạo trang “${p.title}”`, [
    ...[`${V2}/${siteId}`, `${siteUrl}/wp-json/wp/v2`].map((base) => async () => {
      const data = { status: "publish", title: p.title, slug: p.slug, content: p.html || "" };
      const find = async () => (await rest<{ id: number; link: string }[]>(base, `/pages?slug=${encodeURIComponent(p.slug)}&status=publish,draft,private&context=edit`).catch(() => []))?.[0];
      const old = await find();
      const x = await rest<{ id: number; link: string } | null>(base, old ? `/pages/${old.id}` : "/pages", data);
      const got = x?.id ? x : await find();
      if (!got?.id) throw new Error("không xác nhận được trang đã tạo");
      return { id: got.id, url: got.link };
    }),
  ]);
  return { kind: p.kind, id: r.id, url: r.url, title: p.title };
}

/** Khoảng cách giữa 2 trang dựng liên tiếp: ~4 phút (± 30 giây) → 4 trang xong trong khoảng 15 phút, tránh bị WordPress coi là máy spam. */
export const WP_GAP_MS = 4 * 60_000;
const gap = () => WP_GAP_MS + Math.round((Math.random() - 0.5) * 60_000);

export async function createWpcomSocial(env: Env, acc: WpcomAccount, brand: string, tpl: SocialTemplate, siteId?: string, clean = false) {
  const auth = { Authorization: `Bearer ${acc.token}` };
  const call = <T>(path: string, body: Record<string, unknown>) =>
    fetchJson<T>("WordPress.com", `${API}${path}`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) }, 60_000);
  const rest = makeRest(acc.token);
  const v2 = <T>(path: string, body?: Record<string, unknown>) => rest<T>(`${V2}/${siteId}`, path, body);

  // 1. Trang người dùng đã tạo sẵn: WordPress.com chỉ cho chính trang đăng ký của họ tạo trang mới
  //    (app ngoài gọi /sites/new luôn bị "Invalid client_id") → người dùng tạo trang trống 1 lần, chọn trong app.
  if (!siteId) throw new Error("Chưa chọn trang WordPress.com — tạo trang trống trên WordPress.com rồi chọn ở bước 3");
  const url = await wpTry("đọc thông tin trang", [
    async () => (await v2<{ url?: string; home?: string }>("")).home || (await v2<{ url?: string }>("")).url || "",
    async () => (await fetchJson<{ URL: string }>("WordPress.com", `${API}/sites/${siteId}?fields=ID,URL`, { headers: auth })).URL,
    async () => (await listWpcomSites(acc)).find((x) => x.id === String(siteId))?.url ?? "",
  ].map((f) => async () => { const u = await f(); if (!u) throw new Error("không có địa chỉ"); return u; }));
  const site = { blogid: String(siteId), url: url.replace(/\/+$/, "") };
  if ((await fetch(site.url, { signal: AbortSignal.timeout(8000) }).then((r) => r.status).catch(() => 0)) === 410) {
    throw new Error(`Trang ${site.url} đang không dùng được trên WordPress.com (đã bị xoá hoặc bị WordPress tạm khoá). Chọn trang khác, hoặc khôi phục / kháng nghị trên WordPress.com rồi thử lại.`);
  }

  // 1b. Xoá sạch nội dung cũ (trang + bài) trước khi dựng — chỉ khi người dùng tích chọn
  if (clean) {
    for (const base of [`${V2}/${siteId}`, `${site.url}/wp-json/wp/v2`]) {
      try {
        for (const kind of ["pages", "posts"]) {
          for (let round = 0; round < 5; round++) {
            const items = await rest<{ id: number }[]>(base, `/${kind}?per_page=100&status=publish,draft,pending,private,future&context=edit&_fields=id`);
            if (!Array.isArray(items) || !items.length) break;
            for (const it of items) await rest(base, `/${kind}/${it.id}?force=true&_method=DELETE`, {}).catch(() => null);
          }
        }
        break; // cách này chạy được → khỏi thử cách sau
      } catch {}
    }
  }

  // 2. Dựng TRANG CHỦ ngay; các trang còn lại xếp hàng, chương trình nền dựng từng trang cách nhau ~4 phút
  const homeTpl = tpl.pages.find((p) => p.kind === "home") ?? tpl.pages[0]!;
  const home = await createPage(rest, site.blogid, site.url, homeTpl);
  const later = tpl.pages.filter((p) => p !== homeTpl);

  // 3. Trang chủ làm trang đầu, đặt mô tả trang, mở công khai (trang mới mặc định "Sắp ra mắt" → Google không quét được)
  await v2("/settings", { show_on_front: "page", page_on_front: home.id, description: tpl.tagline }).catch(() => null);
  await call(`/sites/${site.blogid}/settings`, {
    show_on_front: "page",
    page_on_front: home.id,
    blogdescription: tpl.tagline,
    blog_public: 1,
    wpcom_coming_soon: 0,
    wpcom_public_coming_soon: 0,
  }).catch(() => null);
  const launched = await call(`/sites/${site.blogid}/launch`, {})
    .then(() => true)
    .catch(() => false);

  // Kiểm tra Google quét được: trang chủ trả 200 và không có thẻ chặn index
  const hp = await fetch(site.url, { redirect: "follow" }).then(async (r) => ({ status: r.status, html: await r.text() })).catch(() => ({ status: 0, html: "" }));
  const indexable = hp.status === 200 && !/<meta[^>]+name=["']robots["'][^>]+noindex/i.test(hp.html) && !/coming soon/i.test(hp.html.slice(0, 5000));

  return {
    indexable,
    launched,
    siteUrl: site.url,
    siteId: site.blogid,
    adminUrl: `https://wordpress.com/home/${new URL(site.url).hostname}`,
    // các trang chưa dựng: hiện địa chỉ dự kiến, chương trình nền dựng xong sẽ thay bằng địa chỉ thật
    pages: tpl.pages.map((p) => ({ label: SOCIAL_PAGE_LABEL[p.kind], url: p === homeTpl ? home.url : `${site.url}/${p.slug}/` })),
    wpQueue: { siteUrl: site.url, pages: later, created: [home] as CreatedPage[] },
  };
}

/** Agent: trang WordPress còn "Sắp ra mắt" / chặn Google → bật công khai lại. */
export async function wpRelaunch(env: Env, owner: string, siteId: string) {
  const acc = await wpcomAccount(env, owner);
  if (!acc) return false;
  const h = { Authorization: `Bearer ${acc.token}`, "Content-Type": "application/json" };
  await fetch(`${API}/sites/${siteId}/settings`, { method: "POST", headers: h, body: JSON.stringify({ blog_public: 1, wpcom_coming_soon: 0, wpcom_public_coming_soon: 0 }) }).catch(() => null);
  await fetch(`${API}/sites/${siteId}/launch`, { method: "POST", headers: h, body: "{}" }).catch(() => null);
  return true;
}

// ── Hàng chờ dựng trang WordPress (chạy nền mỗi phút bằng Cloudflare Cron) ──
export type WpJob = { id: string; owner: string; siteId: string; siteUrl: string; recId: string; pages: SocialPage[]; created: CreatedPage[]; next: number; tries?: number; error?: string; repair?: boolean };
/** Site này còn trang đang chờ dựng không (để người kiểm tra biết mà đợi). */
export const wpJobPending = async (env: Env, owner: string, siteId: string) => (await readQ(env)).some((j) => j.owner === owner && j.siteId === siteId);
const QKEY = "wp-queue";
const readQ = async (env: Env) => (await env.DATA.get<WpJob[]>(QKEY, "json")) ?? [];

export async function enqueueWpJob(env: Env, job: Omit<WpJob, "id" | "next">) {
  if (!job.pages.length) return;
  const q = (await readQ(env)).filter((j) => !(j.owner === job.owner && j.siteId === job.siteId)); // dựng lại cùng trang → bỏ lượt cũ
  q.push({ ...job, id: crypto.randomUUID(), next: Date.now() + gap() });
  await env.DATA.put(QKEY, JSON.stringify(q));
}

/** Đến giờ thì dựng 1 trang cho mỗi site trong hàng chờ. onPage: cập nhật địa chỉ thật vào danh sách social. */
export async function runWpQueue(env: Env, now: number, onPage: (job: WpJob, page: CreatedPage) => Promise<void>) {
  const q = await readQ(env);
  if (!q.length) return;
  const keep: WpJob[] = [];
  for (const job of q) {
    if (job.next > now) { keep.push(job); continue; }
    const acc = await wpcomAccount(env, job.owner);
    if (!acc) continue; // dự án đã ngắt kết nối → bỏ
    const rest = makeRest(acc.token);
    const p = job.pages[0]!;
    try {
      const page = await createPage(rest, job.siteId, job.siteUrl, p);
      job.created.push(page);
      job.pages = job.pages.slice(1);
      job.tries = 0;
      await onPage(job, page).catch(() => null);
    } catch (e) {
      job.tries = (job.tries ?? 0) + 1;
      job.error = e instanceof Error ? e.message : String(e);
      if (job.tries >= 3) { console.log("WPCOM queue bỏ", job.siteUrl, job.error); continue; }
      job.next = now + 60_000;
      keep.push(job);
      continue;
    }
    if (job.pages.length) { job.next = now + gap(); keep.push(job); continue; }
    if (job.repair) continue; // dựng bù trang thiếu: giữ nguyên menu / cài đặt cũ
    // Trang cuối xong: đặt trang Blog làm trang danh sách bài + menu chính
    const blog = job.created.find((c) => c.kind === "blog")?.id;
    const homeId = job.created.find((c) => c.kind === "home")?.id;
    await rest(`${V2}/${job.siteId}`, "/settings", { show_on_front: "page", page_on_front: homeId, page_for_posts: blog }).catch(() => null);
    const call = <T>(path: string, body: Record<string, unknown>) =>
      fetchJson<T>("WordPress.com", `${API}${path}`, { method: "POST", headers: { Authorization: `Bearer ${acc.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }, 60_000);
    await call(`/sites/${job.siteId}/settings`, { page_for_posts: blog }).catch(() => null);
    const items = job.created.map((c, i) => ({ content_id: c.id, type: "page", type_family: "post_type", name: c.title, order: i + 1 }));
    await call<{ id?: number }>(`/sites/${job.siteId}/menus/new`, { name: "Menu chính" })
      .then((m) => (m.id ? call(`/sites/${job.siteId}/menus/${m.id}`, { name: "Menu chính", items, locations: [{ name: "primary" }] }) : null))
      .catch(() => null);
  }
  // ghi lại (đọc lại để không đè lượt mới được thêm trong lúc chạy)
  const fresh = await readQ(env);
  const doneIds = new Set(q.map((j) => j.id));
  await env.DATA.put(QKEY, JSON.stringify([...keep, ...fresh.filter((j) => !doneIds.has(j.id))]));
}

export type WpcomSiteInfo = { id: string; name: string; url: string; posts: number; deleted?: boolean };
/** Các trang WordPress.com của tài khoản đã kết nối — người dùng chọn trang trống vừa tạo để dựng social. */
export async function listWpcomSites(acc: WpcomAccount): Promise<WpcomSiteInfo[]> {
  const r = await fetchJson<{ sites?: { ID: number; name: string; URL: string; post_count?: number; jetpack?: boolean; is_wpcom_atomic?: boolean }[] }>(
    "WordPress.com", `${API}/me/sites?fields=ID,name,URL,post_count,jetpack`, { headers: { Authorization: `Bearer ${acc.token}` } });
  const list = (r.sites ?? []).filter((x) => /\.wordpress\.com/.test(x.URL) || !x.jetpack).map((x) => ({ id: String(x.ID), name: x.name, url: x.URL.replace(/^http:/, "https:"), posts: x.post_count ?? 0 }));
  // kiểm tra từng trang còn sống không: trang đã xoá trả mã 410 "The authors have deleted this site"
  return Promise.all(list.map(async (x) => {
    const st = await fetch(x.url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(8000) }).then((res) => res.status).catch(() => 0);
    return { ...x, deleted: st === 410 };
  }));
}
