// Module AI: sinh 3 trang (Trang chủ, Giới thiệu, Blog) dạng Clean HTML chuẩn SEO.
import type { BusinessInfo, Env, GeneratedContent, GeneratedPage, PageKind } from "./types";
import { usFetch } from "./egress";
import { clampMeta, cleanHtml, ensureTargetLink, fetchJson, HttpError, slugify } from "./util";

export const SYSTEM_PROMPT = `Bạn là chuyên gia SEO Content tiếng Việt. Nhiệm vụ: viết nội dung cho website vệ tinh (Web 2.0) của một doanh nghiệp.

SINH ĐÚNG 3 TRANG, theo thứ tự:
1. kind="home"  — Trang chủ: giới thiệu tổng quan thương hiệu, sản phẩm/dịch vụ chính, lý do nên chọn. 500–700 từ.
2. kind="about" — Trang Giới thiệu: câu chuyện, sứ mệnh, giá trị cốt lõi, đội ngũ/cách làm việc. 400–600 từ.
3. kind="blog"  — 1 Bài viết Blog chuẩn SEO: chọn 1 chủ đề thông tin hữu ích mà khách hàng của ngành hay tìm kiếm (không phải bài quảng cáo). 900–1200 từ, có phần mở bài, các mục H2/H3, kết luận.

QUY TẮC ĐỊNH DẠNG (BẮT BUỘC):
- Trả về Clean HTML: chỉ dùng <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <a>, <blockquote>.
- KHÔNG dùng <h1> trong html (tiêu đề "title" sẽ được nền tảng hiển thị thành H1). KHÔNG dùng class, style, id, script, markdown, \`\`\`.
- Cấu trúc heading logic: H2 cho các phần chính, H3 cho ý con nằm trong H2. Không nhảy cấp.
- Chèn thẻ <a href="{TARGET_URL}">anchor text tự nhiên</a> trỏ về website chính: Trang chủ 2–3 lần, Giới thiệu 1–2 lần, Blog 2–3 lần.
  Anchor text phải là cụm từ có nghĩa nằm tự nhiên trong câu (ví dụ tên thương hiệu, tên dịch vụ), KHÔNG dùng "bấm vào đây", KHÔNG dồn link vào 1 đoạn.
- Mỗi trang 1 "slug" không dấu, ngắn gọn, nối bằng gạch ngang.

QUY TẮC META:
- Mỗi trang 1 "metaDescription" RIÊNG, KHÔNG trùng nhau, TỐI ĐA 160 KÝ TỰ (tính cả dấu cách).
- Đánh trúng ý định tìm kiếm (search intent) của trang: trang chủ = tìm thương hiệu/dịch vụ; giới thiệu = tìm hiểu doanh nghiệp; blog = tìm thông tin.
- Có từ khoá chính ở đầu câu, kết thúc bằng lợi ích hoặc lời mời hành động nhẹ nhàng.

VĂN PHONG: chuyên nghiệp, tự nhiên, không nhồi từ khoá, không bịa số liệu/giải thưởng/khách hàng cụ thể, không hứa hẹn tuyệt đối ("số 1", "tốt nhất", "cam kết 100%").

ĐẦU RA: CHỈ trả về JSON đúng dạng:
{"pages":[{"kind":"home","title":"...","slug":"...","metaDescription":"...","html":"..."},{"kind":"about",...},{"kind":"blog",...}]}`;

function userPrompt(b: BusinessInfo): string {
  return `Thông tin doanh nghiệp:
- Tên thương hiệu: ${b.brandName}
- Ngành nghề: ${b.industry}
- Thông điệp/Slogan chính: ${b.slogan || "(không có)"}
- Website chính (TARGET_URL): ${b.targetUrl}
${extraInfo(b)}
Hãy viết 3 trang theo đúng quy tắc. Mọi thẻ <a> trỏ về đúng địa chỉ: ${b.targetUrl}`;
}

