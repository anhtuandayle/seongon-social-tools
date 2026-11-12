// Ghi link trang chủ social vừa tạo vào "sheet theo dõi social" của dự án (Google Sheets API, OAuth).
// Bằng quy tắc, không dùng AI: tìm dòng tiêu đề có cột Loại social/Nền tảng + cột Domain/Link → tìm đúng dòng của nền tảng
// → điền link; chưa có dòng thì thêm dòng mới. Kết nối Google Sheets: 1 lần cho mỗi người (Gmail có quyền sửa sheet).
import { decrypt, encrypt, randomToken } from "../store";
import type { Env } from "../types";
import { fetchJson } from "../util";
import { googleApp, googleRedirectUri, type GoogleApp } from "./blogger";

export type SheetsAccount = { refreshToken: string; username: string; connectedAt: string; app: GoogleApp };
const accKey = (email: string) => `gsheets:${email.split("#")[0]}`;

export async function sheetsAuthorizeUrl(env: Env, owner: string) {
  const app = await googleApp(env, owner);
  if (!app) throw new Error("Chưa cài app Google (làm ở thẻ Blogger → Bước 1)");
  const state = randomToken(16);
  await env.DATA.put(`google-state:${state}`, `sheets|${owner}`, { expirationTtl: 600 });
  const q = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: googleRedirectUri(env),
    response_type: "code",
    scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function sheetsFinish(env: Env, owner: string, code: string): Promise<void> {
  const app = await googleApp(env, owner);
  if (!app) throw new Error("Chưa cài app Google");
  const tok = await fetchJson<{ access_token?: string; refresh_token?: string }>("Google", "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: googleRedirectUri(env), code, grant_type: "authorization_code" }),
  });
  if (!tok.refresh_token) throw new Error("Google không trả mã làm mới — vào myaccount.google.com/permissions gỡ quyền app rồi kết nối lại");
  const me = await fetchJson<{ email?: string }>("Google", "https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } }).catch(() => ({ email: "" }));
  const acc: SheetsAccount = { refreshToken: tok.refresh_token, username: me.email || "Google", connectedAt: new Date().toISOString(), app };
  await env.DATA.put(accKey(owner), await encrypt(env, acc));
}

export const sheetsAccount = async (env: Env, owner: string) => decrypt<SheetsAccount | null>(env, (await env.DATA.get(accKey(owner))) ?? undefined, null);
export const sheetsDisconnect = (env: Env, owner: string) => env.DATA.delete(accKey(owner));

// ---------- sheet theo dõi của từng dự án + cách điền (người dùng chọn cột) ----------
/** Cách điền: tab nào, dòng tiêu đề số mấy, mỗi thông tin vào cột nào (chữ cột A, B, C…; rỗng = không điền). */
export type TrackMap = { gid?: string; headerRow?: number; cols?: { platform?: string; link?: string; date?: string; account?: string } };
export type TrackSheet = { url: string; map?: TrackMap };
const trackKey = (owner: string) => `social-track:${owner}`;

export async function getTrack(env: Env, owner: string): Promise<TrackSheet | null> {
  const raw = await env.DATA.get(trackKey(owner));
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as TrackSheet;
    if (j?.url) return j;
  } catch {}
  return { url: raw }; // bản cũ chỉ lưu link
}
export const getTrackSheet = async (env: Env, owner: string) => (await getTrack(env, owner))?.url ?? "";
export async function setTrackSheet(env: Env, owner: string, url: string, map?: TrackMap) {
  if (!url) return env.DATA.delete(trackKey(owner));
  if (!/docs\.google\.com\/spreadsheets\/d\/[\w-]{20,}/.test(url)) throw new Error("Link sheet chưa đúng — copy link Google Sheet trên thanh địa chỉ");
  const old = await getTrack(env, owner);
  const keepMap = map ?? (old?.url === url.trim() ? old.map : undefined); // đổi sheet khác thì phải chọn cột lại
  await env.DATA.put(trackKey(owner), JSON.stringify({ url: url.trim(), map: keepMap }));
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().trim();
/** Từ khoá nhận ra từng nền tảng trong cột nền tảng. */
const PLATFORM_WORDS: Record<string, RegExp> = {
  Netlify: /netlify/, Vercel: /vercel/, Blogger: /blogger|blogspot/, "WordPress.com": /wordpress/, "GitHub Pages": /github/, "Codeberg Pages": /codeberg/, Telegraph: /telegra/, Mastodon: /mastodon/, Tumblr: /tumblr/,
};
const colLetter = (i: number) => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const colIndex = (l: string) => [...l.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

async function openSheet(env: Env, owner: string, gidWanted?: string) {
  const track = await getTrack(env, owner);
  if (!track) throw new Error("Dự án chưa có sheet theo dõi social");
  const acc = await sheetsAccount(env, owner);
  if (!acc) throw new Error("Chưa kết nối Google Sheets");
  const id = track.url.match(/spreadsheets\/d\/([\w-]+)/)![1]!;
  const t = await fetchJson<{ access_token?: string }>("Google", "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: acc.app.clientId, client_secret: acc.app.clientSecret, refresh_token: acc.refreshToken, grant_type: "refresh_token" }),
  });
  const auth = { Authorization: `Bearer ${t.access_token}` };
  const API = `https://sheets.googleapis.com/v4/spreadsheets/${id}`;
  const meta = await fetchJson<{ sheets: { properties: { sheetId: number; title: string } }[] }>("Google Sheets", `${API}?fields=sheets.properties(sheetId,title)`, { headers: auth }).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    const proj = msg.match(/project (\d+)/)?.[1];
    if (/has not been used|is disabled|SERVICE_DISABLED/i.test(msg)) {
      throw new Error(`Chưa bật Google Sheets API trong Google Cloud. Mở https://console.developers.google.com/apis/api/sheets.googleapis.com/overview${proj ? `?project=${proj}` : ""} → bấm Bật (Enable), đợi 2–3 phút rồi thử lại.`);
    }
    if (/403|PERMISSION_DENIED|caller does not have permission/i.test(msg)) {
      throw new Error(`Gmail ${acc.username} chưa có quyền Chỉnh sửa sheet này — mở sheet → Chia sẻ → thêm ${acc.username} với quyền Người chỉnh sửa, rồi thử lại.`);
    }
    throw new Error(`Không mở được sheet (${e instanceof Error ? e.message : e}) — kiểm tra Gmail ${acc.username} có quyền Chỉnh sửa sheet này, và Google Sheets API đã bật`);
  });
  const gid = gidWanted ?? track.map?.gid ?? track.url.match(/[#&?]gid=(\d+)/)?.[1];
  const tab = (gid ? meta.sheets.find((s) => String(s.properties.sheetId) === gid) : undefined) ?? meta.sheets[0]!;
  const title = tab.properties.title;
  const q = (r: string) => `'${title.replace(/'/g, "''")}'!${r}`;
  const data = await fetchJson<{ values?: string[][] }>("Google Sheets", `${API}/values/${encodeURIComponent(q("A1:Z1000"))}`, { headers: auth });
  return { track, auth, API, q, rows: data.values ?? [], tabs: meta.sheets.map((s) => ({ gid: String(s.properties.sheetId), title: s.properties.title })), tab: { gid: String(tab.properties.sheetId), title } };
}

/** Đoán dòng tiêu đề + cột (để gợi ý sẵn khi người dùng chọn). */
function guess(rows: string[][]) {
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const cells = rows[r]!.map((c) => norm(String(c ?? "")));
    const p = cells.findIndex((c) => /loai social|nen tang|platform|kenh|social/.test(c) && !/link|url|domain/.test(c));
    const pick = (re: RegExp) => cells.findIndex((c) => re.test(c) && !/tao|dang ky|signup|huong dan|pass|mat khau/.test(c));
    const l = [/^domain$|^url$|link (social|trang|profile|trang chu)/, /domain|url/, /link|duong dan|dia chi/].map(pick).find((i) => i >= 0) ?? -1;
    if (p >= 0 && l >= 0) {
      const d = cells.findIndex((c) => /ngay tao|ngay|date/.test(c));
      const a = cells.findIndex((c) => /username|tai khoan|user|mail/.test(c) && !/pass/.test(c));
      return { headerRow: r + 1, platform: colLetter(p), link: colLetter(l), date: d >= 0 ? colLetter(d) : "", account: a >= 0 ? colLetter(a) : "" };
    }
  }
  return { headerRow: 1, platform: "", link: "", date: "", account: "" };
}

