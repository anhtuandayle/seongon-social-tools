// Cổng API của AI Agent (Cloudflare Worker + Hono). Giao diện web tĩnh được phục vụ cùng địa chỉ (assets).
//
// Không cần đăng nhập:
//   POST /api/auth/request   — gửi mã 6 số về email (chỉ email được phép)
//   POST /api/auth/verify    — kiểm tra mã -> tạo phiên (cookie HttpOnly)
//   POST /api/auth/logout
//   GET  /api/me             — đang đăng nhập bằng email nào (401 nếu chưa)
// Cần đăng nhập (mỗi người chỉ thấy dữ liệu của mình):
//   POST /api/me/gemini      — lưu/xoá khoá Gemini cá nhân (mã hoá)
//   GET  /api/projects | POST /api/projects | GET/DELETE /api/projects/:id
//   POST /api/generate | /api/sheet | /api/other/plan | /api/publish
//   GET/POST /api/runs       — lịch sử chạy
import { Hono, type Context } from "hono";
import { callAIJson, GEMINI_FALLBACK, generateContent, parseJsonLoose } from "./ai";
import { usFetch } from "./egress";
import { generateSocialTemplate, SOCIAL_PAGE_LABEL, type SocialPage, type SocialTemplate } from "./social/template";
import { fillFromSite, luminance, scrapeBrand, type SiteBrand } from "./social/scrape";
import { postToSocial, redeploySite, snapKey, textToHtml, type SiteSnapshot } from "./social/post";
import { removeOnPlatform } from "./social/remove";
import { createMastodon } from "./social/mastodon";
import { createTumblrSocial, listTumblrBlogs, saveTumblrApp, tumblrAccount, tumblrApp, tumblrAuthorizeUrl, tumblrDisconnect, tumblrFinish, tumblrRedirectUri } from "./social/tumblr";
import { getTrackSheet, inspectSheet, setTrackSheet, sheetsAccount, sheetsAuthorizeUrl, sheetsDisconnect, sheetsFinish, type TrackMap, writeLinksToSheet } from "./social/gsheets";
import { bloggerAccount, bloggerAuthorizeUrl, bloggerDisconnect, bloggerFinish, createBloggerSocial, googleApp, googleRedirectUri, listBlogs, saveGoogleApp } from "./social/blogger";
import { getConns, setConn, type TokenPlatform, verifyToken } from "./social/connections";
import { createCodebergPages, createGithubPages, createNetlify, createTelegraph, createVercel, telegraphAccount } from "./social/hosts";
import { agentLog, cancelRetry, checkPage, type CheckReport, diagnoseAI, diagnoseRule, enqueueCheck, enqueueRetry, pendingRetries, readAgentLog, requeueCheck, requeueRetry, runWithAgent, takeDueChecks, takeDueRetries, type Diagnosis } from "./social/agent";
import { createWpcomSocial, enqueueWpJob, runWpQueue, wpJobPending, wpRelaunch, listWpcomSites, saveWpcomApp, wpcomAccount, wpcomApp, wpcomAuthorizeUrl, wpcomDisconnect, wpcomFinish, wpcomHasOwnApp, wpcomRedirectUri } from "./social/wpcom";
export { UsEgress } from "./egress"; // Cloudflare cần lớp Durable Object được export từ file chính
import type { Next } from "hono";
import { type AppEnv, currentEmail, logout, requestOtp, requireAuth, verifyOtp } from "./auth";
import { PLATFORMS, publishAll } from "./publishers";
import { planOther } from "./publishers/other";
import { larkReady, validWebhook } from "./lark";
import { deliver, runReminders, sendPreview, type Setting, vnNow } from "./reminders";
import { readSheet } from "./sheet";
import {
  addRun,
  clearSecret,
  deleteProject,
  encrypt,
  getGeminiKey,
  getProject,
  getProjectCredentials,
  listProjects,
  listRuns,
  saveProject,
  setGeminiKey,
} from "./store";
import type { BusinessInfo, Env, GeneratedContent, Platform, PublishResult } from "./types";
import { errorMessage, escapeAttr, HttpError } from "./util";

const app = new Hono<AppEnv>();

const fail = (c: Context<AppEnv>, e: unknown) => c.json({ error: errorMessage(e) }, e instanceof HttpError ? 502 : 400);

// ---------- Đăng nhập ----------

app.post("/api/auth/request", async (c) => {
  try {
    const { email } = await c.req.json<{ email?: string }>();
    if (!email) throw new Error("Nhập email để nhận mã");
    return c.json({ ok: true, ...(await requestOtp(c, email)) });
  } catch (e) {
    return fail(c, e);
  }
});

app.post("/api/auth/verify", async (c) => {
  try {
    const { email, code } = await c.req.json<{ email?: string; code?: string }>();
    if (!email || !code) throw new Error("Nhập email và mã");
    return c.json(await verifyOtp(c, email, code));
  } catch (e) {
    return fail(c, e);
  }
});

app.post("/api/auth/logout", async (c) => {
  await logout(c);
  return c.json({ ok: true });
});

app.get("/api/me", async (c) => {
  const email = await currentEmail(c);
  if (!email) return c.json({ error: "Chưa đăng nhập", needLogin: true }, 401);
  return c.json({
    email,
    hasGeminiKey: Boolean(await getGeminiKey(c.env, email)),
    hasSharedKey: Boolean(c.env.GEMINI_API_KEY || c.env.OPENAI_API_KEY),
  });
});

// ---------- Từ đây trở xuống: bắt buộc đăng nhập ----------

// Share social (Netlify) gọi sang cổng bằng "vé liên kết" do cổng ký; các đường khác vẫn cần đăng nhập cổng
app.use("/api/*", async (c, next) => (c.req.path.startsWith("/api/lien-ket/") ? linkAuth(c, next) : requireAuth(c, next)));

