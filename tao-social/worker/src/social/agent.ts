// Agent "Tạo social" — 2 tầng, chạy theo nguyên tắc QUY TẮC TRƯỚC, AI SAU:
//  Tầng 1 (xử lý sự cố): một nền tảng lỗi → đọc lỗi bằng quy tắc; lỗi lạ mới hỏi AI. Tự thử lại khi an toàn,
//          còn lại trả lời bằng lời dễ hiểu: chuyện gì xảy ra + anh/chị cần làm gì + link bấm thẳng.
//  Tầng 2 (người kiểm tra): sau khi tạo ~5–20 phút, tự mở lại từng trang, xem có lên đủ / bị khoá / thiếu thương hiệu,
//          tự làm bù những gì làm được (dựng lại trang WordPress thiếu, ghi lại sheet), lưu báo cáo + nhắn Lark.
import { callAIJson, parseJsonLoose } from "../ai";
import type { Env } from "../types";
import { errorMessage, HttpError } from "../util";

// ── Tầng 1: chẩn đoán lỗi ──
export type Diagnosis = {
  kind: "transient" | "auth" | "gone" | "suspended" | "setup" | "name" | "limit" | "content" | "unknown";
  message: string; // chuyện gì xảy ra — lời dễ hiểu
  fix?: string; // anh/chị cần làm gì
  link?: string; // link bấm thẳng tới chỗ cần sửa
  retry: boolean; // thử lại sau ít phút có thể được
  by: "rule" | "ai";
};
export type AgentStep = string;

const ADMIN: Record<string, string> = {
  wpcom: "https://wordpress.com/sites",
  blogger: "https://www.blogger.com/",
  tumblr: "https://www.tumblr.com/dashboard",
  netlify: "https://app.netlify.com/",
  vercel: "https://vercel.com/dashboard",
  github: "https://github.com/settings/tokens",
  codeberg: "https://codeberg.org/user/settings/applications",
  mastodon: "https://mastodon.social/settings/applications",
};

/** Đọc lỗi bằng quy tắc (không tốn AI). Không nhận ra thì trả null → mới hỏi AI. */
export function diagnoseRule(platform: string, name: string, e: unknown): Diagnosis | null {
  const msg = errorMessage(e);
  const status = e instanceof HttpError ? e.status : Number(msg.match(/HTTP (\d{3})/)?.[1] ?? 0);
  const d = (kind: Diagnosis["kind"], message: string, fix?: string, retry = false, link = ADMIN[platform]): Diagnosis => ({ kind, message, fix, link, retry, by: "rule" });

  if (/archived or suspended|bị WordPress tạm khoá|suspended/i.test(msg))
    return d("suspended", `${name} đang khoá trang này (nghi spam / vi phạm điều khoản).`, "Không chạy lại trên trang này. Gửi kháng nghị cho nền tảng, hoặc dùng trang khác.", false, platform === "wpcom" ? "https://wordpress.com/help/contact" : ADMIN[platform]);
  if (/deleted this site|đã bị xoá|HTTP 410|\b410\b/i.test(msg) || status === 410)
    return d("gone", `Trang đích trên ${name} đã bị xoá.`, "Khôi phục trang trên nền tảng (nếu còn trong 30 ngày) hoặc chọn trang khác rồi tạo lại.");
  if (/Chưa kết nối|Chưa chọn|chưa có khoá|Chưa cài/i.test(msg))
    return d("setup", msg.replace(/^\[[^\]]+\]\s*/, ""), "Làm bước kết nối / chọn trang cho nền tảng này ở phía trên rồi bấm Thử lại.");
  if (status === 401 || /invalid[_ ]token|token.*(expired|revoked|invalid)|Unauthorized|hết hạn|Bad credentials|invalid_grant/i.test(msg))
    return d("auth", `Kết nối ${name} đã hết hạn hoặc bị thu hồi.`, `Bấm "Ngắt kết nối" ${name} rồi kết nối lại, sau đó Thử lại.`);
  if (status === 403 && /scope|permission|quyền|forbidden/i.test(msg))
    return d("auth", `${name} không cho phép thao tác này với quyền đang cấp.`, `Kết nối lại ${name} và cấp đủ quyền (đọc + ghi), rồi Thử lại.`);
  if (/đã có người dùng|đã có trang gốc|already (exists|taken)|name.*taken|HTTP 422|\b409\b/i.test(msg) || status === 422 || status === 409)
    return d("name", msg.replace(/^\[[^\]]+\]\s*/, ""), "Đổi Tên trang mong muốn, hoặc xoá hẳn trang cũ trùng tên (có thể là lần tạo dở trước đó) rồi Thử lại.");
  if (status === 429 || /rate.?limit|too many requests|hết lượt/i.test(msg))
    return d("limit", `${name} đang giới hạn số lần gọi (bấm quá nhiều trong thời gian ngắn).`, "Đợi 10–15 phút rồi bấm Thử lại. Đừng bấm liên tục — dễ bị nghi spam.", true);
  if ([500, 502, 503, 504].includes(status) || /timeout|timed out|fetch failed|network|ECONN|socket|quá tải|overloaded/i.test(msg))
    return d("transient", `${name} đang chập chờn / phản hồi chậm (lỗi tạm thời phía nền tảng).`, "Đợi vài phút rồi bấm Thử lại.", true);
  if (/endpoint have been disabled|disabled|deprecated|no longer supported/i.test(msg))
    return d("unknown", `${name} vừa tắt một cách gọi cũ mà app đang dùng — cần cập nhật app.`, "Chụp màn hình này gửi người phụ trách app để sửa.", false);
  return null;
}