/** Đọc sheet: danh sách tab, các cột của dòng tiêu đề, gợi ý cột — để người dùng chọn điền thông tin vào đâu. */
export async function inspectSheet(env: Env, owner: string, gid?: string, headerRow?: number) {
  const s = await openSheet(env, owner, gid);
  const g = guess(s.rows);
  const sameTab = !gid || gid === s.track.map?.gid;
  const hr = headerRow || (sameTab && s.track.map?.headerRow) || g.headerRow;
  const head = s.rows[hr - 1] ?? [];
  const width = Math.max(head.length, ...s.rows.slice(hr - 1, hr + 5).map((r) => r.length), 1);
  const columns = Array.from({ length: Math.min(width, 26) }, (_, i) => ({ col: colLetter(i), text: String(head[i] ?? "").trim(), sample: String(s.rows[hr]?.[i] ?? "").trim().slice(0, 60) }));
  const saved = sameTab ? s.track.map?.cols : undefined;
  return {
    tabs: s.tabs,
    tab: s.tab,
    headerRow: hr,
    columns,
    cols: { platform: saved?.platform ?? g.platform, link: saved?.link ?? g.link, date: saved?.date ?? g.date, account: saved?.account ?? g.account },
    saved: !!s.track.map?.cols?.link,
  };
}