const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
async function shareKey(env: Env, use: "sign" | "verify") {
  if (!env.SHARE_SIGNING_KEY) throw new Error("Chưa nối với Share social đa kênh — quản trị cần cài SHARE_SIGNING_KEY.");
  const jwk = JSON.parse(env.SHARE_SIGNING_KEY) as JsonWebKey;
  const k = use === "verify" ? { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } : jwk;
  return crypto.subtle.importKey("jwk", k, { name: "ECDSA", namedCurve: "P-256" }, false, [use]);
}
async function signShare(env: Env, data: object) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify(data)));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await shareKey(env, "sign"), new TextEncoder().encode(payload));
  return `${payload}.${b64url(sig)}`;
}
async function linkAuth(c: Context<AppEnv>, next: Next) {
  try {
    const tok = (c.req.header("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const [payload, sig] = tok.split(".");
    if (!payload || !sig) throw new Error("x");
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, await shareKey(c.env, "verify"), unb64url(sig), new TextEncoder().encode(payload));
    const d = JSON.parse(new TextDecoder().decode(unb64url(payload))) as { email?: string; muc?: string; het_han?: number };
    if (!ok || d.muc !== "lien-ket" || !d.email || !(d.het_han! > Date.now())) throw new Error("x");
    c.set("email", d.email.toLowerCase());
    return next();
  } catch {
    return c.json({ error: "Vé liên kết không hợp lệ hoặc đã hết hạn — mở Share social từ cổng Trợ lý AI để liên kết lại", needLink: true }, 401);
  }
}

/**
 * Khoá Gemini có 2 loại: khoá Google AI Studio (cổng generativelanguage) và khoá Google Cloud /
 * Vertex AI express (cổng aiplatform). Thử lần lượt, loại nào Google nhận thì dùng loại đó.
 */
async function detectKeyKind(env: Env, key: string, model: string): Promise<{ kind: "studio" | "vertex" | null; error?: string }> {
  const fetch = usFetch(env);
  const errOf = async (res: Response | null) =>
    res ? (((await res.json().catch(() => null)) as any)?.error?.message ?? `HTTP ${res.status}`) : "không kết nối được Google";
  const studio = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
    headers: { "x-goog-api-key": key },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (studio?.ok) return { kind: "studio" };
  const vertex = await fetch(
    `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Trả lời: ok" }] }], generationConfig: { maxOutputTokens: 5 } }),
      signal: AbortSignal.timeout(20_000),
    },
  ).catch(() => null);
  if (vertex?.ok) return { kind: "vertex" };
  return { kind: null, error: `AI Studio: ${await errOf(studio)} | Google Cloud (Vertex AI): ${await errOf(vertex)}` };
}

/** Mỗi người dùng khoá AI của mình; chưa có thì dùng khoá chung của máy chủ (nếu quản trị đã cài). */
async function envFor(c: Context<AppEnv>): Promise<Env> {
  const stored = await getGeminiKey(c.env, c.get("email"));
  if (stored) {
    const [, kind, key] = stored.match(/^(studio|vertex):([\s\S]+)$/) ?? [null, "studio", stored];
    return { ...c.env, AI_PROVIDER: "gemini", GEMINI_API_KEY: key, GEMINI_ENDPOINT: kind === "vertex" ? "vertex" : undefined };
  }
  if (!c.env.GEMINI_API_KEY && !c.env.OPENAI_API_KEY) {
    throw new Error('Chưa có khoá Gemini — bấm "Cài đặt" ở góc trên để dán khoá của bạn');
  }
  return c.env;
}

app.post("/api/me/gemini", async (c) => {
  try {
    const { key } = await c.req.json<{ key?: string }>();
    const k = (key ?? "").trim();
    let kind: "studio" | "vertex" | null = null;
    if (k) {
      // Không đoán theo hình dạng khoá (Google đã đổi định dạng) — gọi thử Google để chắc khoá dùng được.
      if (/\s/.test(k) || k.length < 20 || k.length > 400) throw new Error("Khoá Gemini không hợp lệ — hãy sao chép lại đủ cả dãy");
      const tried = await detectKeyKind(c.env, k,c.env.GEMINI_MODEL || GEMINI_FALLBACK[0]);
      if (!tried.kind) throw new Error(`Google từ chối khoá này: ${tried.error}`);
      kind = tried.kind;
    }
    // Lưu kèm loại khoá để lần sau gọi đúng cổng.
    await setGeminiKey(c.env, c.get("email"), k ? `${kind}:${k}` : null);
    return c.json({ ok: true, hasGeminiKey: Boolean(k), kind });
  } catch (e) {
    return fail(c, e);
  }
});

// ---------- Dự án ----------

app.get("/api/projects", async (c) => c.json({ projects: await listProjects(c.env, c.get("email")) }));

app.get("/api/projects/:id", async (c) => {
  const p = await getProject(c.env, c.get("email"), c.req.param("id"));
  return p ? c.json({ project: p }) : c.json({ error: "Không tìm thấy dự án" }, 404);
});

app.post("/api/projects", async (c) => {
  try {
    const body = await c.req.json<any>();
    const selected = (Array.isArray(body.selected) ? body.selected : []).filter((p: Platform) => PLATFORMS.includes(p));
    return c.json({
      project: await saveProject(c.env, c.get("email"), {
        id: body.id || undefined,
        name: String(body.name ?? ""),
        business: body.business ?? {},
        selected,
        sheetUrl: typeof body.sheetUrl === "string" ? body.sheetUrl.slice(0, 500) : undefined,
        credentials: body.credentials ?? {},
      }),
    });
  } catch (e) {
    return fail(c, e);
  }
});

app.post("/api/projects/:id/clear-secret", async (c) => {
  const { platform, field } = await c.req.json<{ platform: Platform; field: string }>();
  await clearSecret(c.env, c.get("email"), c.req.param("id"), platform, field);
  return c.json({ ok: true });
});

app.delete("/api/projects/:id", async (c) => {
  await deleteProject(c.env, c.get("email"), c.req.param("id"));
  await clearSocialProject(c.env, `${c.get("email")}#${c.req.param("id")}`);
  return c.json({ ok: true });
});

// ---------- Tạo nội dung & đăng ----------

function validateBusiness(b: Partial<BusinessInfo> | undefined): BusinessInfo {
  if (!b?.brandName?.trim()) throw new Error("Thiếu Tên thương hiệu");
  if (!b.industry?.trim()) throw new Error("Thiếu Ngành nghề");
  try {
    const u = new URL(b.targetUrl ?? "");
    if (!/^https?:$/.test(u.protocol)) throw new Error();
  } catch {
    throw new Error("Đường dẫn Website chính không hợp lệ (cần bắt đầu bằng https://)");
  }
  return {
    brandName: b.brandName.trim(),
    industry: b.industry.trim(),
    slogan: (b.slogan ?? "").trim(),
    logoUrl: (b.logoUrl ?? "").trim(),
    targetUrl: b.targetUrl!.trim(),
    brandColor: /^#[0-9a-f]{6}$/i.test(b.brandColor ?? "") ? b.brandColor!.toLowerCase() : "#0d53f0",
    ...Object.fromEntries(
      (["companyName", "about", "products", "address", "phone", "email", "hashtags"] as const)
        .map((k) => [k, String(b[k] ?? "").trim().slice(0, 3000)])
        .filter(([, v]) => v),
    ),
  };
}

app.post("/api/generate", async (c) => {
  try {
    const body = await c.req.json<{ business?: Partial<BusinessInfo> }>();
    const business = validateBusiness(body.business);
    return c.json({ content: await generateContent(await envFor(c), business) });
  } catch (e) {
    return fail(c, e);
  }
});

app.post("/api/sheet", async (c) => {
  try {
    const body = await c.req.json<{ url?: string; csv?: string }>();
    if ((body.csv?.length ?? 0) > 1_000_000) throw new Error("File CSV quá lớn (tối đa 1MB)");
    // Sheet dạng quen thuộc đọc được không cần AI -> chỉ báo thiếu khoá khi thật sự cần AI đọc hộ.
    const env = await envFor(c).catch(() => c.env);
    return c.json(await readSheet(env, body));
  } catch (e) {
    return fail(c, e);
  }
});

// "Phương án khác": AI tìm cách kết nối 1 nền tảng bất kỳ, trả về kế hoạch + hướng dẫn lấy khoá
app.post("/api/other/plan", async (c) => {
  try {
    const body = await c.req.json<{ domain?: string }>();
    if (!body.domain?.trim()) throw new Error("Chưa nhập tên miền nền tảng");
    return c.json({ plan: await planOther(await envFor(c), body.domain) });
  } catch (e) {
    return fail(c, e);
  }
});

/** Đăng bài: khoá lấy từ dự án đã lưu (giải mã ở máy chủ), không nhận khoá từ trình duyệt. */
app.post("/api/publish", async (c) => {
  try {
    const body = await c.req.json<{
      projectId?: string;
      business?: Partial<BusinessInfo>;
      content?: GeneratedContent;
      platforms?: Platform[];
    }>();
    const business = validateBusiness(body.business);
    const platforms = (body.platforms ?? []).filter((p) => PLATFORMS.includes(p));
    if (!platforms.length) throw new Error("Chưa chọn nền tảng nào");
    if (!body.content?.pages?.length) throw new Error("Chưa có nội dung để đăng — hãy chạy bước sinh nội dung trước");
    if (!body.projectId) throw new Error("Hãy lưu dự án trước khi đăng");
    const creds = await getProjectCredentials(c.env, c.get("email"), body.projectId);
    if (!creds) throw new Error("Không tìm thấy dự án — hãy lưu lại dự án");
    // "Phương án khác" có thể cần AI lập kế hoạch -> dùng khoá AI của người dùng nếu có.
    const env = platforms.includes("other") ? await envFor(c).catch(() => c.env) : c.env;
    return c.json({ results: await publishAll(env, platforms, creds, body.content, business) });
  } catch (e) {
    return fail(c, e);
  }
});

// ---------- Thư ký công việc (/thu-ky) ----------
// Mỗi người 1 dòng trong D1; ứng dụng gửi cả bộ dữ liệu (JSON) — gom 1,5 giây/lần nên số lần ghi thấp.

app.get("/api/thu-ky", async (c) => {
  const row = await c.env.DB.prepare("SELECT data, updated_at FROM thu_ky WHERE email = ?")
    .bind(c.get("email"))
    .first<{ data: string; updated_at: string }>();
  if (c.req.query("meta")) return c.json({ updatedAt: row?.updated_at ?? "" });
  return c.json({ email: c.get("email"), data: row?.data ?? null, updatedAt: row?.updated_at ?? "" });
});

app.put("/api/thu-ky", async (c) => {
  try {
    const { data } = await c.req.json<{ data?: string }>();
    if (typeof data !== "string" || !data) throw new Error("Thiếu dữ liệu");
    if (data.length > 2_000_000) throw new Error("Dữ liệu quá lớn (tối đa 2MB) — hãy dọn bớt Kho lưu trữ");
    const parsed = JSON.parse(data);
    if (!parsed || !Array.isArray(parsed.tasks)) throw new Error("Dữ liệu không đúng định dạng Thư ký công việc");
    const updatedAt = new Date().toISOString();
    await c.env.DB.prepare(
      "INSERT INTO thu_ky (email, data, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(email) DO UPDATE SET data = ?2, updated_at = ?3",
    )
      .bind(c.get("email"), data, updatedAt)
      .run();
    return c.json({ ok: true, updatedAt });
  } catch (e) {
    return fail(c, e);
  }
});

// ---------- Lộ trình học tập (/hoc-tap) ----------
// Hệ thống học tập chạy riêng trên Google Apps Script. Cổng đã xác minh email bằng mã OTP,
// nên ở đây chỉ xin hộ một "vé" rồi trả địa chỉ kèm vé cho trang nhúng.
// Vé KHÔNG bao giờ đi qua trình duyệt dưới dạng có thể đọc lại được từ lịch sử của cổng:
// trang nhúng nhận địa chỉ rồi gắn thẳng vào khung, không ghi lên thanh địa chỉ.

app.get("/api/hoc-tap/ve", async (c) => {
  try {
    const url = c.env.HOC_TAP_URL;
    const secret = c.env.HOC_TAP_SECRET;
    if (!url || !secret) {
      throw new Error(
        "Chưa nối với hệ thống học tập. Quản trị viên cần cài HOC_TAP_URL và HOC_TAP_SECRET cho Worker.",
      );
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hanh_dong: "tao_ve",
        khoa: secret,
        email: c.get("email"),
        ho_ten: c.get("email").split("@")[0],
      }),
      redirect: "follow",
    });
    const text = await res.text();
    let data: { ok?: boolean; ve?: string; loi?: string; vai_tro?: string };
    try {
      data = JSON.parse(text);
    } catch {
      // Apps Script trả trang HTML khi chưa triển khai đúng quyền "Bất kỳ ai"
      throw new Error("Hệ thống học tập trả về nội dung lạ — kiểm tra lại địa chỉ và quyền triển khai.");
    }
    if (!data.ok || !data.ve) throw new Error(data.loi || "Hệ thống học tập từ chối cấp vé.");

    return c.json({
      url: `${url}${url.includes("?") ? "&" : "?"}ve=${encodeURIComponent(data.ve)}`,
      vaiTro: data.vai_tro ?? "hoc_vien",
    });
  } catch (e) {
    return fail(c, e);
  }
});

// Giao diện học tập chạy ngay trên cổng (/hoc-tap/): trình duyệt gửi tên lệnh + tham số,
// cổng tự giữ vé của từng người (trình duyệt không thấy vé) rồi chuyển lệnh sang Apps Script.
// Nhờ vậy không phải mở trang script.google.com — trang đó lỗi khi Chrome đăng nhập nhiều tài khoản Google.
async function hocTapVe(env: Env, email: string, lamMoi: boolean): Promise<string> {
  const key = `hoctap-ve:${email}`;
  if (!lamMoi) {
    const cu = await env.DATA.get(key);
    if (cu) return cu;
  }
  const res = await fetch(env.HOC_TAP_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hanh_dong: "tao_ve", khoa: env.HOC_TAP_SECRET, email, ho_ten: email.split("@")[0] }),
    redirect: "follow",
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; ve?: string; loi?: string };
  if (!data.ok || !data.ve) throw new Error(data.loi || "Hệ thống học tập từ chối cấp vé.");
  await env.DATA.put(key, data.ve, { expirationTtl: 6 * 86400 });
  return data.ve;
}

app.post("/api/hoc-tap/goi", async (c) => {
  try {
    const env = c.env;
    if (!env.HOC_TAP_URL || !env.HOC_TAP_SECRET) {
      throw new Error("Chưa nối với hệ thống học tập. Quản trị viên cần cài HOC_TAP_URL và HOC_TAP_SECRET cho Worker.");
    }
    const { ten, thamSo } = await c.req.json<{ ten?: string; thamSo?: unknown[] }>();
    if (typeof ten !== "string" || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(ten)) throw new Error("Yêu cầu không hợp lệ.");
    const email = c.get("email");

    const goi = async (ve: string) => {
      const res = await fetch(env.HOC_TAP_URL!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hanh_dong: "goi_ham", khoa: env.HOC_TAP_SECRET, ve, ten, tham_so: Array.isArray(thamSo) ? thamSo : [] }),
        redirect: "follow",
      });
      const text = await res.text();
      try {
        return JSON.parse(text) as { ok?: boolean; kq?: unknown; loi?: string; loi_ham?: boolean };
      } catch {
        throw new Error("Hệ thống học tập trả về nội dung lạ — kiểm tra lại địa chỉ và quyền triển khai.");
      }
    };

    let kq = await goi(await hocTapVe(env, email, false));
    // Vé hết hạn hoặc bị xoá → xin vé mới rồi thử lại đúng 1 lần
    if (!kq.ok && /hết hạn|đăng nhập lại/.test(kq.loi ?? "")) kq = await goi(await hocTapVe(env, email, true));
    if (!kq.ok && !kq.loi_ham && kq.loi === "Yêu cầu không hợp lệ.") {
      kq.loi = "Hệ thống học tập chưa cập nhật bản mới (thiếu lệnh goi_ham). Quản trị viên cần dán Code.gs mới và triển khai lại.";
    }
    return c.json(kq.ok ? { ok: true, kq: kq.kq ?? null } : { ok: false, loi: kq.loi || "Lỗi không rõ" });
  } catch (e) {
    return fail(c, e);
  }
});