/** Lỗi lạ: nhờ AI (Gemini, chế độ nhanh) giải thích bằng lời dễ hiểu. AI lỗi → vẫn trả lời bằng câu chung, không làm hỏng kết quả. */
export async function diagnoseAI(env: Env | null, platform: string, name: string, e: unknown): Promise<Diagnosis> {
  const raw = errorMessage(e);
  const fallback: Diagnosis = { kind: "unknown", message: `${name} báo lỗi chưa rõ nguyên nhân.`, fix: "Bấm Thử lại sau vài phút. Vẫn lỗi thì chụp màn hình gửi người phụ trách app.", link: ADMIN[platform], retry: true, by: "rule" };
  if (!env) return fallback;
  try {
    const out = await callAIJson(env, {
      system: `Bạn là trợ lý kỹ thuật giải thích lỗi cho người KHÔNG rành kỹ thuật (nhân viên marketing Việt Nam).
App vừa tự tạo trang social (website vệ tinh) trên nền tảng "${name}" và gặp lỗi. Đọc thông báo lỗi gốc, trả JSON:
{"kind":"transient|auth|gone|suspended|setup|name|limit|content|unknown","message":"chuyện gì xảy ra, 1 câu ngắn, tiếng Việt đời thường, không thuật ngữ","fix":"người dùng cần làm gì, 1–2 câu, cụ thể","retry":true|false}
retry=true chỉ khi thử lại sau ít phút có khả năng thành công. Không bịa thông tin không có trong lỗi.`,
      user: `Lỗi gốc: ${raw.slice(0, 1500)}`,
      geminiSchema: {
        type: "object",
        properties: { kind: { type: "string" }, message: { type: "string" }, fix: { type: "string" }, retry: { type: "boolean" } },
        required: ["kind", "message", "fix", "retry"],
      },
      temperature: 0.2,
      fast: true,
    });
    const j = parseJsonLoose(out);
    if (!j?.message) return fallback;
    return { kind: j.kind || "unknown", message: String(j.message), fix: j.fix ? String(j.fix) : fallback.fix, link: ADMIN[platform], retry: !!j.retry, by: "ai" };
  } catch {
    return fallback;
  }
}