/** Thông tin bổ sung từ sheet: dùng nguyên văn, giữ thống nhất NAP (tên – địa chỉ – SĐT) trên mọi social. */
export function extraInfo(b: BusinessInfo): string {
  const lines = [
    b.companyName && `- Tên đầy đủ/pháp lý: ${b.companyName}`,
    b.products && `- Sản phẩm/dịch vụ chủ đạo: ${b.products}`,
    b.about && `- Giới thiệu do doanh nghiệp cung cấp (dựa vào đây, viết lại tự nhiên, không chép nguyên): ${b.about}`,
    b.address && `- Địa chỉ: ${b.address}`,
    b.phone && `- Số điện thoại: ${b.phone}`,
    b.email && `- Email liên hệ: ${b.email}`,
    b.hashtags && `- Hashtag/từ khoá phụ (lồng ghép tự nhiên, không nhồi): ${b.hashtags}`,
    b.bio && `- Bio ngắn của thương hiệu: ${b.bio}`,
    b.occupation && `- Nghề nghiệp / lĩnh vực: ${b.occupation}`,
    b.birthday && `- Ngày thành lập: ${b.birthday}`,
    b.zipCode && `- Mã bưu chính: ${b.zipCode}`,
  ].filter(Boolean);
  if (!lines.length) return "";
  const nap = b.address || b.phone || b.email;
  return `
Thông tin bổ sung (CHÍNH XÁC — chỉ dùng đúng những gì có ở đây, không thêm số liệu/địa chỉ khác):
${lines.join("\n")}
${nap ? `Ở cuối Trang chủ và trang Giới thiệu, thêm mục <h2>Thông tin liên hệ</h2> liệt kê đúng NGUYÊN VĂN tên, địa chỉ, số điện thoại, email ở trên (giữ thống nhất NAP).` : ""}
`;
}

const GEMINI_SCHEMA = {
  type: "OBJECT",
  properties: {
    pages: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          kind: { type: "STRING", enum: ["home", "about", "blog"] },
          title: { type: "STRING" },
          slug: { type: "STRING" },
          metaDescription: { type: "STRING" },
          html: { type: "STRING" },
        },
        required: ["kind", "title", "slug", "metaDescription", "html"],
      },
    },
  },
  required: ["pages"],
};

interface AIRequest {
  system: string;
  user: string;
  geminiSchema: object;
  temperature: number;
  // true = cho Gemini tra Google (Search grounding) để có thông tin API mới nhất.
  // Gemini không cho dùng tra cứu cùng lúc với ép khuôn JSON, nên khuôn JSON được mô tả trong prompt.
  search?: boolean;
  // true = việc nhỏ cần trả lời nhanh (tách việc, giải thích lỗi): tắt bớt "suy nghĩ" của model, chờ tối đa 40 giây/model.
  fast?: boolean;
}

/** Lấy JSON từ câu trả lời của AI (bỏ ```json, lấy đoạn {...} ngoài cùng). */
export function parseJsonLoose(raw: string): any {
  const s = raw.replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(s.slice(start, end + 1));
    throw new Error("AI trả về sai định dạng JSON — hãy thử lại");
  }
}

async function callGemini(env: Env, req: AIRequest): Promise<string> {
  if (!env.GEMINI_API_KEY) throw new Error("Chưa cài GEMINI_API_KEY trên Worker");
  // Thử lần lượt các model: model bị ngừng (404), đang quá tải (503/500), hết lượt riêng của model đó (429)
  // thì chuyển ngay sang model kế tiếp — người dùng không phải bấm lại.
  // Nhớ model vừa chạy tốt (thử nó trước) và model vừa lỗi (để xuống cuối 5 phút) — đỡ mất thời gian thử lại model đang quá tải.
  const now = Date.now();
  const all = [...new Set([env.GEMINI_MODEL, ...GEMINI_FALLBACK].filter(Boolean) as string[])];
  const tot = modelTot && modelTot.until > now && all.includes(modelTot.name) ? [modelTot.name] : [];
  const models = [...new Set([...tot, ...all])].sort((a, b) => Number((modelLoi[a] ?? 0) > now) - Number((modelLoi[b] ?? 0) > now));
  let lastErr: unknown;
  for (const model of models) {
    try {
      const text = await callGeminiModel(env, req, model);
      modelTot = { name: model, until: Date.now() + 15 * 60_000 };
      return text;
    } catch (e) {
      lastErr = e;
      const chuyen =
        e instanceof HttpError &&
        ([0, 404, 429, 500, 502, 503, 504].includes(e.status) || /no longer available|not found|high demand|overloaded/i.test(e.detail));
      if (!chuyen) throw e;
      modelLoi[model] = Date.now() + 5 * 60_000;
      if (modelTot?.name === model) modelTot = null;
    }
  }
  if (lastErr instanceof HttpError && lastErr.status === 429) {
    throw new Error("Khoá Gemini đã hết lượt miễn phí ở mọi phiên bản AI — đợi 1–2 phút, hoặc sau ~15h chiều nếu hết lượt trong ngày");
  }
  if (lastErr instanceof HttpError && lastErr.status >= 500) {
    throw new Error("Google Gemini đang quá tải ở mọi phiên bản AI — thử lại sau 1–2 phút");
  }
  throw lastErr;
}