// Trang Sửa lỗi (/sua-loi/): người dùng dán thông báo lỗi → AI giải thích nguyên nhân + cách tự khắc phục.
// Trình duyệt gửi kèm các mục tra cứu khớp nhất trong bảng rủi ro để AI bám vào cách sửa đã biết.
const KIEN_TRUC = `Hệ thống "Trợ lý AI SEONGON" của người dùng (không rành kỹ thuật):
- Cổng web https://seongon.tro-ly-ai.workers.dev: Cloudflare Worker "social-creator" (Hono + web tĩnh Next.js), lưu dữ liệu ở Cloudflare KV và D1,
  đăng nhập bằng mã OTP gửi qua email (Brevo), chỉ email @seongon.com. Gọi AI bằng khoá Gemini riêng của từng người. Có lịch chạy mỗi 15 phút để nhắc việc qua Lark (webhook bot nhóm).
- Code ở GitHub anhtuandayle/tro-ly-ai-seongon; đẩy lên nhánh main thì Cloudflare Workers Builds tự build và triển khai (~1–2 phút).
- Công cụ: Tạo social (đăng WordPress, Blogger, Pinterest, Wix, Google Sites), Thư ký công việc (/thu-ky/), Lộ trình học tập (/hoc-tap/ — chạy trên Google Apps Script + Google Sheet + Gemini, cổng chuyển lệnh qua doPost),
  Share social đa kênh (Netlify: quan-ly-cong-viec-sn.netlify.app, vào bằng vé ký số từ cổng).
- Máy tính cá nhân: Claude Code (trợ lý lập trình), Git portable ở D:\\Claude Code\\AI Agent\\Git, Node ở D:\\Claude Code\\AI Agent\\Node; các bí mật nằm trong file *.local.json và Cloudflare secrets.
- Dự án share Techcombank: chương trình nền runner.js trên máy cá nhân đăng bài lên Blogger, WordPress.com, Wix, Webflow rồi ghi link vào Google Sheet.`;

app.post("/api/sua-loi", async (c) => {
  try {
    const { loi, congCu, goiY } = await c.req.json<{ loi?: string; congCu?: string; goiY?: string }>();
    const text = String(loi ?? "").trim();
    if (!text) throw new Error("Dán thông báo lỗi (hoặc mô tả hiện tượng) vào trước đã");
    const raw = await callAIJson(await envFor(c), {
      system: `Bạn là kỹ sư hỗ trợ, giải thích cho người KHÔNG rành kỹ thuật, bằng tiếng Việt đời thường.
${KIEN_TRUC}

Người dùng dán thông báo lỗi hoặc mô tả hiện tượng. Hãy:
- nguyen_nhan: 1–3 câu, nói lỗi này nghĩa là gì và vì sao xảy ra. Thuật ngữ nào buộc phải dùng thì giải thích ngay sau đó.
- muc_do: "nhe" (tự sửa được trong vài phút), "vua" (cần làm vài bước cài đặt), "nang" (cần người biết kỹ thuật / dữ liệu có thể bị ảnh hưởng).
- cach_sua: các bước cụ thể, đánh theo thứ tự, mỗi bước 1 việc, nói rõ bấm vào đâu / mở trang nào. Ưu tiên cách an toàn, không xoá dữ liệu.
- neu_khong_duoc: 1–2 câu: làm gì tiếp nếu các bước trên không được.
- tin_nhan_nho_giup: một tin nhắn ngắn người dùng có thể gửi cho người kỹ thuật hoặc dán vào AI khác (Codex/ChatGPT) để nhờ sửa — có tóm tắt lỗi và bối cảnh.
Nếu có "Gợi ý từ bảng rủi ro" thì bám vào đó trước. Không bịa tên nút/trang không có thật; không chắc thì nói "kiểm tra xem…".
Trả về JSON: {"nguyen_nhan":"","muc_do":"nhe","cach_sua":[""],"neu_khong_duoc":"","tin_nhan_nho_giup":""}`,
      user: `Công cụ đang dùng: ${String(congCu ?? "không rõ").slice(0, 100)}\n\nThông báo lỗi / hiện tượng:\n${text.slice(0, 6000)}\n\nGợi ý từ bảng rủi ro:\n${String(goiY ?? "(không có)").slice(0, 4000)}`,
      geminiSchema: {
        type: "OBJECT",
        properties: {
          nguyen_nhan: { type: "STRING" },
          muc_do: { type: "STRING", enum: ["nhe", "vua", "nang"] },
          cach_sua: { type: "ARRAY", items: { type: "STRING" } },
          neu_khong_duoc: { type: "STRING" },
          tin_nhan_nho_giup: { type: "STRING" },
        },
        required: ["nguyen_nhan", "muc_do", "cach_sua", "neu_khong_duoc", "tin_nhan_nho_giup"],
      },
      temperature: 0.2,
      fast: true,
    });
    return c.json(parseJsonLoose(raw));
  } catch (e) {
    return fail(c, e);
  }
});

// Dán tin nhắn giao việc (copy từ Lark, Zalo, email…) → AI tách thành từng việc: tên, hạn, giờ, gấp, link.
// Người dùng xem lại rồi mới thêm vào Thư ký (trình duyệt tự thêm) — máy chủ không tự ghi gì.
app.post("/api/thu-ky/phan-tich", async (c) => {
  try {
    const { text } = await c.req.json<{ text?: string }>();
    const msg = String(text ?? "").trim();
    if (!msg) throw new Error("Dán nội dung tin nhắn giao việc vào trước đã");
    if (msg.length > 8000) throw new Error("Tin nhắn quá dài (tối đa 8.000 ký tự) — dán từng phần");
    const now = vnNow();
    const thu = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"][new Date(`${now.date}T00:00:00Z`).getUTCDay()];
    const raw = await callAIJson(await envFor(c), {
      system: `Bạn là thư ký công việc. Người dùng dán 1 hoặc vài tin nhắn mà sếp/đồng nghiệp/khách GIAO VIỆC cho họ (từ Lark, Zalo, email).
Hôm nay là ${thu}, ngày ${now.date} (giờ Việt Nam). Hãy tách ra TỪNG VIỆC người nhận phải làm.

Quy tắc:
- title: ngắn gọn, bắt đầu bằng động từ, tối đa 80 ký tự, giữ nguyên tên riêng / tên khách / số liệu. Bỏ lời chào, xưng hô, cảm ơn.
- date: hạn chót dạng YYYY-MM-DD tính theo hôm nay. "mai" = ngày mai; "thứ 6" = thứ Sáu GẦN NHẤT sắp tới (nếu hôm nay là thứ Sáu và chưa qua hạn thì là hôm nay);
  "tuần sau" = thứ Hai tuần sau nếu không nói rõ ngày; "cuối tuần" = thứ Bảy; "cuối tháng" = ngày cuối tháng. Không có hạn → để chuỗi rỗng.
- time: giờ hạn dạng HH:MM 24 giờ ("5h chiều" = 17:00, "trước 9h sáng" = 09:00, "trưa" = 12:00). Không có giờ → chuỗi rỗng.
- urgent: true nếu có "gấp", "khẩn", "ASAP", "ngay", "urgent" hoặc dấu "!!".
- links: mọi đường link http(s) trong tin nhắn liên quan tới việc đó.
- note: 1 câu ngắn chi tiết quan trọng còn lại (người giao, yêu cầu kèm theo) — không lặp lại title. Không có thì chuỗi rỗng.
- Một tin giao nhiều việc → tách nhiều phần tử. Không có việc nào → mảng rỗng. KHÔNG bịa thêm việc hay hạn.
Trả về JSON: {"tasks":[{"title":"","date":"","time":"","urgent":false,"links":[],"note":""}]}`,
      user: msg,
      geminiSchema: {
        type: "OBJECT",
        properties: {
          tasks: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                date: { type: "STRING" },
                time: { type: "STRING" },
                urgent: { type: "BOOLEAN" },
                links: { type: "ARRAY", items: { type: "STRING" } },
                note: { type: "STRING" },
              },
              required: ["title", "date", "time", "urgent", "links", "note"],
            },
          },
        },
        required: ["tasks"],
      },
      temperature: 0.1,
      fast: true,
    });
    const tasks = ((parseJsonLoose(raw)?.tasks ?? []) as any[])
      .filter((t) => t && String(t.title || "").trim())
      .slice(0, 20)
      .map((t) => ({
        title: String(t.title).trim().slice(0, 120),
        date: /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : "",
        time: /^([01]\d|2[0-3]):[0-5]\d$/.test(t.time) ? t.time : "",
        urgent: Boolean(t.urgent),
        links: (Array.isArray(t.links) ? t.links : []).map(String).filter((u: string) => /^https?:\/\/\S+$/.test(u)).slice(0, 10),
        note: String(t.note || "").trim().slice(0, 300),
      }));
    return c.json({ tasks, today: now.date });
  } catch (e) {
    return fail(c, e);
  }
});

// ---------- Share social đa kênh (Netlify) ----------
// Người đã đăng nhập cổng (email đã xác minh) nhận 1 "vé" sống 2 phút, ký bằng khoá bí mật ECDSA P-256.
// Netlify chỉ giữ khoá công khai để kiểm tra — không ai làm vé giả được, kể cả khi đọc mã nguồn.

app.get("/api/share/ve", async (c) => {
  try {
    if (!c.env.SHARE_SIGNING_KEY || !c.env.SHARE_URL) {
      throw new Error("Chưa nối với Share social đa kênh — quản trị cần cài SHARE_SIGNING_KEY và SHARE_URL.");
    }
    const key = await crypto.subtle.importKey(
      "jwk",
      JSON.parse(c.env.SHARE_SIGNING_KEY),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    const the = await signShare(c.env, { email: c.get("email"), muc: "lien-ket", het_han: Date.now() + 30 * 86_400_000 });
    const payload = b64url(new TextEncoder().encode(JSON.stringify({ email: c.get("email"), het_han: Date.now() + 120_000, the })));
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(payload));
    const base = c.env.SHARE_URL.replace(/\/+$/, "");
    return c.json({ url: `${base}/api/dang-bai/vao?ve=${payload}.${b64url(sig)}` });
  } catch (e) {
    return fail(c, e);
  }
});