/** Nền tảng nào thử lại tự động mà KHÔNG tạo trùng (tạo trang theo slug → có rồi thì cập nhật). Nơi khác thử lại có thể ra 2 trang → để người dùng bấm. */
const SAFE_RETRY = new Set(["wpcom"]);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Chạy 1 nền tảng có agent trông: lỗi tạm thời ở nền tảng thử lại an toàn → tự thử lại 2 lần (3s, 8s).
 * Hết cách → chẩn đoán (quy tắc trước, AI sau) và trả về lời dễ hiểu + cách sửa.
 */
export async function runWithAgent<T>(platform: string, name: string, fn: () => Promise<T>, aiEnv: () => Promise<Env | null>):
  Promise<{ ok: true; value: T; steps: AgentStep[] } | { ok: false; error: string; diagnosis: Diagnosis; steps: AgentStep[] }> {
  const steps: AgentStep[] = [];
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const value = await fn();
      if (i) steps.push(`Thử lại lần ${i} thành công`);
      return { ok: true, value, steps };
    } catch (e) {
      last = e;
      const d = diagnoseRule(platform, name, e);
      if (!(SAFE_RETRY.has(platform) && d?.kind === "transient") || i === 2) break;
      steps.push(`Lần ${i + 1} lỗi tạm thời (${errorMessage(e).slice(0, 80)}) — tự thử lại sau ${i ? 8 : 3} giây`);
      await wait(i ? 8000 : 3000);
    }
  }
  const diagnosis = diagnoseRule(platform, name, last) ?? (await diagnoseAI(await aiEnv().catch(() => null), platform, name, last));
  steps.push(diagnosis.by === "ai" ? "Lỗi lạ — đã nhờ AI đọc lỗi" : "Đã đọc lỗi bằng quy tắc");
  return { ok: false, error: errorMessage(last), diagnosis, steps };
}

// ── Tầng 2: người kiểm tra sau khi tạo ──
export type CheckItem = { label: string; url: string; status: number; ok: boolean; note?: string };
export type CheckReport = { at: string; ok: boolean; summary: string; items: CheckItem[]; fixed: string[]; pending?: boolean };

const decode = (s: string) => s.replace(/&#8211;|&ndash;/g, "–").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"');
const norm = (s: string) => decode(s).normalize("NFC").toLowerCase();

/** Mở 1 trang, xem lên chưa / bị khoá / có tên thương hiệu không. */
export async function checkPage(label: string, url: string, brand: string): Promise<CheckItem> {
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; TroLyAI-SEONGON-Check/1.0)" }, signal: AbortSignal.timeout(15_000) });
    const html = r.status < 500 ? (await r.text()).slice(0, 400_000) : "";
    if (/archived or suspended|has been suspended|account suspended/i.test(html)) return { label, url, status: r.status, ok: false, note: "Bị nền tảng khoá (nghi spam)" };
    if (r.status === 410) return { label, url, status: r.status, ok: false, note: "Trang đã bị xoá" };
    if (r.status === 404) return { label, url, status: r.status, ok: false, note: "Chưa có trang (404)" };
    if (r.status >= 400) return { label, url, status: r.status, ok: false, note: `Mở lỗi (mã ${r.status})` };
    const word = norm(brand).split(/\s+[-–|:]\s+/)[0]!.trim();
    if (word && !norm(html).includes(word)) return { label, url, status: r.status, ok: false, note: "Mở được nhưng không thấy tên thương hiệu — nội dung có thể chưa lên" };
    if (/<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html)) return { label, url, status: r.status, ok: true, note: "Lên rồi nhưng đang chặn Google (noindex)" };
    return { label, url, status: r.status, ok: true };
  } catch (e) {
    return { label, url, status: 0, ok: false, note: `Không mở được (${errorMessage(e).slice(0, 60)})` };
  }
}