let modelTot: { name: string; until: number } | null = null;
const modelLoi: Record<string, number> = {};

export const GEMINI_FALLBACK = [
  "gemini-3.8-flash",
  "gemini-flash-latest",
  "gemini-3.5-flash",
  "gemini-flash-lite-latest",
  "gemini-2.5-flash",
];

async function callGeminiModel(env: Env, req: AIRequest, model: string): Promise<string> {
  const vertex = env.GEMINI_ENDPOINT === "vertex";
  // Khoá AI Studio -> generativelanguage; khoá Google Cloud (Vertex AI express) -> aiplatform.
  const url = vertex
    ? `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY!)}`
    : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  // Model đời mới mặc định "suy nghĩ" trước khi trả lời — chậm cả chục giây kể cả câu đơn giản.
  // Việc nhỏ (fast) thì giảm suy nghĩ: model 2.5 dùng thinkingBudget, model 3.x dùng thinkingLevel.
  let thinking: object | undefined = req.fast
    ? /gemini-2\.5/.test(model)
      ? { thinkingBudget: 0 }
      : { thinkingLevel: "low" }
    : undefined;
  const send = (search: boolean) =>
    fetchJson<any>(
      "Gemini",
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(vertex ? {} : { "x-goog-api-key": env.GEMINI_API_KEY! }) },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: "user", parts: [{ text: req.user }] }],
          ...(search ? { tools: [vertex ? { googleSearch: {} } : { google_search: {} }] } : {}),
          generationConfig: {
            temperature: req.temperature,
            ...(search ? {} : { responseMimeType: "application/json", responseSchema: req.geminiSchema }),
            ...(thinking ? { thinkingConfig: thinking } : {}),
          },
        }),
      },
      req.fast ? 40_000 : 120_000,
      usFetch(env),
    );
  let data: any;
  try {
    try {
      data = await send(Boolean(req.search));
    } catch (e) {
      // Model không nhận kiểu cài "suy nghĩ" này -> gửi lại không kèm
      if (!(thinking && e instanceof HttpError && e.status === 400 && /thinking/i.test(e.detail))) throw e;
      thinking = undefined;
      data = await send(Boolean(req.search));
    }
  } catch (e) {
    // Model/gói không hỗ trợ tra cứu -> hỏi lại không tra cứu.
    if (!req.search) throw e;
    data = await send(false);
  }
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("");
  if (!text) {
    const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || "không rõ";
    throw new Error(`Gemini không trả nội dung (lý do: ${reason})`);
  }
  return text;
}

async function callOpenAI(env: Env, req: AIRequest): Promise<string> {
  if (!env.OPENAI_API_KEY) throw new Error("Chưa cài OPENAI_API_KEY trên Worker");
  const data = await fetchJson<any>(
    "OpenAI",
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-4.1-mini",
        temperature: req.temperature,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      }),
    },
    120_000,
  );
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI không trả nội dung");
  return text;
}

/** Gọi AI đang cấu hình (Gemini/OpenAI), trả về chuỗi JSON thô. */
export function callAIJson(env: Env, req: AIRequest): Promise<string> {
  const provider = (env.AI_PROVIDER || (env.GEMINI_API_KEY ? "gemini" : "openai")).toLowerCase();
  return provider === "openai" ? callOpenAI(env, req) : callGemini(env, req);
}

/** Hậu kiểm: làm sạch HTML, ép meta ≤160, đảm bảo có link về website chính. */
function normalize(raw: string, b: BusinessInfo): GeneratedContent {
  let parsed: any;
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new Error("AI trả về sai định dạng JSON — hãy bấm chạy lại");
  }
  const kinds: PageKind[] = ["home", "about", "blog"];
  const pages: GeneratedPage[] = kinds.map((kind) => {
    const p = (parsed?.pages ?? []).find((x: any) => x?.kind === kind);
    if (!p?.html || !p?.title) throw new Error(`AI thiếu trang "${kind}" — hãy bấm chạy lại`);
    const title = String(p.title).replace(/<[^>]+>/g, "").trim();
    return {
      kind,
      title,
      slug: slugify(p.slug || title) || kind,
      metaDescription: clampMeta(String(p.metaDescription || title)),
      html: ensureTargetLink(cleanHtml(String(p.html)), b.targetUrl, b.brandName),
    };
  });
  return { pages };
}

export async function generateContent(env: Env, b: BusinessInfo): Promise<GeneratedContent> {
  const raw = await callAIJson(env, {
    system: SYSTEM_PROMPT,
    user: userPrompt(b),
    geminiSchema: GEMINI_SCHEMA,
    temperature: 0.7,
  });
  return normalize(raw, b);
}