// ---------- Nhắc việc qua Lark ----------
// Mỗi người tự bật cho chính mình; bot chỉ nhắn việc của người đó cho người đó.

const larkRow = (c: Context<AppEnv>) =>
  c.env.DB.prepare("SELECT email, lark_email, thu_ky, hoc_tap, webhook_enc, last_error FROM lark_settings WHERE email = ?")
    .bind(c.get("email"))
    .first<Setting & { last_error: string | null }>();

app.get("/api/lark", async (c) => {
  const row = await larkRow(c);
  return c.json({
    configured: larkReady(c.env), // công ty đã kết nối bot ứng dụng (nhắn theo email) chưa
    enabled: Boolean(row),
    hasWebhook: Boolean(row?.webhook_enc), // link bot nhóm đã lưu (không bao giờ trả link về trình duyệt)
    larkEmail: row?.lark_email ?? c.get("email"),
    thuKy: row ? Boolean(row.thu_ky) : true,
    hocTap: row ? Boolean(row.hoc_tap) : true,
    lastError: row?.last_error ?? null,
  });
});

app.put("/api/lark", async (c) => {
  try {
    const b = await c.req.json<{
      enabled?: boolean;
      larkEmail?: string;
      thuKy?: boolean;
      hocTap?: boolean;
      webhookUrl?: string; // để trống = giữ link đã lưu
    }>();
    const email = c.get("email");
    if (!b.enabled) {
      await c.env.DB.prepare("DELETE FROM lark_settings WHERE email = ?").bind(email).run();
      return c.json({ ok: true });
    }
    const larkEmail = String(b.larkEmail || email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(larkEmail)) throw new Error("Email Lark không hợp lệ");
    const hook = String(b.webhookUrl ?? "").trim();
    if (hook && !validWebhook(hook)) {
      throw new Error("Link webhook không đúng — copy nguyên link dạng https://open.larksuite.com/open-apis/bot/v2/hook/...");
    }
    const existing = await larkRow(c);
    const webhookEnc = hook ? await encrypt(c.env, hook) : (existing?.webhook_enc ?? null);
    if (!webhookEnc && !larkReady(c.env)) throw new Error("Hãy dán link webhook của bot nhóm Lark trước khi bật");
    await c.env.DB.prepare(
      `INSERT INTO lark_settings (email, lark_email, thu_ky, hoc_tap, webhook_enc, last_error, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)
       ON CONFLICT(email) DO UPDATE SET lark_email = ?2, thu_ky = ?3, hoc_tap = ?4, webhook_enc = ?5, last_error = NULL, updated_at = ?6`,
    )
      .bind(email, larkEmail, b.thuKy === false ? 0 : 1, b.hocTap === false ? 0 : 1, webhookEnc, new Date().toISOString())
      .run();
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
});

/** Gửi thử 1 tin nhắn qua đúng kênh đã lưu, để người dùng chắc chắn nhắc việc tới được Lark của mình. */
app.post("/api/lark/test", async (c) => {
  try {
    const row = await larkRow(c);
    if (!row) throw new Error("Hãy bật nhắc việc (và dán link webhook) trước khi gửi thử");
    await deliver(c.env, row, {
      title: "✅ Đã kết nối nhắc việc",
      color: "green",
      lines: [
        "Từ giờ **Trợ lý AI SEONGON** sẽ nhắc việc cho bạn tại đây:",
        "• **9:00 và 13:30 mỗi ngày** — báo cáo công việc: trễ hạn, hôm nay, mọi việc sắp tới kèm còn bao nhiêu ngày; bài học cần làm",
        "• **Trước 30 phút** — việc có giờ cụ thể trong Thư ký công việc",
        "• **13:30** — nhắc học nốt nếu hôm nay còn bài chưa học",
      ],
      button: { text: "Mở Trợ lý AI", url: `${(c.env.PUBLIC_URL || "").replace(/\/+$/, "")}/` },
    });
    // Gửi luôn bản nhắc thật (việc hôm nay, trễ hạn, bài học) để xem ngay, không phải chờ 9:00
    const sent = 1 + (await sendPreview(c.env, row, (c.env.PUBLIC_URL || "").replace(/\/+$/, "")));
    await c.env.DB.prepare("UPDATE lark_settings SET last_error = NULL WHERE email = ?").bind(c.get("email")).run();
    return c.json({ ok: true, sent });
  } catch (e) {
    return fail(c, e);
  }
});

// ---------- Tạo social mới tự động (theo mẫu 4 trang) ----------
// Kết nối tài khoản gốc 1 lần, sau đó mỗi lần bấm "Tạo social" app tự tạo trang mới trên nền tảng.

type SocialRecord = { id: string; at: string; brand: string; platform: string; key?: string; siteUrl: string; adminUrl?: string; siteId?: string; indexable?: boolean; pages: { label: string; url: string }[]; check?: CheckReport; sheetOk?: boolean };
const socialsKey = (owner: string) => `socials:${owner}`;

// Mỗi dự án (dùng chung danh sách dự án với tab "Đăng lên trang có sẵn") có tài khoản gốc + danh sách social riêng.
// owner = "<email>#<id dự án>" — khoá lưu trữ của dự án đó, không dự án nào đọc được của dự án khác.
async function ownerOf(c: Context<AppEnv>, id = c.req.query("project") ?? "") {
  const email = c.get("email");
  if (!/^[a-f0-9]{4,64}$/.test(id) || !(await getProject(c.env, email, id))) throw new Error("Hãy chọn dự án trước");
  return `${email}#${id}`;
}
async function clearSocialProject(env: Env, owner: string) {
  await Promise.all([env.DATA.delete(`social-conn:${owner}`), wpcomDisconnect(env, owner), bloggerDisconnect(env, owner), tumblrDisconnect(env, owner), env.DATA.delete(socialsKey(owner))]);
}

// App WordPress.com của từng người — dán Client ID / Client Secret ngay trên web
app.put("/api/wpcom/app", async (c) => {
  try {
    const { clientId, clientSecret } = await c.req.json<{ clientId?: string; clientSecret?: string }>();
    const id = String(clientId ?? "").trim();
    const secret = String(clientSecret ?? "").trim();
    if (!/^\d{3,12}$/.test(id)) throw new Error("Client ID là 1 dãy số (vd 123456) — copy lại ở trang app WordPress.com");
    if (secret.length < 20 || /\s/.test(secret)) throw new Error("Client Secret chưa đúng — copy lại đủ cả dãy");
    await saveWpcomApp(c.env, c.get("email"), { clientId: id, clientSecret: secret });
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
});
app.delete("/api/wpcom/app", async (c) => {
  await saveWpcomApp(c.env, c.get("email"), null);
  return c.json({ ok: true });
});
app.get("/api/wpcom/connect", async (c) => {
  const project = c.req.query("project") ?? "";
  let owner: string;
  try {
    owner = await ownerOf(c);
  } catch {
    return c.redirect("/tao-social/?wpcom=loi&msg=" + encodeURIComponent("Hãy chọn dự án trước"));
  }
  if (!(await wpcomApp(c.env, owner))) return c.redirect(`/tao-social/?wpcom=chua-cai&project=${project}`);
  return c.redirect(await wpcomAuthorizeUrl(c.env, owner));
});
app.get("/api/wpcom/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state") ?? "";
  if (!code) return c.redirect("/tao-social/?wpcom=huy");
  try {
    const owner = await wpcomFinish(c.env, c.get("email"), code, state);
    return c.redirect(`/tao-social/?wpcom=ok&project=${owner.split("#")[1] ?? ""}`);
  } catch (e) {
    return c.redirect(`/tao-social/?wpcom=loi&msg=${encodeURIComponent(errorMessage(e)).slice(0, 300)}`);
  }
});
// Blogger (Cách 1): app Google (Client ID/Secret) cài 1 lần trên web, mỗi dự án kết nối tài khoản Google riêng
app.put("/api/google/app", async (c) => {
  try {
    const { clientId, clientSecret } = await c.req.json<{ clientId?: string; clientSecret?: string }>();
    const id = String(clientId ?? "").trim();
    const secret = String(clientSecret ?? "").trim();
    if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) throw new Error("Client ID của Google có dạng ...apps.googleusercontent.com — copy lại ở Google Cloud");
    if (secret.length < 15 || /\s/.test(secret)) throw new Error("Client Secret chưa đúng — copy lại đủ cả dãy");
    await saveGoogleApp(c.env, c.get("email"), { clientId: id, clientSecret: secret });
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
});
app.delete("/api/google/app", async (c) => {
  await saveGoogleApp(c.env, c.get("email"), null);
  return c.json({ ok: true });
});
app.get("/api/google/connect", async (c) => {
  const project = c.req.query("project") ?? "";
  try {
    const owner = await ownerOf(c);
    if (!(await googleApp(c.env, owner))) return c.redirect(`/tao-social/?google=chua-cai&project=${project}`);
    return c.redirect(await bloggerAuthorizeUrl(c.env, owner));
  } catch (e) {
    return c.redirect(`/tao-social/?google=loi&project=${project}&msg=${encodeURIComponent(errorMessage(e)).slice(0, 300)}`);
  }
});
app.get("/api/google/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.redirect("/tao-social/?google=huy");
  try {
    const state = c.req.query("state") ?? "";
    const st = await c.env.DATA.get(`google-state:${state}`);
    if (st?.startsWith("sheets|")) {
      const owner = st.slice(7);
      await c.env.DATA.delete(`google-state:${state}`);
      const email = c.get("email");
      if (owner !== email && !owner.startsWith(`${email}#`)) throw new Error("Phiên kết nối Google đã hết hạn — bấm Kết nối lại");
      await sheetsFinish(c.env, owner, code);
      return c.redirect(`/tao-social/?google=sheets-ok&project=${owner.split("#")[1] ?? ""}`);
    }
    const owner = await bloggerFinish(c.env, c.get("email"), code, state);
    return c.redirect(`/tao-social/?google=ok&project=${owner.split("#")[1] ?? ""}`);
  } catch (e) {
    return c.redirect(`/tao-social/?google=loi&msg=${encodeURIComponent(errorMessage(e)).slice(0, 300)}`);
  }
});
// Google Sheets: kết nối 1 lần cho mỗi người (Gmail có quyền sửa sheet theo dõi), sheet theo dõi lưu riêng từng dự án
app.get("/api/google/sheets/connect", async (c) => {
  const project = c.req.query("project") ?? "";
  try {
    return c.redirect(await sheetsAuthorizeUrl(c.env, await ownerOf(c)));
  } catch (e) {
    return c.redirect(`/tao-social/?google=loi&project=${project}&msg=${encodeURIComponent(errorMessage(e)).slice(0, 300)}`);
  }
});
app.delete("/api/google/sheets", async (c) => {
  await sheetsDisconnect(c.env, c.get("email"));
  return c.json({ ok: true });
});
app.put("/api/social/track-sheet", async (c) => {
  try {
    const { url, map } = await c.req.json<{ url?: string; map?: TrackMap }>();
    const col = (v?: string) => (v && /^[A-Z]{1,2}$/.test(v) ? v : "");
    const clean = map
      ? { gid: map.gid && /^\d+$/.test(map.gid) ? map.gid : undefined, headerRow: Math.max(1, Math.min(Number(map.headerRow) || 1, 50)), cols: { platform: col(map.cols?.platform), link: col(map.cols?.link), date: col(map.cols?.date), account: col(map.cols?.account) } }
      : undefined;
    if (clean && !clean.cols.link) throw new Error("Hãy chọn cột để điền link trang chủ");
    await setTrackSheet(c.env, await ownerOf(c), String(url ?? "").trim(), clean);
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
});
// Đọc sheet theo dõi: các tab, cột của dòng tiêu đề, gợi ý cột — để chọn điền thông tin vào đâu
app.get("/api/social/track-sheet/inspect", async (c) => {
  try {
    const row = Number(c.req.query("row")) || undefined;
    return c.json(await inspectSheet(c.env, await ownerOf(c), c.req.query("gid") || undefined, row));
  } catch (e) {
    return fail(c, e);
  }
});
// Ghi link trang chủ các social của dự án vào sheet theo dõi (mặc định tất cả)
app.post("/api/social/write-sheet", async (c) => {
  try {
    const owner = await ownerOf(c);
    const { ids } = await c.req.json<{ ids?: string[] }>().catch(() => ({ ids: undefined }));
    const recs = (await c.env.DATA.get<SocialRecord[]>(socialsKey(owner), "json")) ?? [];
    const pick = Array.isArray(ids) ? recs.filter((r) => ids.includes(r.id)) : recs;
    if (!pick.length) throw new Error("Chưa có social nào để ghi");
    return c.json({ ket_qua: await writeLinksToSheet(c.env, owner, await sheetRows(c.env, owner, pick)) });
  } catch (e) {
    return fail(c, e);
  }
});

/** Dòng ghi sheet cho từng social: link trang chủ, ngày tạo, tài khoản đã dùng để tạo. */
async function sheetRows(env: Env, owner: string, recs: SocialRecord[]) {
  const [conns, wp, bl] = await Promise.all([getConns(env, owner), wpcomAccount(env, owner), bloggerAccount(env, owner)]);
  const account = (r: SocialRecord) => {
    const k = r.key ?? "";
    if (k === "wpcom") return wp?.username;
    if (k === "blogger") return bl?.username;
    return (conns as Record<string, { username?: string } | undefined>)[k]?.username;
  };
  return recs.map((r) => ({
    platform: r.platform,
    url: r.pages.find((p) => p.label === "Trang chủ")?.url || r.siteUrl,
    date: new Date(r.at).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
    account: account(r) ?? "",
  }));
}

// Tumblr (Cách 1): app Tumblr (Client ID/Secret) cài 1 lần trên web, mỗi dự án kết nối tài khoản riêng, chọn blog đã tạo tay
app.put("/api/tumblr/app", async (c) => {
  try {
    const { clientId, clientSecret } = await c.req.json<{ clientId?: string; clientSecret?: string }>();
    const id = String(clientId ?? "").trim(), secret = String(clientSecret ?? "").trim();
    if (id.length < 20 || /\s/.test(id)) throw new Error("Client ID (OAuth Consumer Key) chưa đúng — copy lại ở tumblr.com/oauth/apps");
    if (secret.length < 20 || /\s/.test(secret)) throw new Error("Client Secret (Secret Key) chưa đúng — copy lại đủ cả dãy");
    await saveTumblrApp(c.env, c.get("email"), { clientId: id, clientSecret: secret });
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
});
app.delete("/api/tumblr/app", async (c) => {
  await saveTumblrApp(c.env, c.get("email"), null);
  return c.json({ ok: true });
});
app.get("/api/tumblr/connect", async (c) => {
  const project = c.req.query("project") ?? "";
  try {
    return c.redirect(await tumblrAuthorizeUrl(c.env, await ownerOf(c)));
  } catch (e) {
    return c.redirect(`/tao-social/?tumblr=loi&project=${project}&msg=${encodeURIComponent(errorMessage(e)).slice(0, 300)}`);
  }
});
app.get("/api/tumblr/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.redirect("/tao-social/?tumblr=huy");
  try {
    const owner = await tumblrFinish(c.env, c.get("email"), code, c.req.query("state") ?? "");
    return c.redirect(`/tao-social/?tumblr=ok&project=${owner.split("#")[1] ?? ""}`);
  } catch (e) {
    return c.redirect(`/tao-social/?tumblr=loi&msg=${encodeURIComponent(errorMessage(e)).slice(0, 300)}`);
  }
});
app.get("/api/social/tumblr/blogs", async (c) => {
  try {
    return c.json({ blogs: await listTumblrBlogs(c.env, await ownerOf(c)) });
  } catch (e) {
    return fail(c, e);
  }
});

// Các trang WordPress.com của tài khoản đã kết nối (để chọn trang trống vừa tạo)
app.get("/api/social/wpcom/sites", async (c) => {
  try {
    const acc = await wpcomAccount(c.env, await ownerOf(c));
    if (!acc) throw new Error("Chưa kết nối WordPress.com");
    return c.json({ sites: await listWpcomSites(acc) });
  } catch (e) {
    return fail(c, e);
  }
});

// Các blog của tài khoản Google đã kết nối (để chọn blog trống vừa tạo)
app.get("/api/social/blogger/blogs", async (c) => {
  try {
    const acc = await bloggerAccount(c.env, await ownerOf(c));
    if (!acc) throw new Error("Chưa kết nối Blogger");
    return c.json({ blogs: await listBlogs(acc) });
  } catch (e) {
    return fail(c, e);
  }
});

app.get("/api/social", async (c) => {
  try {
    return c.json({ items: (await c.env.DATA.get<SocialRecord[]>(socialsKey(await ownerOf(c)), "json")) ?? [] });
  } catch (e) {
    return fail(c, e);
  }
});

// Đọc website chính bằng quy tắc (không dùng AI): logo, ảnh, màu, mô tả, sản phẩm, liên hệ — để điền ô trống
app.post("/api/social/scrape", async (c) => {
  try {
    const { url } = await c.req.json<{ url?: string }>();
    return c.json({ site: await scrapeBrand(String(url ?? "").trim()) });
  } catch (e) {
    return fail(c, e);
  }
});

/** Dùng dữ liệu website trình duyệt gửi lên; chưa có thì tự đọc (lỗi thì bỏ qua). Chỉ điền ô còn trống. */
async function withSite(b: BusinessInfo, given?: SiteBrand | null): Promise<{ business: BusinessInfo; site?: SiteBrand }> {
  const site = given ?? (await scrapeBrand(b.targetUrl).catch(() => undefined));
  return site ? { business: fillFromSite(b, site).business, site } : { business: b };
}

/** WordPress.com / Blogger không chỉnh được giao diện: chèn khối đầu trang màu thương hiệu (logo, tiêu đề, nút về website) lên đầu Trang chủ. */
function withBrandHero(tpl: SocialTemplate, b: BusinessInfo): SocialTemplate {
  const d = tpl.assets.design;
  const hex = (v?: string) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v : "");
  const c = hex(b.brandColor) || hex(d?.primary) || "#0d53f0";
  const c2 = hex(d?.secondary) || c;
  const on = luminance(c) > 0.62 ? "#14171a" : "#ffffff";
  const on2 = luminance(c2) > 0.62 ? "#14171a" : "#ffffff";
  const r = Math.min(d?.radius ?? 10, 40);
  const hero = [
    `<div style="background:linear-gradient(120deg,${c},${c2});color:${on};padding:40px 28px;border-radius:${r + 6}px;text-align:center;margin-bottom:24px">`,
    tpl.assets.logo ? `<img src="${escapeAttr(tpl.assets.logo)}" alt="Logo ${escapeAttr(b.brandName)}" style="max-height:72px;max-width:240px;background:#fff;padding:8px 14px;border-radius:${r}px">` : "",
    `<h2 style="color:${on};margin:18px 0 8px">${escapeAttr(tpl.siteTitle)}</h2>`,
    tpl.tagline ? `<p style="color:${on};margin:0 0 20px;opacity:.95">${escapeAttr(tpl.tagline)}</p>` : "",
    `<a href="${escapeAttr(b.targetUrl)}" style="display:inline-block;background:${c2 === c ? "#ffffff" : c2};color:${c2 === c ? c : on2};padding:12px 26px;border-radius:${r}px;font-weight:700;text-decoration:none">Xem website chính thức</a></div>`,
    tpl.assets.cover ? `<figure><img src="${escapeAttr(tpl.assets.cover)}" alt="${escapeAttr(b.brandName)}" style="width:100%;border-radius:${r}px"></figure>` : "",
  ].join("");
  // Khối liên hệ cuối MỌI trang (giống chân trang website) — WordPress.com/Blogger không cho đổi chân trang của giao diện
  const tel = (b.phone ?? "").replace(/[^\d+]/g, "");
  const items = [
    b.companyName && `<strong>${escapeAttr(b.companyName)}</strong>`,
    b.address && `📍 ${escapeAttr(b.address)}`,
    b.phone && `☎ <a href="tel:${escapeAttr(tel)}" style="color:${c}">${escapeAttr(b.phone)}</a>`,
    b.email && `✉ <a href="mailto:${escapeAttr(b.email)}" style="color:${c}">${escapeAttr(b.email)}</a>`,
    `🌐 <a href="${escapeAttr(b.targetUrl)}" style="color:${c}">${escapeAttr(b.targetUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>`,
  ].filter(Boolean);
  const socials = (tpl.assets.socials ?? []).map((u) => `<a href="${escapeAttr(u)}" style="color:${c}">${escapeAttr(new URL(u).hostname.replace(/^www\./, "").split(".")[0]!)}</a>`).join(" · ");
  const foot = `<div style="margin-top:36px;padding:22px 24px;border-top:4px solid ${c};background:#f8fafc;border-radius:${r}px;font-size:15px;line-height:1.7"><p style="margin:0 0 6px;font-weight:700;color:${c}">Thông tin liên hệ</p><p style="margin:0">${items.join("<br>")}</p>${socials ? `<p style="margin:8px 0 0">Kênh chính thức: ${socials}</p>` : ""}</div>`;
  return { ...tpl, pages: tpl.pages.map((p) => (p.kind === "blog" ? p : { ...p, html: (p.kind === "home" ? hero : "") + p.html + foot })) };
}