// Hàng chờ kiểm tra (chạy mỗi phút cùng cron hàng chờ WordPress)
export type CheckJob = { owner: string; recId: string; due: number; round: number };
const CKEY = "social-check-queue";
export async function enqueueCheck(env: Env, owner: string, recId: string, delayMs: number) {
  const q = ((await env.DATA.get<CheckJob[]>(CKEY, "json")) ?? []).filter((j) => !(j.owner === owner && j.recId === recId));
  q.push({ owner, recId, due: Date.now() + delayMs, round: 1 });
  await env.DATA.put(CKEY, JSON.stringify(q));
}
/** Lấy các lượt kiểm tra đến giờ (gỡ khỏi hàng chờ); lượt cần kiểm tra lại thì gọi requeue. */
export async function takeDueChecks(env: Env, now: number): Promise<CheckJob[]> {
  const q = (await env.DATA.get<CheckJob[]>(CKEY, "json")) ?? [];
  const due = q.filter((j) => j.due <= now);
  if (!due.length) return [];
  await env.DATA.put(CKEY, JSON.stringify(q.filter((j) => j.due > now)));
  return due;
}
export async function requeueCheck(env: Env, job: CheckJob, delayMs: number) {
  const q = (await env.DATA.get<CheckJob[]>(CKEY, "json")) ?? [];
  q.push({ ...job, due: Date.now() + delayMs, round: job.round + 1 });
  await env.DATA.put(CKEY, JSON.stringify(q));
}

// ── Tầng 1 chạy nền: hàng chờ tự thử lại nền tảng bị lỗi ──
export type RetryJob = { id: string; owner: string; platform: string; attempt: number; due: number; ctx: unknown; firstError: string };
const RKEY = "social-retry-queue";
const readR = async (env: Env) => (await env.DATA.get<RetryJob[]>(RKEY, "json")) ?? [];
export async function enqueueRetry(env: Env, job: Omit<RetryJob, "id">) {
  const q = (await readR(env)).filter((j) => !(j.owner === job.owner && j.platform === job.platform)); // mỗi nền tảng 1 lượt chờ
  q.push({ ...job, id: crypto.randomUUID() });
  await env.DATA.put(RKEY, JSON.stringify(q));
}
export async function takeDueRetries(env: Env, now: number): Promise<RetryJob[]> {
  const q = await readR(env);
  const due = q.filter((j) => j.due <= now);
  if (due.length) await env.DATA.put(RKEY, JSON.stringify(q.filter((j) => j.due > now)));
  return due;
}
export async function requeueRetry(env: Env, job: RetryJob, delayMs: number) {
  const q = await readR(env);
  q.push({ ...job, attempt: job.attempt + 1, due: Date.now() + delayMs });
  await env.DATA.put(RKEY, JSON.stringify(q));
}
export const pendingRetries = async (env: Env, owner: string) =>
  (await readR(env)).filter((j) => j.owner === owner).map((j) => ({ platform: j.platform, attempt: j.attempt, due: new Date(j.due).toISOString(), firstError: j.firstError }));

// ── Nhật ký agent của từng dự án (30 việc gần nhất) ──
export type AgentLogItem = { at: string; platform: string; ok: boolean; text: string; link?: string };
const logKey = (owner: string) => `agent-log:${owner}`;
export async function agentLog(env: Env, owner: string, item: Omit<AgentLogItem, "at">) {
  const cur = (await env.DATA.get<AgentLogItem[]>(logKey(owner), "json")) ?? [];
  await env.DATA.put(logKey(owner), JSON.stringify([{ ...item, at: new Date().toISOString() }, ...cur].slice(0, 30)));
}
export const readAgentLog = async (env: Env, owner: string) => (await env.DATA.get<AgentLogItem[]>(logKey(owner), "json")) ?? [];
/** Nền tảng đã tạo được (người dùng tự bấm Thử lại) → huỷ lượt agent đang chờ, tránh tạo trùng. */
export async function cancelRetry(env: Env, owner: string, platform: string) {
  const q = await readR(env);
  const rest = q.filter((j) => !(j.owner === owner && j.platform === platform));
  if (rest.length !== q.length) await env.DATA.put(RKEY, JSON.stringify(rest));
}