export type SheetWrite = { platform: string; url: string; date?: string; account?: string };
export type SheetWriteResult = { platform: string; ok: boolean; cell?: string; action?: "dien" | "them"; error?: string };

/** Ghi vào sheet theo cách điền người dùng đã chọn (chưa chọn thì đoán): tìm đúng dòng nền tảng, điền các cột; chưa có dòng thì thêm. */
export async function writeLinksToSheet(env: Env, owner: string, items: SheetWrite[]): Promise<SheetWriteResult[]> {
  const s = await openSheet(env, owner);
  const g = guess(s.rows);
  const m = s.track.map?.cols?.link ? { headerRow: s.track.map.headerRow ?? g.headerRow, ...s.track.map.cols } : g;
  if (!m.link) throw new Error("Chưa chọn cột điền link — bấm “Đọc sheet” rồi chọn cột cho từng thông tin");
  const head = m.headerRow - 1;
  const pCol = m.platform ? colIndex(m.platform) : -1;
  let last = head;
  for (let r = head + 1; r < s.rows.length; r++) if ((s.rows[r] ?? []).some((c) => String(c ?? "").trim())) last = r;
  const updates: { range: string; values: string[][] }[] = [];
  const results: SheetWriteResult[] = [];
  const put = (col: string | undefined, row: number, v?: string) => { if (col && v) updates.push({ range: s.q(`${col}${row + 1}`), values: [[v]] }); };
  let nextNew = last + 1;
  for (const it of items) {
    const re = PLATFORM_WORDS[it.platform] ?? new RegExp(norm(it.platform).replace(/[^a-z0-9]/g, ""));
    let row = -1;
    if (pCol >= 0) for (let r = head + 1; r <= last; r++) if (re.test(norm(String(s.rows[r]?.[pCol] ?? "")))) { row = r; break; }
    const action: "dien" | "them" = row >= 0 ? "dien" : "them";
    if (row < 0) { row = nextNew++; put(m.platform, row, it.platform); }
    put(m.link, row, it.url);
    put(m.date, row, it.date);
    put(m.account, row, it.account);
    results.push({ platform: it.platform, ok: true, cell: `${m.link}${row + 1}`, action });
  }
  if (updates.length) {
    await fetchJson("Google Sheets", `${s.API}/values:batchUpdate`, {
      method: "POST",
      headers: { ...s.auth, "Content-Type": "application/json" },
      body: JSON.stringify({ valueInputOption: "RAW", data: updates }),
    });
  }
  return results;
}