/** Telegraph không nhận style: chỉ chèn logo + ảnh bìa lên đầu Trang chủ. */
function withHeroImages(tpl: SocialTemplate, brand: string): SocialTemplate {
  const head = [tpl.assets.logo && `<figure><img src="${escapeAttr(tpl.assets.logo)}" alt="Logo ${escapeAttr(brand)}"></figure>`, tpl.assets.cover && `<figure><img src="${escapeAttr(tpl.assets.cover)}" alt="${escapeAttr(brand)}"></figure>`].filter(Boolean).join("");
  return head ? { ...tpl, pages: tpl.pages.map((p) => (p.kind === "home" ? { ...p, html: head + p.html } : p)) } : tpl;
}

// Xem trước nội dung 4 trang (không tạo gì trên nền tảng)
app.post("/api/social/preview", async (c) => {
  try {
    const body = await c.req.json<{ business: BusinessInfo; useAI?: boolean; site?: SiteBrand | null }>();
    if (!body.business?.brandName?.trim() || !body.business.industry?.trim() || !/^https?:\/\//.test(body.business.targetUrl ?? "")) {
      throw new Error("Cần nhập Tên thương hiệu, Ngành nghề và Website chính");
    }
    const { business, site } = await withSite(body.business, body.site);
    return c.json(await generateSocialTemplate(() => envFor(c), business, { useAI: !!body.useAI, site }));
  } catch (e) {
    return fail(c, e);
  }
});

const SOCIAL_PLATFORM_NAME: Record<string, string> = { tumblr: "Tumblr", mastodon: "Mastodon", blogger: "Blogger", wpcom: "WordPress.com", netlify: "Netlify", vercel: "Vercel", github: "GitHub Pages", codeberg: "Codeberg Pages", telegraph: "Telegraph" };

// Tài khoản gốc đã kết nối (không trả mã truy cập về trình duyệt)
app.get("/api/social/connections", async (c) => {
  try {
    const owner = await ownerOf(c);
    const [conns, wp, bl, gapp] = await Promise.all([getConns(c.env, owner), wpcomAccount(c.env, owner), bloggerAccount(c.env, owner), googleApp(c.env, owner)]);
    const info = (k: keyof typeof conns) => ({ connected: !!conns[k], username: conns[k]?.username ?? null });
    return c.json({
      wpcom: { configured: !!(await wpcomApp(c.env, owner)), ownApp: await wpcomHasOwnApp(c.env, owner), redirectUri: wpcomRedirectUri(c.env), connected: !!wp, username: wp?.username ?? null },
      netlify: info("netlify"),
      vercel: info("vercel"),
      github: info("github"),
      codeberg: info("codeberg"),
      mastodon: info("mastodon"),
      tumblr: await (async () => { const [a, ap] = await Promise.all([tumblrAccount(c.env, owner), tumblrApp(c.env, owner)]); return { configured: !!ap, ownApp: !!ap, redirectUri: tumblrRedirectUri(c.env), connected: !!a, username: a?.username ?? null }; })(),
      telegraph: { connected: true, username: conns.telegraph?.username ?? null },
      blogger: { configured: !!gapp, ownApp: !!gapp, redirectUri: googleRedirectUri(c.env), connected: !!bl, username: bl?.username ?? null },
      sheets: { connected: !!(await sheetsAccount(c.env, owner)), username: (await sheetsAccount(c.env, owner))?.username ?? null, trackSheet: await getTrackSheet(c.env, owner) },
    });
  } catch (e) {
    return fail(c, e);
  }
});
app.put("/api/social/connections/:platform", async (c) => {
  try {
    const platform = c.req.param("platform") as TokenPlatform;
    if (!["netlify", "vercel", "github", "codeberg", "mastodon"].includes(platform)) throw new Error("Nền tảng không hợp lệ");
    const { token } = await c.req.json<{ token?: string }>();
    const t = String(token ?? "").trim();
    if (t.length < 10 || /\s/.test(t)) throw new Error("Mã truy cập chưa đúng — copy lại đủ cả dãy");
    const username = await verifyToken(platform, t);
    await setConn(c.env, await ownerOf(c), platform, { token: t, username, connectedAt: new Date().toISOString() });
    return c.json({ ok: true, username });
  } catch (e) {
    return fail(c, e);
  }
});
app.delete("/api/social/connections/:platform", async (c) => {
  try {
    const owner = await ownerOf(c);
    const p = c.req.param("platform");
    if (p === "wpcom") await wpcomDisconnect(c.env, owner);
    else if (p === "blogger") await bloggerDisconnect(c.env, owner);
    else if (p === "tumblr") await tumblrDisconnect(c.env, owner);
    else await setConn(c.env, owner, p as TokenPlatform | "telegraph", null);
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
});

// Tạo social mới trên nhiều nền tảng 1 lần: soạn mẫu 4 trang 1 lần, các nền tảng chạy song song — lỗi 1 nơi không ảnh hưởng nơi khác
type CreateCtx = { business: BusinessInfo; tpl: SocialTemplate; branded: SocialTemplate; rich: SocialTemplate; subdomain?: string; bloggerBlogId?: string; tumblrBlog?: string; wpcomSiteId?: string; wpcomClean?: boolean };
type CreateOut = { siteUrl: string; adminUrl?: string; siteId?: string; indexable?: boolean; pages: { label: string; url: string }[]; wpQueue?: { siteUrl: string; pages: SocialPage[]; created: { kind: string; id: number; url: string; title: string }[] } };

/** Dựng social trên 1 nền tảng. resume=true (agent tự thử lại): lần trước tạo dở thì dùng lại đúng trang của chính tài khoản này, không báo trùng tên. */
async function createOnPlatform(env: Env, owner: string, p: string, x: CreateCtx, resume = false): Promise<CreateOut> {
  const { business, tpl, branded, rich, subdomain } = x;
  const conns = await getConns(env, owner);
  const need = (k: TokenPlatform) => {
    const v = conns[k];
    if (!v) throw new Error(`Chưa kết nối ${SOCIAL_PLATFORM_NAME[k]}`);
    return v;
  };
  if (p === "wpcom") {
    const wp = await wpcomAccount(env, owner);
    if (!wp) throw new Error("Chưa kết nối WordPress.com");
    return createWpcomSocial(env, wp, business.brandName, branded, String(x.wpcomSiteId ?? ""), x.wpcomClean === true && !resume);
  }
  if (p === "blogger") {
    const acc = await bloggerAccount(env, owner);
    if (!acc) throw new Error("Chưa kết nối Blogger");
    return createBloggerSocial(acc, String(x.bloggerBlogId ?? ""), branded, business);
  }
  if (p === "tumblr") return createTumblrSocial(env, owner, String(x.tumblrBlog ?? ""), tpl, business);
  if (p === "mastodon") return createMastodon(need("mastodon").token, tpl, business);
  if (p === "netlify") return createNetlify(need("netlify").token, business.brandName, tpl, business, subdomain, resume);
  if (p === "vercel") return createVercel(need("vercel").token, business.brandName, tpl, business, subdomain);
  if (p === "github") {
    const g = need("github");
    return createGithubPages(g.token, g.username, business.brandName, tpl, business, subdomain, resume);
  }
  if (p === "codeberg") {
    const g = need("codeberg");
    return createCodebergPages(g.token, g.username, business.brandName, tpl, business, subdomain, resume);
  }
  // Telegraph: dùng lại tài khoản app đã tạo cho người này, chưa có thì tạo (không cần đăng ký)
  let tg = conns.telegraph;
  if (!tg) {
    tg = { token: await telegraphAccount(business.brandName, business.targetUrl), username: business.brandName, connectedAt: new Date().toISOString() };
    await setConn(env, owner, "telegraph", tg);
  }
  return createTelegraph(tg.token, rich, business);
}

/** Lưu các social vừa tạo: danh sách, ảnh chụp (để share/dựng lại), hàng chờ WordPress, ghi sheet, hẹn agent kiểm tra. */
async function saveCreated(env: Env, owner: string, done: { p: string; value: CreateOut }[], x: CreateCtx) {
  const created: SocialRecord[] = [];
  const snaps: [string, SiteSnapshot][] = [];
  for (const { p, value } of done) {
    await cancelRetry(env, owner, p);
    const rec: SocialRecord = { id: crypto.randomUUID(), at: new Date().toISOString(), brand: x.business.brandName, platform: SOCIAL_PLATFORM_NAME[p]!, key: p, siteUrl: value.siteUrl, adminUrl: value.adminUrl, siteId: value.siteId, indexable: value.indexable, pages: value.pages };
    created.push(rec);
    if (value.siteId) snaps.push([rec.id, { platform: p, siteId: value.siteId, base: value.siteUrl, tpl: p === "wpcom" || p === "blogger" ? x.branded : p === "telegraph" ? x.rich : x.tpl, biz: x.business, posts: [] }]);
  }
  if (!created.length) return { created, sheet: null as unknown };
  const all = (await env.DATA.get<SocialRecord[]>(socialsKey(owner), "json")) ?? [];
  await env.DATA.put(socialsKey(owner), JSON.stringify([...created, ...all].slice(0, 300)));
  await Promise.all(snaps.map(([id, s]) => env.DATA.put(snapKey(owner, id), JSON.stringify(s))));
  // WordPress: 3 trang còn lại vào hàng chờ, chương trình nền dựng cách nhau ~4 phút
  for (const [i, d] of done.entries()) {
    if (d.p === "wpcom" && d.value.wpQueue) await enqueueWpJob(env, { owner, siteId: created[i]!.siteId!, recId: created[i]!.id, ...d.value.wpQueue });
  }
  let sheet: unknown = null;
  if ((await getTrackSheet(env, owner)) && (await sheetsAccount(env, owner))) {
    sheet = await writeLinksToSheet(env, owner, await sheetRows(env, owner, created))
      .then((ket_qua) => ({ ok: true, ket_qua }))
      .catch((e) => ({ ok: false, error: errorMessage(e) }));
    const kq = (sheet as { ok: boolean; ket_qua?: { platform: string; ok: boolean }[] }).ket_qua ?? [];
    for (const rec of created) rec.sheetOk = kq.some((y) => y.platform === rec.platform && y.ok);
    const cur = (await env.DATA.get<SocialRecord[]>(socialsKey(owner), "json")) ?? [];
    await env.DATA.put(socialsKey(owner), JSON.stringify(cur.map((y) => created.find((z) => z.id === y.id) ?? y)));
  }
  // Tầng 2 agent: hẹn giờ tự quay lại kiểm tra (WordPress đợi dựng đủ 4 trang; GitHub/Codeberg đợi build)
  for (const rec of created) {
    const delay = rec.key === "wpcom" ? 16 * 60_000 : rec.key === "github" || rec.key === "codeberg" ? 4 * 60_000 : 2 * 60_000;
    await enqueueCheck(env, owner, rec.id, delay);
  }
  return { created, sheet };
}

/** Khoá Gemini cho agent chạy nền (không có phiên đăng nhập): khoá riêng của người dùng, không có thì khoá chung. */
async function aiEnvOf(env: Env, owner: string): Promise<Env | null> {
  const stored = await getGeminiKey(env, owner.split("#")[0]!);
  if (stored) {
    const [, kind, key] = stored.match(/^(studio|vertex):([\s\S]+)$/) ?? [null, "studio", stored];
    return { ...env, AI_PROVIDER: "gemini", GEMINI_API_KEY: key, GEMINI_ENDPOINT: kind === "vertex" ? "vertex" : undefined };
  }
  return env.GEMINI_API_KEY || env.OPENAI_API_KEY ? env : null;
}

app.post("/api/social/create", async (c) => {
  try {
    const email = await ownerOf(c);
    const body = await c.req.json<{ business: BusinessInfo; platforms: string[]; subdomain?: string; useAI?: boolean; site?: SiteBrand | null; bloggerBlogId?: string; tumblrBlog?: string; wpcomSiteId?: string; wpcomClean?: boolean }>();
    const { platforms, subdomain } = body;
    if (!body.business?.brandName?.trim() || !body.business.industry?.trim() || !/^https?:\/\//.test(body.business.targetUrl ?? "")) {
      throw new Error("Cần nhập Tên thương hiệu, Ngành nghề và Website chính");
    }
    const { business, site } = await withSite(body.business, body.site);
    if (!business?.brandName?.trim() || !business.industry?.trim() || !/^https?:\/\//.test(business.targetUrl ?? "")) {
      throw new Error("Cần nhập Tên thương hiệu, Ngành nghề và Website chính");
    }
    const list = [...new Set((platforms ?? []).filter((p) => SOCIAL_PLATFORM_NAME[p]))];
    if (!list.length) throw new Error("Hãy chọn ít nhất 1 nền tảng");
    const tpl = await generateSocialTemplate(() => envFor(c), business, { useAI: !!body.useAI, site });
    const ctx: CreateCtx = { business, tpl, rich: withHeroImages(tpl, business.brandName), branded: withBrandHero(tpl, business), subdomain, bloggerBlogId: body.bloggerBlogId, tumblrBlog: body.tumblrBlog, wpcomSiteId: body.wpcomSiteId, wpcomClean: body.wpcomClean };
    // Tầng 1 agent: lỗi tạm thời → tự thử lại (nơi an toàn); hết cách → đọc lỗi (quy tắc trước, AI sau) thành lời dễ hiểu
    const agentRuns = await Promise.all(list.map((p) => runWithAgent(p, SOCIAL_PLATFORM_NAME[p]!, () => createOnPlatform(c.env, email, p, ctx), () => envFor(c))));
    const done = agentRuns.flatMap((r, i) => (r.ok ? [{ p: list[i]!, value: r.value }] : []));
    const { created, sheet } = await saveCreated(c.env, email, done, ctx);
    const results = [];
    for (const [i, r] of agentRuns.entries()) {
      const p = list[i]!;
      if (r.ok) { results.push({ platform: p, name: SOCIAL_PLATFORM_NAME[p], ok: true, social: created.find((x) => x.key === p), steps: r.steps }); continue; }
      // lỗi có thể tự hết (chập chờn, giới hạn lượt, lỗi lạ) → agent hẹn tự thử lại sau 10 phút, xong báo cáo
      let autoRetryAt: string | undefined;
      if (r.diagnosis.retry) {
        autoRetryAt = new Date(Date.now() + 10 * 60_000).toISOString();
        await enqueueRetry(c.env, { owner: email, platform: p, attempt: 1, due: Date.parse(autoRetryAt), ctx, firstError: r.diagnosis.message });
        await agentLog(c.env, email, { platform: SOCIAL_PLATFORM_NAME[p]!, ok: false, text: `Lỗi: ${r.diagnosis.message} — agent sẽ tự thử lại lúc ${vnTime(autoRetryAt)}` });
      }
      results.push({ platform: p, name: SOCIAL_PLATFORM_NAME[p], ok: false, error: r.error, diagnosis: r.diagnosis as Diagnosis, steps: r.steps, autoRetryAt });
    }
    return c.json({ ok: true, results, source: tpl.source, note: tpl.note, sheet });
  } catch (e) {
    return fail(c, e);
  }
});

// Nhật ký agent của dự án (việc agent đã tự làm / cần người làm)
app.get("/api/social/agent-log", async (c) => {
  try {
    const owner = await ownerOf(c);
    return c.json({ items: await readAgentLog(c.env, owner), retries: await pendingRetries(c.env, owner) });
  } catch (e) {
    return fail(c, e);
  }
});

const vnTime = (iso: string) => new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });

/** Tầng 1 agent chạy nền: đến giờ thì tự thử lại nền tảng lỗi. Được → lưu + báo "đã tự sửa"; vẫn lỗi → thử thêm 1 lần sau 30 phút; hết cách → báo đúng việc cần người làm. */
async function runRetries(env: Env, now: number) {
  for (const job of await takeDueRetries(env, now)) {
    const name = SOCIAL_PLATFORM_NAME[job.platform] ?? job.platform;
    const ctx = job.ctx as CreateCtx;
    try {
      const value = await createOnPlatform(env, job.owner, job.platform, ctx, true);
      const { created } = await saveCreated(env, job.owner, [{ p: job.platform, value }], ctx);
      const rec = created[0]!;
      const home = rec.pages.find((x) => x.label === "Trang chủ")?.url || rec.siteUrl;
      await agentLog(env, job.owner, { platform: name, ok: true, text: `Đã tự sửa: thử lại lần ${job.attempt} thành công (lỗi lúc đầu: ${job.firstError})`, link: home });
      await notifyAgent(env, job.owner, { title: `🔧 Agent đã tự sửa: ${name} · ${ctx.business.brandName}`, color: "green", lines: [`Lúc đầu lỗi: ${job.firstError}`, `Agent tự thử lại lần ${job.attempt} → **tạo thành công**`, `[${home}](${home})`] });
    } catch (e) {
      const d = diagnoseRule(job.platform, name, e) ?? (await diagnoseAI(await aiEnvOf(env, job.owner), job.platform, name, e));
      if (d.retry && job.attempt < 2) {
        await requeueRetry(env, job, 30 * 60_000);
        await agentLog(env, job.owner, { platform: name, ok: false, text: `Thử lại lần ${job.attempt} vẫn lỗi (${d.message}) — sẽ thử lần cuối sau 30 phút` });
        continue;
      }
      await agentLog(env, job.owner, { platform: name, ok: false, text: `Cần anh/chị làm: ${d.message} ${d.fix ?? ""}`.trim(), link: d.link });
      await notifyAgent(env, job.owner, { title: `🙋 Cần người làm: ${name} · ${ctx.business.brandName}`, color: "orange", lines: [`Agent đã tự thử lại ${job.attempt} lần nhưng chưa được.`, `**Chuyện gì:** ${d.message}`, ...(d.fix ? [`**Cần làm:** ${d.fix}`] : []), ...(d.link ? [`[Mở trang cần sửa](${d.link})`] : []), "Làm xong vào app bấm Tạo social lại cho nền tảng này."] });
    }
  }
}

// Agent kiểm tra ngay 1 social (nút "Kiểm tra lại")
app.post("/api/social/:id/check", async (c) => {
  try {
    const owner = await ownerOf(c);
    const r = await checkSocial(c.env, owner, c.req.param("id"), 99, false);
    if (!r) throw new Error("Không tìm thấy social này");
    return c.json({ ok: true, check: r.check, social: r.rec });
  } catch (e) {
    return fail(c, e);
  }
});

// Xoá khỏi danh sách đã tạo (không đụng tới trang thật trên nền tảng)
app.delete("/api/social/:id", async (c) => {
  try {
    const owner = await ownerOf(c);
    const id = c.req.param("id");
    const all = (await c.env.DATA.get<SocialRecord[]>(socialsKey(owner), "json")) ?? [];
    // ?hard=1: xoá hẳn trên nền tảng (link thành 404). Lỗi thì giữ lại trong danh sách để thử lại / xoá tay.
    let note: string | undefined;
    if (c.req.query("hard") === "1") {
      const rec = all.find((s) => s.id === id);
      if (!rec) throw new Error("Không tìm thấy social này");
      note = (await removeOnPlatform(c.env, owner, rec)).note;
    }
    await c.env.DATA.put(socialsKey(owner), JSON.stringify(all.filter((s) => s.id !== id)));
    await c.env.DATA.delete(snapKey(owner, id));
    return c.json({ ok: true, note });
  } catch (e) {
    return fail(c, e);
  }
});

// ---------- Liên kết Share social ↔ Trợ lý tạo social ----------
// Dùng chung 1 danh sách dự án; phần "nền tảng đã tạo" đăng bằng tài khoản đã kết nối của dự án.

app.get("/api/lien-ket/du-an", async (c) => {
  const email = c.get("email");
  const projects = await listProjects(c.env, email);
  const out = await Promise.all(
    projects.map(async (p) => {
      const owner = `${email}#${p.id}`;
      const recs = (await c.env.DATA.get<SocialRecord[]>(socialsKey(owner), "json")) ?? [];
      const socials = await Promise.all(
        recs.map(async (r) => {
          const snap = await c.env.DATA.get(snapKey(owner, r.id));
          return { id: r.id, platform: r.platform, siteUrl: r.siteUrl, at: r.at, share: !!snap, ly_do: snap ? "" : "Social tạo trước khi có tính năng share — tạo lại để share được" };
        }),
      );
      return { id: p.id, name: p.name, brand: p.brandName, socials };
    }),
  );
  return c.json({ du_an: out });
});

app.post("/api/lien-ket/du-an", async (c) => {
  try {
    const { ten } = await c.req.json<{ ten?: string }>();
    const name = String(ten ?? "").trim().slice(0, 80);
    if (!name) throw new Error("Hãy đặt tên cho dự án.");
    const exist = (await listProjects(c.env, c.get("email"))).find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (exist) return c.json({ id: exist.id, name: exist.name });
    const p = await saveProject(c.env, c.get("email"), { name, business: { brandName: name }, selected: [], credentials: {} });
    return c.json({ id: p.id, name: p.name });
  } catch (e) {
    return fail(c, e);
  }
});

// Share 1 bài lên các social đã tạo của dự án (mặc định tất cả, bỏ được bằng danh sách "chon")
app.post("/api/lien-ket/dang", async (c) => {
  try {
    const email = c.get("email");
    const d = await c.req.json<{ du_an_id?: string; chon?: string[]; tieu_de?: string; tom_tat?: string; noi_dung?: string; link_goc?: string; anh_url?: string }>();
    const owner = await ownerOf(c, String(d.du_an_id ?? ""));
    const title = String(d.tieu_de ?? "").trim().slice(0, 200);
    const text = String(d.noi_dung ?? "").trim();
    if (!title || !text) throw new Error("Bài cần có tiêu đề và nội dung");
    const post = { title, html: textToHtml(text, d.link_goc), summary: String(d.tom_tat ?? "").trim().slice(0, 300), image: /^https?:\/\//.test(d.anh_url ?? "") ? d.anh_url : undefined, link: d.link_goc };
    const recs = (await c.env.DATA.get<SocialRecord[]>(socialsKey(owner), "json")) ?? [];
    const pick = Array.isArray(d.chon) ? recs.filter((r) => d.chon!.includes(r.id)) : recs;
    if (!pick.length) throw new Error("Dự án chưa có social nào đã tạo (hoặc chưa chọn social nào)");
    const results = [];
    for (const r of pick) {
      try {
        const raw = await c.env.DATA.get(snapKey(owner, r.id));
        if (!raw) throw new Error("Social tạo trước khi có tính năng share — tạo lại để share được");
        const { url, snap } = await postToSocial(c.env, owner, JSON.parse(raw) as SiteSnapshot, post);
        await c.env.DATA.put(snapKey(owner, r.id), JSON.stringify(snap));
        results.push({ id: r.id, platform: r.platform, ok: true, url });
      } catch (e) {
        results.push({ id: r.id, platform: r.platform, ok: false, error: errorMessage(e) });
      }
    }
    return c.json({ ket_qua: results });
  } catch (e) {
    return fail(c, e);
  }
});

// ---------- Lịch sử ----------

app.get("/api/runs", async (c) => c.json({ runs: await listRuns(c.env, c.get("email")) }));

app.post("/api/runs", async (c) => {
  try {
    const body = await c.req.json<{
      id: string;
      projectId?: string;
      projectName?: string;
      brandName?: string;
      results?: PublishResult[];
    }>();
    if (!body.id || !Array.isArray(body.results)) throw new Error("Thiếu dữ liệu lượt chạy");
    await addRun(
      c.env,
      c.get("email"),
      {
        id: String(body.id).slice(0, 40),
        at: new Date().toISOString(),
        projectId: body.projectId,
        projectName: body.projectName?.slice(0, 80),
        brandName: String(body.brandName ?? "").slice(0, 120),
      },
      body.results.slice(0, 10),
    );
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
});

app.notFound((c) => c.json({ error: "Không có đường dẫn này" }, 404));
app.onError((e, c) => c.json({ error: `Lỗi máy chủ: ${errorMessage(e)}` }, 500));

// ---------- Tầng 2 agent: người kiểm tra sau khi tạo social ----------
const PAGE_KIND: Record<string, string> = Object.fromEntries(Object.entries(SOCIAL_PAGE_LABEL).map(([k, v]) => [v, k]));
/** Mở lại từng trang, tự làm bù cái làm được (dựng lại trang WordPress thiếu, ghi lại sheet), lưu báo cáo. round<3 + đang dựng/build → hẹn kiểm tra lại. */
async function checkSocial(env: Env, owner: string, recId: string, round: number, notify: boolean): Promise<{ rec: SocialRecord; check: CheckReport; again: boolean } | null> {
  const all = (await env.DATA.get<SocialRecord[]>(socialsKey(owner), "json")) ?? [];
  const rec = all.find((x) => x.id === recId);
  if (!rec) return null;
  const items = await Promise.all(rec.pages.map((p) => checkPage(p.label, p.url, rec.brand)));
  const fixed: string[] = [];
  let pending = false;
  const missing = items.filter((x) => x.status === 404);
  const locked = items.some((x) => /khoá|xoá/.test(x.note ?? ""));

  if (rec.key === "wpcom" && rec.siteId && !locked) {
    if (await wpJobPending(env, owner, rec.siteId)) pending = true;
    else if (missing.length) {
      // dựng bù trang thiếu theo đúng mẫu đã lưu (vẫn cách nhau ~4 phút)
      const snap = await env.DATA.get<SiteSnapshot>(snapKey(owner, rec.id), "json");
      const pages = (snap?.tpl.pages ?? []).filter((p) => missing.some((m) => PAGE_KIND[m.label] === p.kind));
      if (pages.length && round < 3) {
        await enqueueWpJob(env, { owner, siteId: rec.siteId, siteUrl: rec.siteUrl, recId: rec.id, pages, created: [], repair: true });
        fixed.push(`Đang dựng bù ${pages.length} trang còn thiếu: ${pages.map((p) => p.title).join(", ")}`);
        pending = true;
      }
    }
  } else if (["github", "codeberg", "netlify", "vercel"].includes(rec.key ?? "") && !locked) {
    const broken = items.filter((x) => !x.ok);
    if (broken.length && round === 1) pending = true; // lần đầu: có thể còn đang build → đợi thêm
    else if (broken.length && round < 3) {
      // vẫn thiếu sau khi đợi → agent tự dựng lại cả trang từ bản mẫu đã lưu
      const snap = await env.DATA.get<SiteSnapshot>(snapKey(owner, rec.id), "json");
      if (snap && (await redeploySite(env, owner, snap).catch(() => false))) {
        fixed.push(`Đã tự dựng lại trang (thiếu: ${broken.map((x) => x.label).join(", ")})`);
        pending = true;
      }
    }
  }
  // WordPress còn "Sắp ra mắt" / chặn Google → tự bật công khai lại
  if (rec.key === "wpcom" && rec.siteId && !locked && items.some((x) => /noindex/.test(x.note ?? ""))) {
    if (await wpRelaunch(env, owner, rec.siteId)) fixed.push("Đã bật công khai lại để Google quét được");
  }

  // sheet chưa ghi được → ghi lại
  if (!rec.sheetOk && !locked && (await getTrackSheet(env, owner)) && (await sheetsAccount(env, owner))) {
    const kq = await writeLinksToSheet(env, owner, await sheetRows(env, owner, [rec])).catch(() => []);
    if (kq.some((x) => x.ok)) { rec.sheetOk = true; fixed.push("Đã ghi lại link vào sheet theo dõi"); }
  }

  const okN = items.filter((x) => x.ok).length;
  const again = pending && round < 3;
  const check: CheckReport = {
    at: new Date().toISOString(),
    ok: okN === items.length && !locked,
    pending: again,
    summary: locked ? "Trang bị nền tảng khoá hoặc xoá — xem chi tiết" : again ? `${okN}/${items.length} trang đã lên — đang chờ phần còn lại, agent sẽ tự kiểm tra lại` : okN === items.length ? `Đủ ${items.length}/${items.length} trang mở được` : `${okN}/${items.length} trang mở được — còn ${items.length - okN} trang có vấn đề`,
    items,
    fixed,
  };
  rec.check = check;
  if (rec.key === "wpcom" && locked) rec.indexable = false;
  await env.DATA.put(socialsKey(owner), JSON.stringify(all));
  if (notify && !again) {
    await agentLog(env, owner, { platform: rec.platform, ok: check.ok, text: `Kiểm tra: ${check.summary}${fixed.length ? ` · ${fixed.join(" · ")}` : ""}`, link: rec.siteUrl });
    await notifyCheck(env, owner, rec, check).catch((e) => console.log("Lark kiểm tra lỗi", errorMessage(e)));
  }
  return { rec, check, again };
}

/** Nhắn Lark cho người dùng (nếu đã cài nhắc việc Lark) — không có thì thôi, nhật ký agent trên app vẫn ghi. */
async function notifyAgent(env: Env, owner: string, card: { title: string; color: "green" | "orange" | "red" | "blue"; lines: string[] }) {
  const email = owner.split("#")[0]!;
  const s = await env.DB.prepare("SELECT email, lark_email, thu_ky, hoc_tap, webhook_enc FROM lark_settings WHERE email = ?").bind(email).first<Setting>().catch(() => null);
  if (!s) return;
  const base = (env.PUBLIC_URL || "").replace(/\/+$/, "");
  await deliver(env, s, { ...card, button: { text: "Mở Tạo social", url: `${base}/tao-social/` } }).catch((e) => console.log("Lark agent lỗi", errorMessage(e)));
}

/** Báo kết quả kiểm tra qua Lark (nếu người dùng đã cài nhắc việc Lark). */
async function notifyCheck(env: Env, owner: string, rec: SocialRecord, check: CheckReport) {
  const email = owner.split("#")[0]!;
  const s = await env.DB.prepare("SELECT email, lark_email, thu_ky, hoc_tap, webhook_enc FROM lark_settings WHERE email = ?").bind(email).first<Setting>();
  if (!s) return;
  const base = (env.PUBLIC_URL || "").replace(/\/+$/, "");
  await deliver(env, s, {
    title: `${check.ok ? "✅" : "⚠️"} Kiểm tra social ${rec.platform} · ${rec.brand}`,
    color: check.ok ? "green" : "orange",
    lines: [
      `**${check.summary}**`,
      ...check.items.map((x) => `${x.ok ? "✓" : "✗"} [${x.label}](${x.url})${x.note ? ` — ${x.note}` : ""}`),
      ...check.fixed.map((f) => `🔧 ${f}`),
    ],
    button: { text: "Mở Tạo social", url: `${base}/tao-social/` },
  });
}

async function runChecks(env: Env, now: number) {
  for (const job of await takeDueChecks(env, now)) {
    try {
      const r = await checkSocial(env, job.owner, job.recId, job.round, true);
      if (r?.again) await requeueCheck(env, job, 6 * 60_000);
    } catch (e) {
      console.log("Kiểm tra social lỗi", job.recId, errorMessage(e));
    }
  }
}

export default {
  fetch: app.fetch,
  // Cloudflare Cron (15 phút/lần, xem [triggers] trong wrangler.toml): nhắc việc qua Lark
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Lịch "* * * * *": hàng chờ dựng trang WordPress; lịch 15 phút: nhắc việc
    if (controller.cron === "* * * * *") {
      // chạy lần lượt (không song song) để 2 việc không ghi đè hàng chờ của nhau
      ctx.waitUntil(runRetries(env, controller.scheduledTime).catch(() => null).then(() => runChecks(env, controller.scheduledTime)).catch(() => null).then(() => runWpQueue(env, controller.scheduledTime, async (job, page) => {
        const all = (await env.DATA.get<SocialRecord[]>(socialsKey(job.owner), "json")) ?? [];
        const rec = all.find((x) => x.id === job.recId);
        if (!rec) return;
        const label = SOCIAL_PAGE_LABEL[page.kind as keyof typeof SOCIAL_PAGE_LABEL];
        rec.pages = rec.pages.map((x) => (x.label === label ? { ...x, url: page.url } : x));
        await env.DATA.put(socialsKey(job.owner), JSON.stringify(all));
      })));
      return;
    }
    ctx.waitUntil(runReminders(env, controller.scheduledTime));
  },
};
