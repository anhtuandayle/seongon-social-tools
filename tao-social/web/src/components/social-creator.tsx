"use client";

// Tạo social mới tự động: kết nối tài khoản gốc 1 lần → điền thông tin thương hiệu → app tự tạo trang mới
// theo mẫu 4 trang (Trang chủ, Giới thiệu, Danh mục sản phẩm, Blog trống) và trả về link.
import { CheckCircle2, ExternalLink, FolderOpen, Globe, Hand, Link2, Loader2, Plus, Sparkles, Trash2, Unplug, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  type BusinessInfo,
  createSocial,
  deleteProject,
  deleteGoogleApp,
  deleteTumblrApp,
  listTumblrBlogs,
  saveTumblrApp,
  disconnectSheets,
  saveTrackSheet,
  inspectTrackSheet,
  type SheetInspect,
  type TrackCols,
  writeLinksToSheet,
  type SheetWriteResult,
  listBloggerBlogs,
  listWpcomSites,
  type WpcomSiteInfo,
  saveGoogleApp,
  type BlogInfo,
  deleteSocialConnection,
  getProject,
  listProjects,
  type Platform,
  type ProjectSummary,
  saveProject,
  deleteSocialRecord,
  checkSocialNow,
  getAgentLog,
  type AgentLogItem,
  type SocialCreateResult,
  getSocialConnections,
  listSocials,
  previewSocial,
  readSheet,
  scrapeSite,
  type SiteBrand,
  saveSocialConnection,
  saveWpcomApp,
  deleteWpcomApp,
  type SocialConnections,
  type SocialPlatform,
  type SocialRecord,
  type SocialTemplate,
} from "@/lib/api";

/** Các nền tảng tạo social tự động. how = cách kết nối tài khoản gốc. */
const PLATFORMS: { id: SocialPlatform; name: string; domain: string; how: "oauth" | "google" | "tumblr" | "token" | "none"; tokenUrl?: string; tokenSteps?: string; note?: string }[] = [
  { id: "blogger", name: "Blogger", domain: "ten.blogspot.com", how: "google", note: "Tạo blog trống bằng tay 1 lần (1 phút), app dựng các trang" },
  { id: "wpcom", name: "WordPress.com", domain: "ten.wordpress.com", how: "oauth", note: "Tạo trang trống tay 1 lần (địa chỉ = Tên trang mong muốn), app dựng các trang" },
  { id: "netlify", name: "Netlify", domain: "ten.netlify.app", how: "token", tokenUrl: "https://app.netlify.com/user/applications#personal-access-tokens", tokenSteps: "Bấm New access token → đặt tên → Generate → copy mã." },
  { id: "vercel", name: "Vercel", domain: "ten.vercel.app", how: "token", tokenUrl: "https://vercel.com/account/settings/tokens", tokenSteps: "Bấm Create → Scope: tài khoản của bạn → Expiration: No expiration → copy mã." },
  { id: "github", name: "GitHub Pages", domain: "tai-khoan.github.io", note: "Trang ở địa chỉ gốc của tài khoản — mỗi tài khoản GitHub 1 trang", how: "token", tokenUrl: "https://github.com/settings/tokens/new?scopes=repo&description=Tro%20ly%20AI%20SEONGON", tokenSteps: "Expiration: No expiration → tích repo (đã tích sẵn) → Generate token → copy mã." },
  { id: "codeberg", name: "Codeberg Pages", domain: "tai-khoan.codeberg.page", note: "Trang ở địa chỉ gốc của tài khoản — mỗi tài khoản Codeberg 1 trang", how: "token", tokenUrl: "https://codeberg.org/user/settings/applications", tokenSteps: "Ở mục Generate New Token: đặt tên → Select permissions: repository = Read and write, user = Read → Generate Token → copy mã." },
  { id: "tumblr", name: "Tumblr", domain: "ten.tumblr.com", how: "tumblr", note: "Tạo blog tay 1 lần (tên blog = Tên trang mong muốn), app đăng bài Giới thiệu + Danh mục" },
  { id: "mastodon", name: "Mastodon", domain: "mastodon.social/@ten", how: "token", note: "Tạo tài khoản tay 1 lần (tên đăng nhập = Tên trang mong muốn), app tự điền hồ sơ + đăng bài ghim", tokenUrl: "https://mastodon.social/settings/applications/new", tokenSteps: "Tên ứng dụng: Tro ly AI SEONGON → giữ quyền read, write → Gửi → bấm vào ứng dụng vừa tạo → copy “Mã truy cập của bạn”. Ô Máy chủ: nhập máy chủ đã đăng ký (vd mastodon.social)." },
  { id: "telegraph", name: "Telegraph", domain: "telegra.ph/…", how: "none" },
];

/** Các nền tảng chưa tạo tự động được — bấm vào để xem lý do + hướng dẫn tạo tay, kèm thông tin copy sẵn từ form. */
type Upcoming = { name: string; domain: string; note: string; group: "semi" | "manual"; signup: string; steps: string[] };
const UPCOMING: Upcoming[] = [
  { group: "semi", name: "Google Sites", domain: "sites.google.com/view/ten", note: "Google không có cổng tạo Sites → em đang làm cách điều khiển trình duyệt.", signup: "https://sites.google.com/new", steps: ["Mở Google Sites → Trống.", "Thêm 4 trang: Trang chủ, Giới thiệu, Blog, Danh mục sản phẩm.", "Dán logo, nội dung từ nút Xem trước.", "Xuất bản → đặt địa chỉ web → chọn Công khai."] },
  { group: "semi", name: "Cloudflare Pages", domain: "ten.pages.dev", note: "Có cổng tạo trang chính thức — em làm được giống Netlify, chỉ cần anh nhắn để ưu tiên.", signup: "https://dash.cloudflare.com/sign-up", steps: ["Tạo tài khoản Cloudflare (miễn phí).", "Nhắn em — em thêm ô dán mã như Netlify."] },
  { group: "semi", name: "GitLab Pages", domain: "tai-khoan.gitlab.io/ten", note: "Tài khoản GitLab mới phải xác minh danh tính (số điện thoại/thẻ) thì trang mới chạy.", signup: "https://gitlab.com/users/sign_up", steps: ["Tạo tài khoản GitLab và xác minh danh tính.", "Nhắn em — em thêm ô dán mã."] },
  { group: "semi", name: "Firebase Hosting (Google)", domain: "ten.web.app", note: "Cần dự án Firebase + khoá dịch vụ — làm được, hơi nhiều bước cài 1 lần.", signup: "https://console.firebase.google.com/", steps: ["Tạo dự án Firebase bằng Gmail phụ.", "Nhắn em — em hướng dẫn lấy khoá và thêm ô dán."] },
  { group: "semi", name: "Surge.sh", domain: "ten.surge.sh", note: "1 tài khoản đăng nhiều địa chỉ — làm được, nhắn em để ưu tiên.", signup: "https://surge.sh/", steps: ["Nhắn em — em thêm ô đăng ký Surge ngay trong app."] },
  { group: "semi", name: "Google Docs xuất bản web", domain: "docs.google.com/…/pub", note: "Dùng chung tài khoản Google — làm được qua kết nối Google.", signup: "https://docs.google.com/document/create", steps: ["Tạo Docs mới, dán nội dung Trang chủ + Giới thiệu.", "Tệp → Chia sẻ → Xuất bản lên web → Xuất bản."] },
  { group: "semi", name: "Wix", domain: "tai-khoan.wixsite.com/ten", note: "Cổng tạo trang từ mẫu của Wix đang thử nghiệm — cần thử bằng tài khoản Wix của anh.", signup: "https://manage.wix.com/", steps: ["Tạo site mới từ mẫu Blog.", "Thêm trang Giới thiệu, Danh mục sản phẩm, dán nội dung từ nút Xem trước.", "Bấm Publish."] },
  { group: "manual", name: "Pinterest", domain: "pinterest.com/ten", note: "Không cho tạo tài khoản qua cổng. Có tài khoản rồi thì cổng chỉ tạo được bảng (board) và ghim, không sửa được hồ sơ → tạo + điền hồ sơ tay.", signup: "https://www.pinterest.com/business/create/", steps: ["Tạo tài khoản doanh nghiệp bằng email phụ.", "Hồ sơ: Tên, Ảnh đại diện, Bio, Website (xác minh website nếu được).", "Tạo bảng tên theo sản phẩm/dịch vụ."] },
  { group: "manual", name: "X (Twitter)", domain: "x.com/ten", note: "Không cho tạo tài khoản qua cổng; đăng ký có xác minh SĐT + chống bot. Cổng sửa hồ sơ của X cần gói trả phí → tạo tay.", signup: "https://x.com/i/flow/signup", steps: ["Đăng ký bằng email/SĐT xác thực.", "Sửa hồ sơ: Tên, Bio (≤160 ký tự), Vị trí, Website, Ngày sinh, Ảnh đại diện, Ảnh bìa (1500x500)."] },
  { group: "manual", name: "Weebly", domain: "ten.weebly.com", note: "Weebly đã nhập vào Square Online, cổng tạo site cũ đã đóng → chỉ tạo tay.", signup: "https://www.weebly.com/signup", steps: ["Đăng ký, chọn mẫu Blog.", "Thêm trang Giới thiệu, Blog, Danh mục sản phẩm, dán nội dung từ nút Xem trước.", "Publish (chọn địa chỉ .weebly.com / .square.site miễn phí)."] },
  { group: "manual", name: "Goodreads", domain: "goodreads.com/user/show/…", note: "Goodreads đã đóng cổng cho phần mềm (API) từ 2020 — không có cách tạo hay sửa tự động, chỉ làm tay.", signup: "https://www.goodreads.com/user/sign_up", steps: ["Đăng ký bằng email phụ, tên hiển thị = tên thương hiệu.", "Sửa hồ sơ: Ảnh đại diện (logo), Giới thiệu (Bio), Website.", "Nếu là tác giả/nhà xuất bản: đăng ký Goodreads Author Program để có trang tác giả."] },
  { group: "manual", name: "Instapaper", domain: "instapaper.com/p/ten", note: "Là app lưu bài đọc, không có trang hồ sơ để làm social; cổng của Instapaper chỉ lưu link (phải xin duyệt). Giá trị SEO thấp — em không khuyên làm.", signup: "https://www.instapaper.com/account/create", steps: ["Đăng ký bằng email phụ.", "Lưu link bài gốc vào thư mục, bật chia sẻ thư mục công khai nếu có."] },
];

type FieldKey = keyof BusinessInfo;
/** Các ô thông tin — đúng mẫu sheet đầu vào thống nhất với khách. */
const FORM: { title: string; fields: { k: FieldKey; label: string; ph?: string; hint?: string; area?: boolean; wide?: boolean }[] }[] = [
  {
    title: "Thông tin chính",
    fields: [
      { k: "brandName", label: "Tên *", ph: "VD: SEONGON" },
      { k: "industry", label: "Nghề nghiệp / Ngành nghề *", ph: "VD: Dịch vụ SEO" },
      { k: "targetUrl", label: "Website *", ph: "https://...", hint: "Các trang social sẽ có link về website này." },
      { k: "birthday", label: "Ngày sinh (có thể lấy ngày thành lập cty)", ph: "VD: 12/05/2018" },
      { k: "gender", label: "Giới tính", ph: "Nam / Nữ / Khác" },
      { k: "relationship", label: "Tình trạng quan hệ", ph: "VD: Độc thân" },
    ],
  },
  {
    title: "Liên hệ",
    fields: [
      { k: "phone", label: "Số điện thoại" },
      { k: "verifyPhone", label: "Số điện thoại xác thực" },
      { k: "email", label: "Email" },
      { k: "zipCode", label: "Zip Code / Postal Code", ph: "VD: 100000" },
      { k: "address", label: "Địa chỉ", wide: true },
    ],
  },
  {
    title: "Nội dung",
    fields: [
      { k: "bio", label: "Bio", ph: "1–2 câu ngắn", wide: true },
      { k: "about", label: "Giới thiệu", area: true, wide: true, ph: "AI dựa vào đây để viết trang Giới thiệu (viết lại, không chép nguyên văn)" },
      { k: "products", label: "Danh mục sản phẩm / dịch vụ", area: true, wide: true, ph: "Mỗi dòng 1 sản phẩm", hint: "Dùng cho trang Danh mục sản phẩm. Để trống thì AI chỉ nêu nhóm dịch vụ chung của ngành." },
    ],
  },
  {
    title: "Hình ảnh & tài liệu (dán link)",
    fields: [
      { k: "avatarUrl", label: "Ảnh Avatar (512x512)", ph: "Link Google Drive / link ảnh" },
      { k: "logoUrl", label: "Logo", ph: "Link Google Drive / link ảnh" },
      { k: "coverUrl", label: "Ảnh Cover 851x315", ph: "Link Google Drive / link ảnh" },
      { k: "coverWideUrl", label: "Ảnh Cover 1280x720", ph: "Link Google Drive / link ảnh" },
      { k: "licenseUrl", label: "Scan Đăng ký KD", ph: "Link Google Drive" },
      { k: "guidelinesUrl", label: "Brand Guidelines", ph: "Link Google Drive" },
      { k: "note", label: "Ghi chú", area: true, wide: true },
    ],
  },
];
const TEMPLATE_ROWS: [string, string][] = [
  ["Tên", ""],
  ["Ngày sinh (có thể lấy ngày thành lập cty)", ""],
  ["Giới tính", ""],
  ["Số điện thoại", ""],
  ["Địa chỉ", ""],
  ["Website", ""],
  ["Email", ""],
  ["Bio", ""],
  ["Giới thiệu", ""],
  ["Nghề nghiệp", ""],
  ["Tình trạng quan hệ", ""],
  ["Zip Code / Postal Code", ""],
  ["Số điện thoại xác thực", ""],
  ["Ảnh Avatar (512x512)", ""],
  ["Ảnh Cover 851x315", ""],
  ["Ảnh Cover 1280x720", ""],
  ["Scan Đăng ký KD", ""],
  ["Logo", ""],
  ["Brand Guidelines", ""],
  ["Danh mục sản phẩm / dịch vụ", ""],
  ["Ghi chú", "Thông tin các tài khoản social cần được 2 bên tối ưu & thống nhất trước khi khởi tạo"],
];

const EMPTY: BusinessInfo ={ brandName: "", industry: "", slogan: "", logoUrl: "", targetUrl: "", brandColor: "#0d53f0", companyName: "", about: "", products: "", address: "", phone: "", email: "", hashtags: "" };
const PROJECT_KEY = "social-creator-project";

function F({ id, label, value, onChange, placeholder, hint, area }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string; area?: boolean }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {area ? <Textarea id={id} rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} /> : <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

export function SocialCreator() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [projectId, setProjectId] = useState("");
  const [newName, setNewName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [saveState, setSaveState] = useState<"" | "saving" | "saved">("");
  // Bản đã lưu của dự án (để tự lưu không ghi đè phần của tab "Đăng lên trang có sẵn")
  const loaded = useRef<{ id: string; name: string; selected: Platform[]; snap: string } | null>(null);
  const [conns, setConns] = useState<SocialConnections | null>(null);
  const [biz, setBiz] = useState<BusinessInfo>(EMPTY);
  const [sub, setSub] = useState(""); // Tên trang mong muốn ĐÃ LƯU của dự án
  const [subDraft, setSubDraft] = useState("");
  const [editingSub, setEditingSub] = useState(false);
  const [subSaving, setSubSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<SocialRecord[]>([]);
  const [results, setResults] = useState<SocialCreateResult[] | null>(null);
  const [preview, setPreview] = useState<SocialTemplate | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [picked, setPicked] = useState<SocialPlatform[]>(["telegraph"]);
  const [tokenFor, setTokenFor] = useState<SocialPlatform | null>(null);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [mastoHost, setMastoHost] = useState("mastodon.social");
  const [sheetUrl, setSheetUrl] = useState("");
  const [reading, setReading] = useState(false);
  const [fromSheet, setFromSheet] = useState<Set<FieldKey>>(new Set());
  const [site, setSite] = useState<SiteBrand | null>(null);
  const [fromSite, setFromSite] = useState<Set<FieldKey>>(new Set());
  const [scraping, setScraping] = useState(false);
  const [useAI, setUseAI] = useState(false);
  const [blogs, setBlogs] = useState<BlogInfo[] | null>(null);
  const [wpSites, setWpSites] = useState<WpcomSiteInfo[] | null>(null);
  const [wpSiteId, setWpSiteId] = useState("");
  const [wpClean, setWpClean] = useState(false);
  const [retrying, setRetrying] = useState<SocialPlatform | null>(null); // xoá sạch trang + bài cũ trên trang WordPress trước khi dựng
  const loadWpSites = () => {
    if (!projectId) return;
    setWpSites(null);
    listWpcomSites(projectId)
      .then((x) => { setWpSites(x); const live = x.filter((y) => !y.deleted); setWpSiteId((cur) => (live.some((y) => y.id === cur) ? cur : (live.find((y) => sub && y.url.includes(`//${sub}.`)) ?? live[0])?.id ?? "")); })
      .catch((e) => { setWpSites([]); toast.error(e instanceof Error ? e.message : String(e)); });
  };
  const [blogId, setBlogId] = useState("");
  const [tBlogs, setTBlogs] = useState<BlogInfo[] | null>(null);
  const [tBlog, setTBlog] = useState("");
  const loadTBlogs = () => {
    if (!projectId) return;
    setTBlogs(null);
    listTumblrBlogs(projectId)
      .then((b) => { setTBlogs(b); setTBlog((cur) => (b.some((x) => x.id === cur) ? cur : (b.find((x) => x.id === sub.trim()) ?? b.find((x) => x.posts === 0) ?? b[0])?.id ?? "")); })
      .catch((e) => { setTBlogs([]); toast.error(e instanceof Error ? e.message : String(e)); });
  };
  const loadBlogs = () => {
    if (!projectId) return;
    setBlogs(null);
    listBloggerBlogs(projectId)
      .then((b) => { setBlogs(b); setBlogId((cur) => (b.some((x) => x.id === cur) ? cur : (b.find((x) => x.pages === 0) ?? b[0])?.id ?? "")); })
      .catch((e) => { setBlogs([]); toast.error(e instanceof Error ? e.message : String(e)); });
  };

  /** Đọc website chính (bằng quy tắc, không dùng AI) → điền các ô CÒN TRỐNG: logo, ảnh bìa, giới thiệu, sản phẩm, liên hệ, màu. */
  async function readFromSite() {
    setScraping(true);
    try {
      const s = await scrapeSite(biz.targetUrl.trim());
      setSite(s);
      const add: Partial<BusinessInfo> = {};
      const keys: FieldKey[] = [];
      const fill = (k: FieldKey, v?: string) => {
        if (v && !String(biz[k] ?? "").trim()) { (add as Record<string, string>)[k] = v; keys.push(k); }
      };
      fill("logoUrl", s.logo);
      fill("coverWideUrl", s.ogImage || s.images[0]?.src);
      fill("bio", s.description.slice(0, 300));
      fill("about", [s.description, ...s.paragraphs.slice(0, 3)].filter(Boolean).join("\n\n").slice(0, 2500));
      fill("products", s.products.map((p) => p.name).join("\n"));
      fill("phone", s.phones[0]);
      fill("email", s.emails[0]);
      fill("address", s.address);
      if (s.color && (!biz.brandColor || biz.brandColor.toLowerCase() === "#0d53f0")) { add.brandColor = s.color; keys.push("brandColor"); }
      setBiz((b) => ({ ...b, ...add }));
      setFromSite(new Set(keys));
      toast.success(`Đã đọc website: ${s.images.length} ảnh, ${s.products.length} sản phẩm/mục${s.logo ? ", có logo" : ""} — điền ${keys.length} ô còn trống`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 10000 });
    } finally {
      setScraping(false);
    }
  }

  async function readFromSheet() {
    setReading(true);
    try {
      const r = await readSheet({ url: sheetUrl.trim() });
      const rec = r.records[0];
      if (!rec) throw new Error("Không tìm thấy thông tin thương hiệu trong sheet");
      const keys = (Object.keys(rec) as FieldKey[]).filter((k) => String(rec[k] ?? "").trim());
      setBiz((b) => ({ ...b, ...rec }));
      setFromSheet(new Set(keys));
      toast.success(`AI đã điền ${keys.length} ô từ sheet${r.records.length > 1 ? ` (sheet có ${r.records.length} thương hiệu — lấy cái đầu tiên)` : ""}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 10000 });
    } finally {
      setReading(false);
    }
  }

  function downloadTemplate() {
    const csv = `﻿${["Thông tin,Nội dung", ...TEMPLATE_ROWS.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(","))].join("\r\n")}`;
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: "mau-thong-tin-social.csv" });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const refresh = (id = projectId) => {
    if (!id) return;
    getSocialConnections(id).then(setConns).catch(() => {});
    listSocials(id).then((r) => setList(r.items)).catch(() => {});
  };

  /** Mở 1 dự án: nạp thông tin thương hiệu + link sheet + tài khoản gốc + danh sách social của riêng dự án đó. */
  async function openProject(id: string) {
    setProjectId(id);
    setConns(null);
    setList([]);
    setResults(null);
    setPreview(null);
    setFromSheet(new Set());
    setSite(null);
    setFromSite(new Set());
    setBlogs(null);
    setBlogId("");
    setWpSites(null);
    setWpSiteId("");
    setTBlogs(null);
    setTBlog("");
    setInsp(null);
    setTokenFor(null);
    loaded.current = null;
    try {
      localStorage.setItem(PROJECT_KEY, id);
    } catch {}
    if (!id) return;
    try {
      const p = await getProject(id);
      const b = { ...EMPTY, ...p.business } as BusinessInfo;
      setBiz(b);
      setSheetUrl(p.sheetUrl ?? "");
      setSub(b.socialUsername ?? ""); // Tên trang mong muốn lưu riêng từng dự án
      setSubDraft(b.socialUsername ?? "");
      setEditingSub(false);
      loaded.current = { id, name: p.name, selected: p.selected ?? [], snap: JSON.stringify([b, p.sheetUrl ?? "", b.socialUsername ?? ""]) };
      setSaveState("");
      refresh(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  async function addProject() {
    const name = newName.trim();
    if (!name) return;
    setCreatingProject(true);
    try {
      const p = await saveProject({ name, business: { ...EMPTY, brandName: name }, selected: [], sheetUrl: "", credentials: {} });
      setProjects((l) => [{ id: p.id, name: p.name, updatedAt: p.updatedAt, brandName: name }, ...(l ?? [])]);
      setNewName("");
      await openProject(p.id);
      toast.success(`Đã tạo dự án "${p.name}"`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingProject(false);
    }
  }

  async function removeProject() {
    const p = projects?.find((x) => x.id === projectId);
    if (!p) return;
    if (!confirm(`Xoá dự án "${p.name}"?\n\nXoá luôn thông tin thương hiệu, tài khoản gốc đã kết nối và danh sách social của dự án này trong app (dùng chung với tab "Đăng lên trang có sẵn"). Các trang social thật trên nền tảng vẫn còn.`)) return;
    try {
      await deleteProject(p.id);
      const rest = (projects ?? []).filter((x) => x.id !== p.id);
      setProjects(rest);
      await openProject(rest[0]?.id ?? "");
      if (!rest.length) setBiz(EMPTY);
      toast.success(`Đã xoá dự án "${p.name}"`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }
  const usable = (p: SocialPlatform) => !!conns && conns[p].connected && (p !== "wpcom" || conns.wpcom.configured !== false);
  useEffect(() => {
    // Quay về từ trang kết nối WordPress.com
    const q = new URLSearchParams(location.search);
    let want = q.get("project") ?? "";
    try {
      want ||= localStorage.getItem(PROJECT_KEY) ?? "";
    } catch {}
    listProjects()
      .then((ps) => {
        setProjects(ps);
        const id = ps.find((p) => p.id === want)?.id ?? ps[0]?.id ?? "";
        if (id) openProject(id);
      })
      .catch(() => setProjects([]));
    const g = q.get("google");
    if (g === "ok") toast.success("Đã kết nối Blogger");
    else if (g === "sheets-ok") toast.success("Đã kết nối Google Sheets — tạo social xong app tự ghi link trang chủ vào sheet theo dõi");
    else if (g === "loi") toast.error(`Chưa kết nối được Google: ${q.get("msg") ?? ""}`, { duration: 12000 });
    else if (g === "chua-cai") toast.error("Cần cài app Google trước (bấm Cài app Google)");
    if (g) history.replaceState(null, "", location.pathname);
    const tb = q.get("tumblr");
    if (tb === "ok") toast.success("Đã kết nối Tumblr");
    else if (tb === "loi") toast.error(`Chưa kết nối được Tumblr: ${q.get("msg") ?? ""}`, { duration: 12000 });
    if (tb) history.replaceState(null, "", location.pathname);
    const s = q.get("wpcom");
    if (s === "ok") toast.success("Đã kết nối WordPress.com");
    else if (s === "loi") toast.error(`Chưa kết nối được WordPress.com: ${q.get("msg") ?? ""}`);
    else if (s === "chua-cai") toast.error("App chưa được quản trị viên cài kết nối WordPress.com");
    if (s) history.replaceState(null, "", location.pathname);
  }, []);
  // Tự lưu thông tin thương hiệu + link sheet vào dự án (1,5 giây sau lần sửa cuối)
  useEffect(() => {
    const cur = loaded.current;
    if (!cur || cur.id !== projectId) return;
    const snap = JSON.stringify([{ ...biz, socialUsername: sub }, sheetUrl, sub]);
    if (snap === cur.snap) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      try {
        const p = await saveProject({ id: cur.id, name: cur.name, business: { ...biz, socialUsername: sub }, selected: cur.selected, sheetUrl, credentials: {} });
        if (loaded.current?.id === cur.id) loaded.current = { ...cur, snap };
        setProjects((l) => (l ?? []).map((x) => (x.id === p.id ? { ...x, brandName: biz.brandName, updatedAt: p.updatedAt } : x)));
        setSaveState("saved");
      } catch (e) {
        setSaveState("");
        toast.error(`Chưa lưu được vào dự án: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [biz, sheetUrl, sub, projectId]);

  /** Lưu Tên trang mong muốn vào dự án ngay khi bấm Lưu / Xoá. */
  async function saveSub(name: string) {
    const cur = loaded.current;
    if (!cur || cur.id !== projectId) return;
    setSubSaving(true);
    try {
      await saveProject({ id: cur.id, name: cur.name, business: { ...biz, socialUsername: name }, selected: cur.selected, sheetUrl, credentials: {} });
      loaded.current = { ...cur, snap: JSON.stringify([{ ...biz, socialUsername: name }, sheetUrl, name]) };
      setSub(name);
      setSubDraft(name);
      setEditingSub(false);
      toast.success(name ? `Đã lưu tên trang “${name}” cho dự án` : "Đã xoá tên trang của dự án");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSubSaving(false);
    }
  }

  const set = (k: keyof BusinessInfo) => (v: string) => setBiz((b) => ({ ...b, [k]: v }));
  const ready = biz.brandName.trim() && biz.industry.trim() && /^https?:\/\/\S+/.test(biz.targetUrl.trim());

  /** Nền tảng dự án này ĐÃ có social (theo danh sách đã tạo) — tự bỏ chọn, khoá lại để khỏi tạo trùng. */
  const createdOn = new Set(list.map((r) => r.key ?? PLATFORMS.find((p) => p.name === r.platform)?.id).filter(Boolean) as SocialPlatform[]);
  const chosen = picked.filter((p) => usable(p) && !createdOn.has(p));
  /** Địa chỉ trang chủ dự kiến của 1 nền tảng — đúng quy tắc tên trang (không tự thêm số). */
  const expectedHome = (pid: SocialPlatform): { url: string; note?: string } => {
    const auto = biz.brandName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
    const name = sub.trim() || auto || "ten";
    const note = sub.trim() ? undefined : "tự đặt theo tên thương hiệu";
    const login = (conns?.[pid]?.username ?? "").toLowerCase();
    if (pid === "netlify") return { url: `https://${name}.netlify.app/`, note };
    if (pid === "vercel") return { url: `https://${name}.vercel.app/`, note };
    if (pid === "wpcom") return { url: wpSites?.find((x) => x.id === wpSiteId)?.url ?? `https://${name}.wordpress.com/`, note: wpSiteId ? "trang đã chọn" : "tạo trang trống với đúng tên này" };
    if (pid === "github") return { url: `https://${login || "tai-khoan"}.github.io/`, note: "địa chỉ gốc theo tên tài khoản GitHub" };
    if (pid === "codeberg") return { url: `https://${login || "tai-khoan"}.codeberg.page/`, note: "địa chỉ gốc theo tên tài khoản Codeberg" };
    if (pid === "tumblr") return { url: tBlogs?.find((b) => b.id === tBlog)?.url ?? "(chọn blog Tumblr ở trên)", note: "blog đã chọn" };
    if (pid === "mastodon") return { url: conns?.mastodon?.username ?? "(kết nối Mastodon trước)", note: "tài khoản đã kết nối" };
    if (pid === "blogger") return { url: blogs?.find((b) => b.id === blogId)?.url ?? "(chọn blog ở trên)", note: "blog đã chọn" };
    return { url: "https://telegra.ph/…", note: "Telegraph tự đặt theo tiêu đề" };
  };
  useEffect(() => {
    if (chosen.includes("blogger") && blogs === null) loadBlogs();
    if (chosen.includes("wpcom") && wpSites === null) loadWpSites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen.includes("blogger"), chosen.includes("wpcom"), projectId]);
  useEffect(() => {
    if (chosen.includes("tumblr") && tBlogs === null) loadTBlogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen.includes("tumblr"), projectId]);

  // Bấm nhầm vẫn kịp dừng: đếm ngược 5 giây trước khi tạo (Huỷ = chưa tạo gì), đang tạo thì có nút Dừng
  const [countdown, setCountdown] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  function startCreate() {
    setCountdown(5);
    timerRef.current = setInterval(() => {
      setCountdown((n) => {
        if (n === null) return null;
        if (n <= 1) {
          clearInterval(timerRef.current!);
          timerRef.current = null;
          void create();
          return null;
        }
        return n - 1;
      });
    }, 1000);
  }
  function cancelCountdown() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setCountdown(null);
    toast.message("Đã huỷ — chưa tạo gì cả");
  }
  function stopCreate() {
    abortRef.current?.abort();
  }
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); abortRef.current?.abort(); }, []);

  // Thử lại đúng 1 nền tảng bị lỗi (agent đã chỉ cách sửa) — không đụng các nền tảng đã tạo xong
  async function retryOne(p: SocialPlatform) {
    setRetrying(p);
    try {
      const r = await createSocial(projectId, biz, [p], sub.trim() || undefined, { useAI, site, bloggerBlogId: blogId, tumblrBlog: tBlog, wpcomSiteId: wpSiteId, wpcomClean: false });
      const one = r.results[0];
      if (!one) return;
      setResults((cur) => (cur ?? []).map((x) => (x.platform === p ? one : x)));
      if (one.ok && one.social) { setList((l) => [one.social!, ...l]); toast.success(`Đã tạo xong ${one.name}`); }
      else toast.error(`${one.name} vẫn lỗi — xem hướng dẫn bên dưới`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(null);
    }
  }
  const updateRec = (s: SocialRecord) => {
    setList((l) => l.map((x) => (x.id === s.id ? s : x)));
    setResults((cur) => cur?.map((x) => (x.social?.id === s.id ? { ...x, social: s } : x)) ?? cur);
  };

  async function create() {
    setBusy(true);
    setResults(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await createSocial(projectId, biz, chosen, sub.trim() || undefined, { useAI, site, bloggerBlogId: blogId, tumblrBlog: tBlog, wpcomSiteId: wpSiteId, wpcomClean: wpClean, signal: ac.signal });
      if (r.note) toast.message(r.note, { duration: 10000 });
      if (r.sheet) {
        if (r.sheet.ok) toast.success(sheetMsg(r.sheet.ket_qua ?? []), { duration: 10000 });
        else toast.error(`Chưa ghi được vào sheet: ${r.sheet.error}`, { duration: 15000 });
      }
      setResults(r.results);
      const ok = r.results.filter((x) => x.ok && x.social).map((x) => x.social!);
      setList((l) => [...ok, ...l]);
      const bad = r.results.filter((x) => !x.ok).length;
      if (ok.length) toast.success(`Đã tạo ${ok.length} trang social${bad ? ` · ${bad} nền tảng lỗi` : ""}`);
      else toast.error("Chưa tạo được trang nào — xem lý do bên dưới");
    } catch (e) {
      if (ac.signal.aborted) {
        toast.message("Đã dừng. Nền tảng nào đã tạo xong trước khi dừng thì trang vẫn còn trên nền tảng đó (có thể chưa hiện trong danh sách).", { duration: 12000 });
        refresh();
      } else toast.error(e instanceof Error ? e.message : String(e), { duration: 10000 });
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  // Xoá hẳn trên nền tảng (không lấy lại được): hỏi xác nhận, làm lần lượt, cái nào lỗi thì giữ lại trong danh sách
  const [removing, setRemoving] = useState<string | null>(null);
  async function removeHard(items: SocialRecord[]) {
    if (!items.length) return;
    const names = items.map((s) => `• ${s.platform}: ${s.siteUrl}`).join("\n");
    if (!confirm(`XOÁ HẲN ${items.length} trang social trên nền tảng?\n\n${names}\n\nKhông lấy lại được: link sẽ thành 404, mọi nội dung bị xoá. Blogger và Telegraph không cho xoá hẳn — app gỡ sạch nội dung.`)) return;
    setRemoving(items.length > 1 ? "all" : items[0]!.id);
    let ok = 0;
    for (const s of items) {
      if (items.length > 1) setRemoving("all");
      try {
        const r = await deleteSocialRecord(projectId, s.id, true);
        ok++;
        setList((l) => l.filter((x) => x.id !== s.id));
        if (r.note) toast.message(`${s.platform}: ${r.note}`, { duration: 15000 });
      } catch (e) {
        toast.error(`${s.platform}: ${e instanceof Error ? e.message : String(e)}`, { duration: 15000 });
      }
    }
    setRemoving(null);
    if (ok) toast.success(`Đã xoá ${ok}/${items.length} trang trên nền tảng`);
  }

  // Sheet theo dõi social của dự án: tạo xong app tự ghi link trang chủ vào đúng dòng nền tảng
  const [trackUrl, setTrackUrl] = useState("");
  const [trackBusy, setTrackBusy] = useState(false);
  const [insp, setInsp] = useState<SheetInspect | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false); // đã lưu cách điền thì thu gọn, bấm "Sửa cách điền" mới mở
  const [trackCols, setTrackCols] = useState<TrackCols>({ platform: "", link: "", date: "", account: "" });
  async function readTrack(gid?: string, row?: number) {
    setTrackBusy(true);
    try {
      const r = await inspectTrackSheet(projectId, gid, row);
      setInsp(r);
      setTrackCols(r.cols);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 15000 });
    } finally {
      setTrackBusy(false);
    }
  }
  // Đã có link sheet + đã kết nối Google Sheets → tự đọc sheet, hiện luôn bảng chọn cột (không phải tìm nút)
  const autoRead = useRef("");
  useEffect(() => {
    const key = `${projectId}|${conns?.sheets?.trackSheet ?? ""}`;
    if (conns?.sheets?.connected && conns.sheets.trackSheet && autoRead.current !== key) {
      autoRead.current = key;
      void readTrack();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, conns?.sheets?.connected, conns?.sheets?.trackSheet]);
  async function saveMap() {
    if (!insp) return;
    if (!trackCols.link) return toast.error("Hãy chọn cột để điền link trang chủ");
    setTrackBusy(true);
    try {
      await saveTrackSheet(projectId, conns?.sheets?.trackSheet ?? trackUrl.trim(), { gid: insp.tab.gid, headerRow: insp.headerRow, cols: trackCols });
      toast.success("Đã lưu cách điền — tạo social xong app tự điền đúng các cột này");
      setInsp({ ...insp, saved: true, cols: trackCols });
      setPickerOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 10000 });
    } finally {
      setTrackBusy(false);
    }
  }
  useEffect(() => setTrackUrl(conns?.sheets?.trackSheet ?? ""), [conns?.sheets?.trackSheet]);
  const sheetMsg = (k: SheetWriteResult[]) =>
    `Đã ghi ${k.length} link trang chủ vào sheet: ${k.map((x) => `${x.platform} → ô ${x.cell}${x.action === "them" ? " (dòng mới)" : ""}`).join(", ")}`;
  async function saveTrack(url: string) {
    setTrackBusy(true);
    try {
      await saveTrackSheet(projectId, url);
      toast.success(url ? "Đã lưu sheet theo dõi cho dự án" : "Đã bỏ sheet theo dõi");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 10000 });
    } finally {
      setTrackBusy(false);
    }
  }
  async function writeSheetNow() {
    setTrackBusy(true);
    try {
      const r = await writeLinksToSheet(projectId);
      toast.success(sheetMsg(r.ket_qua), { duration: 12000 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 15000 });
    } finally {
      setTrackBusy(false);
    }
  }

  async function saveToken() {
    if (!tokenFor || tokenFor === "wpcom" || tokenFor === "telegraph" || tokenFor === "blogger" || tokenFor === "tumblr") return;
    if (tokenFor === "mastodon" && !mastoHost.trim()) return toast.error("Nhập máy chủ Mastodon (vd mastodon.social)");
    setSaving(true);
    try {
      const r = await saveSocialConnection(projectId, tokenFor, tokenFor === "mastodon" ? `${mastoHost.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "")}|${token.trim()}` : token);
      toast.success(`Đã kết nối ${PLATFORMS.find((p) => p.id === tokenFor)?.name}: ${r.username}`);
      setPicked((x) => [...new Set([...x, tokenFor])]);
      setTokenFor(null);
      setToken("");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: 10000 });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6">
      <ProjectBar
        projects={projects}
        projectId={projectId}
        onOpen={openProject}
        onDelete={removeProject}
        newName={newName}
        setNewName={setNewName}
        onAdd={addProject}
        adding={creatingProject}
        saveState={saveState}
      />
      {projectId ? (
      <>
      {/* Tài khoản gốc */}
      <Card>
        <CardHeader>
          <CardTitle>1. Các nền tảng social &amp; tài khoản gốc</CardTitle>
          <CardDescription>Không nền tảng nào cho phần mềm tự đăng ký tài khoản, nên cần sẵn 1 tài khoản gốc (nên dùng tài khoản phụ). Từ tài khoản đó app tự tạo được nhiều trang social mới.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <SectionHead tone="green" title="Tạo được ngay" count={PLATFORMS.length} chip="Tự động 100%" desc="Kết nối tài khoản gốc 1 lần — app tự tạo site đủ 4 trang, mở sẵn cho Google index." />
          {PLATFORMS.map((p) => {
            const c = conns?.[p.id];
            return (
              <div key={p.id} className="grid gap-3 rounded-xl border p-4">
                {(() => {
                  // Bước 1 (chỉ WordPress.com, Blogger): cài app — dùng chung mọi dự án. Bước 2: kết nối tài khoản — riêng dự án đang mở.
                  const appOf = p.id === "wpcom" ? conns?.wpcom : p.id === "blogger" ? conns?.blogger : p.id === "tumblr" ? conns?.tumblr : undefined;
                  const needsApp = p.id === "wpcom" || p.id === "blogger" || p.id === "tumblr";
                  const hasApp = !!appOf?.configured;
                  const appName = p.id === "wpcom" ? "WordPress.com" : p.id === "tumblr" ? "Tumblr" : "Google";
                  const projName = projects?.find((x) => x.id === projectId)?.name ?? "đang mở";
                  const ready = p.how === "none" || !!c?.connected;
                  const Row = ({ step, title, sub, children }: { step: string; title: string; sub: string; children: React.ReactNode }) => (
                    <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2.5">
                      <div className="grid gap-0.5">
                        <p className="text-sm font-semibold"><span className="text-primary">{step}</span> · {title}</p>
                        <p className="text-muted-foreground text-xs">{sub}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">{children}</div>
                    </div>
                  );
                  return (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="grid gap-0.5">
                          <p className="font-semibold">{p.name}</p>
                          <p className="text-muted-foreground text-xs">
                            Trang tạo ra: <code>{p.domain}</code>
                            {p.note ? ` · ${p.note}` : ""}
                          </p>
                        </div>
                        {!conns ? (
                          <Loader2 className="text-muted-foreground animate-spin" />
                        ) : ready ? (
                          <Badge variant="success"><CheckCircle2 className="size-3" /> Sẵn sàng tạo</Badge>
                        ) : (
                          <Badge variant="secondary">Chưa sẵn sàng</Badge>
                        )}
                      </div>
                      {conns && p.how === "none" ? <p className="text-muted-foreground text-xs">Không cần tài khoản — app tự tạo tài khoản Telegraph cho dự án.</p> : null}
                      {conns && needsApp ? (
                        <Row step="Bước 1" title={`Cài app ${appName}`} sub="Làm 1 lần, dùng chung cho mọi dự án">
                          {hasApp ? (
                            <>
                              <Badge variant="success"><CheckCircle2 className="size-3" /> Đã cài</Badge>
                              <button type="button" className="text-primary text-xs font-semibold hover:underline" onClick={() => setTokenFor(tokenFor === p.id ? null : p.id)}>Thay Client ID / Secret</button>
                              <button
                                type="button"
                                className="text-xs font-semibold text-red-600 hover:underline"
                                onClick={async () => {
                                  if (!confirm(`Xoá app ${appName} đã cài? Phải cài lại mới kết nối được. Các trang đã tạo vẫn giữ nguyên.`)) return;
                                  await (p.id === "wpcom" ? deleteWpcomApp() : p.id === "tumblr" ? deleteTumblrApp() : deleteGoogleApp());
                                  refresh();
                                }}
                              >
                                Xoá app
                              </button>
                            </>
                          ) : (
                            <Button size="sm" variant={tokenFor === p.id ? "secondary" : "default"} onClick={() => setTokenFor(tokenFor === p.id ? null : p.id)}>
                              <Link2 /> Cài app {appName}
                            </Button>
                          )}
                        </Row>
                      ) : null}
                      {conns && p.how !== "none" ? (
                        <Row step={needsApp ? "Bước 2" : "Bước 1"} title={`Kết nối tài khoản cho dự án «${projName}»`} sub="Mỗi dự án kết nối tài khoản riêng">
                          {c?.connected ? (
                            <>
                              <Badge variant="success"><CheckCircle2 className="size-3" /> Đã kết nối{c.username ? `: ${c.username}` : ""}</Badge>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={async () => {
                                  if (!confirm(`Ngắt kết nối ${p.name} khỏi dự án «${projName}»? Các trang đã tạo vẫn giữ nguyên.`)) return;
                                  await deleteSocialConnection(projectId, p.id);
                                  setPicked((x) => x.filter((y) => y !== p.id));
                                  refresh();
                                }}
                              >
                                <Unplug /> Ngắt
                              </Button>
                            </>
                          ) : needsApp && !hasApp ? (
                            <span className="text-muted-foreground text-xs">Làm Bước 1 trước</span>
                          ) : p.how === "google" || p.how === "oauth" || p.how === "tumblr" ? (
                            <Button size="sm" asChild>
                              <a href={`${p.how === "google" ? "/api/google/connect" : p.how === "tumblr" ? "/api/tumblr/connect" : "/api/wpcom/connect"}?project=${projectId}`}>
                                <Link2 /> Kết nối tài khoản
                              </a>
                            </Button>
                          ) : (
                            <Button size="sm" variant={tokenFor === p.id ? "secondary" : "default"} onClick={() => (setTokenFor(tokenFor === p.id ? null : p.id), setToken(""))}>
                              <Link2 /> Kết nối tài khoản
                            </Button>
                          )}
                        </Row>
                      ) : null}
                    </>
                  );
                })()}
                {p.id === "wpcom" && conns && tokenFor === "wpcom" ? (
                  <WpcomAppSetup
                    redirectUri={conns.wpcom.redirectUri ?? ""}
                    hasApp={!!conns.wpcom.ownApp}
                    connected={!!conns.wpcom.connected}
                    open
                    onToggle={() => setTokenFor(null)}
                    onSaved={() => (setTokenFor(null), refresh())}
                  />
                ) : null}
                {p.id === "tumblr" && conns && tokenFor === "tumblr" ? (
                  <TumblrAppSetup redirectUri={conns.tumblr?.redirectUri ?? ""} onClose={() => setTokenFor(null)} onSaved={() => (setTokenFor(null), refresh())} />
                ) : null}
                {p.id === "blogger" && conns && tokenFor === "blogger" ? (
                  <GoogleAppSetup
                    redirectUri={conns.blogger?.redirectUri ?? ""}
                    hasApp={!!conns.blogger?.ownApp}
                    connected={!!conns.blogger?.connected}
                    open
                    onToggle={() => setTokenFor(null)}
                    onSaved={() => (setTokenFor(null), refresh())}
                  />
                ) : null}
                {tokenFor === p.id && p.how === "token" ? (
                  <div className="bg-muted/50 grid gap-2 rounded-lg p-3">
                    {(() => {
                      // Nút mở thẳng trang tạo mã / đăng ký tài khoản — bấm là tới đúng chỗ, không phải tự tìm
                      const host = (mastoHost.trim() || "mastodon.social").replace(/^https?:\/\//, "").replace(/\/+$/, "");
                      const tokenUrl = p.id === "mastodon" ? `https://${host}/settings/applications/new` : p.tokenUrl;
                      const signup: Record<string, string> = {
                        netlify: "https://app.netlify.com/signup",
                        vercel: "https://vercel.com/signup",
                        github: "https://github.com/signup",
                        codeberg: "https://codeberg.org/user/sign_up",
                        mastodon: `https://${host}/auth/sign_up`,
                      };
                      return (
                        <div className="grid gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Button size="sm" asChild>
                              <a href={tokenUrl} target="_blank" rel="noreferrer">
                                1. Mở trang tạo mã {p.name} <ExternalLink className="size-3.5" />
                              </a>
                            </Button>
                            {signup[p.id] ? (
                              <a href={signup[p.id]} target="_blank" rel="noreferrer" className="text-primary text-xs font-semibold hover:underline">
                                Chưa có tài khoản? Đăng ký {p.name} ↗
                              </a>
                            ) : null}
                          </div>
                          <p className="text-sm"><b>2. Trên trang đó:</b> {p.tokenSteps}</p>
                          <p className="text-sm"><b>3.</b> Dán mã vào ô dưới rồi bấm Lưu &amp; kiểm tra. Mã được mã hoá khi lưu, chỉ bạn dùng.</p>
                        </div>
                      );
                    })()}
                    <div className="flex flex-wrap gap-2">
                      {p.id === "mastodon" ? <Input value={mastoHost} onChange={(e) => setMastoHost(e.target.value)} placeholder="Máy chủ, vd mastodon.social" className="w-56" /> : null}
                      <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={`Dán mã truy cập ${p.name}`} autoComplete="off" />
                      <Button disabled={token.trim().length < 10 || saving} onClick={saveToken}>
                        {saving ? <Loader2 className="animate-spin" /> : null} Lưu & kiểm tra
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
          <UpcomingList biz={biz} />
        </CardContent>
      </Card>

      {/* Thông tin thương hiệu */}
      <Card>
        <CardHeader>
          <CardTitle>2. Thông tin thương hiệu</CardTitle>
          <CardDescription>Dán link Google Sheet thông tin đầu vào → AI tự điền các ô bên dưới. Hoặc tự nhập tay. AI chỉ dùng đúng thông tin này, không bịa.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          {/* Đọc từ Google Sheet */}
          <div className="border-primary/30 bg-primary/5 grid gap-2 rounded-xl border p-4">
            <Label htmlFor="sc-sheet" className="text-primary">
              Link Google Sheet thông tin đầu vào
            </Label>
            <div className="flex flex-wrap gap-2">
              <Input id="sc-sheet" className="min-w-64 flex-1" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />
              <Button disabled={!/docs\.google\.com\/spreadsheets/.test(sheetUrl) || reading} onClick={readFromSheet}>
                {reading ? <Loader2 className="animate-spin" /> : <Sparkles />} {reading ? "AI đang đọc sheet…" : "Đọc sheet & tự điền"}
              </Button>
              <Button variant="outline" onClick={downloadTemplate} title="Tải file mẫu đúng các mục cần điền">
                Tải sheet mẫu
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Sheet cần chia sẻ "Bất kỳ ai có đường liên kết — Người xem". Ảnh (avatar, cover, logo, scan ĐKKD) dán link Google Drive / link ảnh. App KHÔNG đọc mật khẩu, tên đăng nhập trong sheet.
            </p>
            {fromSheet.size ? <p className="text-xs font-semibold text-green-700">✓ Đã điền {fromSheet.size} ô từ sheet (ô có nhãn "từ sheet"). Kiểm tra lại rồi sửa nếu cần.</p> : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {FORM.map((g) => (
              <div key={g.title} className="grid gap-4 md:col-span-2 md:grid-cols-2">
                <p className="text-muted-foreground border-b pb-1 text-xs font-bold tracking-wide uppercase md:col-span-2">{g.title}</p>
                {g.fields.map((fd) => (
                  <div key={fd.k} className={fd.wide ? "md:col-span-2" : ""}>
                    <F
                      id={`sc-${fd.k}`}
                      label={`${fd.label}${fromSheet.has(fd.k) ? " · từ sheet" : fromSite.has(fd.k) ? " · từ website" : ""}`}
                      area={fd.area}
                      value={String(biz[fd.k] ?? "")}
                      onChange={set(fd.k)}
                      placeholder={fd.ph}
                      hint={fd.hint}
                    />
                    {fd.k === "targetUrl" ? (
                      <div className="mt-2 grid gap-2">
                        <Button type="button" variant="outline" size="sm" className="w-fit" disabled={scraping || !/^https?:\/\/\S+/.test(biz.targetUrl.trim())} onClick={readFromSite}>
                          {scraping ? <Loader2 className="animate-spin" /> : <Globe />} {scraping ? "Đang đọc website…" : "Lấy logo, ảnh, thông tin từ website"}
                        </Button>
                        {site ? <SiteFound site={site} onClear={() => { setSite(null); setFromSite(new Set()); }} /> : null}
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <Label htmlFor="sc-color">Màu thương hiệu{fromSite.has("brandColor") ? " · từ website" : ""}</Label>
                          <input id="sc-color" type="color" value={biz.brandColor || "#0d53f0"} onChange={(e) => set("brandColor")(e.target.value)} className="border-input h-8 w-10 cursor-pointer rounded border bg-transparent p-0.5" />
                          <Input aria-label="Mã màu" value={biz.brandColor} onChange={(e) => set("brandColor")(e.target.value)} className="h-8 w-28 font-mono uppercase" maxLength={7} />
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tạo */}
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle>3. Tạo social</CardTitle>
          <CardDescription>Mẫu chuẩn: Trang chủ (trang đầu) · Giới thiệu · Danh mục sản phẩm · Blog (trang danh sách bài, để trống) + menu.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <p className="text-sm font-semibold">Tạo trên những nền tảng nào?</p>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => {
                const done = createdOn.has(p.id);
                const ok = usable(p.id) && !done;
                const on = picked.includes(p.id) && ok;
                return (
                  <label
                    key={p.id}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${on ? "border-primary bg-primary/5 font-semibold" : ""} ${done ? "cursor-not-allowed border-green-300 bg-green-50 text-green-800" : ok ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
                    title={done ? "Dự án đã có social trên nền tảng này — muốn tạo lại thì Xoá hẳn social cũ trong danh sách bên dưới" : ok ? "" : "Kết nối ở bước 1 trước"}
                  >
                    <input type="checkbox" disabled={!ok} checked={on} onChange={(e) => setPicked((x) => (e.target.checked ? [...x, p.id] : x.filter((y) => y !== p.id)))} />
                    {p.name}
                    {done ? <span className="text-xs font-semibold">✓ Đã tạo</span> : null}
                  </label>
                );
              })}
            </div>
            {createdOn.size ? <p className="text-muted-foreground text-xs">Nền tảng có “✓ Đã tạo” là dự án này đã có social ở đó nên không chọn được nữa (tránh trùng lặp). Muốn tạo lại: bấm “Xoá hẳn” ở social đó trong danh sách bên dưới.</p> : null}
          </div>
          <div className="bg-muted/40 grid gap-2 rounded-lg p-3">
            <p className="text-sm font-semibold">Ghi link vào sheet theo dõi social</p>
            <p className="text-muted-foreground text-xs">Tạo xong, app tự điền <b>link trang chủ</b> vào đúng dòng nền tảng (cột “Loại social” / “Nền tảng”) ở cột “Domain” / “Link”; chưa có dòng thì thêm dòng mới.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input id="sc-track" value={trackUrl} onChange={(e) => setTrackUrl(e.target.value)} placeholder="Link Google Sheet theo dõi social của dự án" className="min-w-64 flex-1" />
              <Button type="button" size="sm" variant="outline" disabled={trackBusy || trackUrl.trim() === (conns?.sheets?.trackSheet ?? "")} onClick={() => saveTrack(trackUrl.trim())}>Lưu</Button>
              {conns?.sheets?.trackSheet ? (
                <Button type="button" size="sm" variant="ghost" className="text-red-600" disabled={trackBusy} onClick={() => { if (confirm("Bỏ sheet theo dõi của dự án này? (Sheet không bị xoá)")) void saveTrack(""); }}>Xoá</Button>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {conns?.sheets?.connected ? (
                <>
                  <Badge variant="success"><CheckCircle2 className="size-3" /> Google Sheets: {conns.sheets.username}</Badge>
                  <button type="button" className="text-muted-foreground font-semibold hover:underline" onClick={async () => { if (!confirm("Ngắt kết nối Google Sheets? App sẽ không tự ghi vào sheet nữa.")) return; await disconnectSheets(); refresh(); }}>Ngắt</button>
                </>
              ) : conns?.blogger?.configured ? (
                <Button size="sm" asChild>
                  <a href={`/api/google/sheets/connect?project=${projectId}`}><Link2 /> Kết nối Google Sheets (Gmail có quyền sửa sheet)</a>
                </Button>
              ) : (
                <span className="text-muted-foreground">Cần cài app Google trước (thẻ Blogger → Bước 1), rồi kết nối Google Sheets.</span>
              )}
              {conns?.sheets?.connected && conns.sheets.trackSheet ? (
                <Button type="button" size="sm" variant="outline" disabled={trackBusy} onClick={() => { setPickerOpen(true); void readTrack(); }}>
                  {trackBusy ? <Loader2 className="animate-spin" /> : null} Đọc sheet &amp; chọn cột điền
                </Button>
              ) : null}
            </div>
            {insp && insp.saved && !pickerOpen ? (
              <div className="bg-background flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
                <Badge variant="success"><CheckCircle2 className="size-3" /> Đã lưu cách điền</Badge>
                <span className="text-muted-foreground">
                  Tab “{insp.tab.title}” · dòng tiêu đề {insp.headerRow} ·{" "}
                  {([["platform", "Nền tảng"], ["link", "Link"], ["date", "Ngày tạo"], ["account", "Tài khoản"]] as [keyof TrackCols, string][])
                    .filter(([k]) => insp.cols[k])
                    .map(([k, l]) => `${l}: cột ${insp.cols[k]}`)
                    .join(" · ")}
                </span>
                <Button type="button" size="sm" variant="outline" onClick={() => setPickerOpen(true)}>Sửa cách điền</Button>
              </div>
            ) : insp ? (
              <div className="bg-background grid gap-3 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-2">
                    Tab
                    <select value={insp.tab.gid} onChange={(e) => readTrack(e.target.value)} className="border-input bg-background h-8 rounded-md border px-2">
                      {insp.tabs.map((t) => <option key={t.gid} value={t.gid}>{t.title}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-2">
                    Dòng tiêu đề số
                    <Input type="number" min={1} max={50} defaultValue={insp.headerRow} key={`${insp.tab.gid}-${insp.headerRow}`} className="h-8 w-20" onBlur={(e) => { const n = Number(e.target.value); if (n && n !== insp.headerRow) void readTrack(insp.tab.gid, n); }} />
                  </label>
                  {insp.saved ? <Badge variant="success"><CheckCircle2 className="size-3" /> Đã lưu cách điền</Badge> : <Badge variant="secondary">Chưa lưu</Badge>}
                </div>
                {([
                  ["platform", "Cột nhận diện nền tảng (để tìm đúng dòng)", "VD cột “Loại social”. Không chọn thì luôn thêm dòng mới."],
                  ["link", "Điền link trang chủ vào cột *", "VD cột “Domain” hoặc “Link”."],
                  ["date", "Điền ngày tạo vào cột", "Không bắt buộc."],
                  ["account", "Điền tài khoản đã dùng để tạo vào cột", "Không bắt buộc — tên tài khoản/Gmail đã kết nối."],
                ] as [keyof TrackCols, string, string][]).map(([k, label, hint]) => (
                  <div key={k} className="grid gap-1 md:grid-cols-[260px_1fr] md:items-center">
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-muted-foreground text-xs">{hint}</p>
                    </div>
                    <select value={trackCols[k]} onChange={(e) => setTrackCols((x) => ({ ...x, [k]: e.target.value }))} className="border-input bg-background h-9 rounded-md border px-2 text-sm">
                      <option value="">— Không điền —</option>
                      {insp.columns.map((c) => (
                        <option key={c.col} value={c.col}>
                          Cột {c.col}{c.text ? ` · ${c.text}` : " · (trống)"}{c.sample ? ` — vd: ${c.sample}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" disabled={trackBusy || !trackCols.link} onClick={saveMap}>Lưu cách điền</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => (insp.saved ? setPickerOpen(false) : setInsp(null))}>{insp.saved ? "Thu gọn" : "Đóng"}</Button>
                </div>
              </div>
            ) : null}
          </div>
          {chosen.includes("tumblr") ? (
            <div className="bg-muted/40 grid gap-2 rounded-lg p-3">
              <p className="text-sm font-semibold">Tumblr: chọn blog để dựng social</p>
              <p className="text-muted-foreground text-xs">
                Tumblr không cho phần mềm tạo blog mới. Bấm{" "}
                <a href="https://www.tumblr.com/new/blog" target="_blank" rel="noreferrer" className="text-primary font-semibold underline">tạo blog <ExternalLink className="inline size-3" /></a>{" "}
                với tên blog = Tên trang mong muốn, rồi bấm Tải lại và chọn blog đó. Tên, mô tả, ảnh đại diện của blog anh/chị tự điền trong Tumblr (Tumblr không cho phần mềm sửa) — dùng đúng Tên, Bio, Logo ở bước 2.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <select id="sc-tblog" value={tBlog} onChange={(e) => setTBlog(e.target.value)} className="border-input bg-background h-9 min-w-64 rounded-md border px-3 text-sm">
                  {!tBlogs ? <option value="">Bấm Tải lại để xem blog…</option> : tBlogs.length ? null : <option value="">Chưa có blog nào — tạo blog trước</option>}
                  {(tBlogs ?? []).map((b) => <option key={b.id} value={b.id}>{b.name} · {b.url.replace(/^https?:\/\//, "")}{b.posts ? ` (đã có ${b.posts} bài)` : " (trống)"}</option>)}
                </select>
                <Button type="button" variant="outline" size="sm" onClick={loadTBlogs}>Tải lại</Button>
              </div>
            </div>
          ) : null}
          {chosen.includes("wpcom") ? (
            <div className="bg-muted/40 grid gap-2 rounded-lg p-3">
              <p className="text-sm font-semibold">WordPress.com: chọn trang để dựng social</p>
              <p className="text-muted-foreground text-xs">
                WordPress.com không cho phần mềm bên ngoài tạo trang mới. Bấm{" "}
                <a href="https://wordpress.com/start" target="_blank" rel="noreferrer" className="text-primary font-semibold underline">tạo trang trống <ExternalLink className="inline size-3" /></a>{" "}
                (gói Miễn phí, địa chỉ <b>{sub || "ten"}.wordpress.com</b> đúng Tên trang mong muốn, bỏ qua các bước chọn mẫu — khoảng 1 phút), rồi bấm Tải lại và chọn trang đó. App tự dựng Trang chủ, Giới thiệu, Danh mục sản phẩm, Blog, menu và mở cho Google index.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <select id="sc-wpsite" value={wpSiteId} onChange={(e) => setWpSiteId(e.target.value)} className="border-input bg-background h-9 min-w-64 rounded-md border px-3 text-sm">
                  {!wpSites ? <option value="">Bấm Tải lại để xem trang…</option> : wpSites.length ? null : <option value="">Chưa có trang nào — tạo trang trống trước</option>}
                  {(wpSites ?? []).map((x) => <option key={x.id} value={x.id} disabled={x.deleted}>{x.name || x.url} · {x.url.replace(/^https?:\/\//, "")}{x.deleted ? " (đã bị xoá — không dùng được)" : ""}</option>)}
                </select>
                <Button type="button" variant="outline" size="sm" onClick={loadWpSites}>Tải lại</Button>
              </div>
              <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">⏱ Để tránh bị WordPress khoá vì nghi spam: app dựng <b>Trang chủ ngay</b>, 3 trang còn lại tự dựng dần, cách nhau khoảng 4 phút — <b>đủ 4 trang sau khoảng 15 phút</b>. Không cần mở app chờ.</p>
              <label className="flex w-fit cursor-pointer items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={wpClean} onChange={(e) => setWpClean(e.target.checked)} />
                <span>
                  <b>Xoá sạch nội dung cũ trên trang trước khi dựng</b>
                  <span className="text-muted-foreground block text-xs">Giữ nguyên địa chỉ trang, nhưng xoá hết trang và bài cũ (vd bản test trước) rồi dựng 4 trang mới — không để nội dung cũ trùng lặp. Chỉ tích khi thật cần: xoá + dựng lại hàng loạt dễ bị WordPress coi là spam và khoá trang.</span>
                </span>
              </label>
              {wpSites?.some((x) => x.deleted) ? (
                <p className="text-xs text-amber-700">Trang ghi “đã bị xoá” là trang anh/chị đã xoá trên WordPress.com — WordPress vẫn liệt kê để cho khôi phục nhưng không dùng được. Địa chỉ của trang đã xoá cũng không đặt lại được cho trang mới.</p>
              ) : null}
              {sub && wpSiteId && !wpSites?.find((x) => x.id === wpSiteId)?.url.includes(`//${sub}.`) ? (
                <p className="text-xs text-amber-700">Trang đã chọn không trùng Tên trang mong muốn “{sub}” — kiểm tra lại cho đúng quy tắc tên trang.</p>
              ) : null}
            </div>
          ) : null}
          {chosen.includes("blogger") ? (
            <div className="bg-muted/40 grid gap-2 rounded-lg p-3">
              <p className="text-sm font-semibold">Blogger: chọn blog để dựng social</p>
              <p className="text-muted-foreground text-xs">
                Google không cho phần mềm tạo blog mới. Bấm{" "}
                <a href="https://www.blogger.com/onboarding" target="_blank" rel="noreferrer" className="text-primary font-semibold underline">tạo blog trống <ExternalLink className="inline size-3" /></a>{" "}
                (đặt tên + địa chỉ, khoảng 1 phút), rồi bấm Tải lại và chọn blog đó. App tự dựng Trang chủ, Giới thiệu, Danh mục sản phẩm; blog là trang Blog.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <select id="sc-blog" value={blogId} onChange={(e) => setBlogId(e.target.value)} className="border-input bg-background h-9 min-w-64 rounded-md border px-3 text-sm">
                  {!blogs ? <option value="">Bấm Tải lại để xem blog…</option> : blogs.length ? null : <option value="">Chưa có blog nào — tạo blog trống trước</option>}
                  {(blogs ?? []).map((b) => <option key={b.id} value={b.id}>{b.name} · {b.url.replace(/^https?:\/\//, "")}{b.pages ? ` (đã có ${b.pages} trang)` : " (trống)"}</option>)}
                </select>
                <Button type="button" variant="outline" size="sm" onClick={loadBlogs}>Tải lại</Button>
              </div>
            </div>
          ) : null}
          <div className="grid max-w-md gap-1.5">
            <Label htmlFor="sc-sub">Tên trang mong muốn (không bắt buộc) — lưu riêng cho dự án này</Label>
            {sub && !editingSub ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="success"><CheckCircle2 className="size-3" /> Tên đã lưu: {sub}</Badge>
                <Button type="button" size="sm" variant="outline" onClick={() => { setSubDraft(sub); setEditingSub(true); }}>Sửa</Button>
                <Button type="button" size="sm" variant="ghost" className="text-red-600" disabled={subSaving} onClick={() => { if (confirm(`Xoá tên trang “${sub}” của dự án? Để trống thì app tự đặt tên theo thương hiệu.`)) void saveSub(""); }}>Xoá</Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Input id="sc-sub" value={subDraft} onChange={(e) => setSubDraft(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))} onKeyDown={(e) => { if (e.key === "Enter" && subDraft.trim()) void saveSub(subDraft.trim()); }} placeholder="seongonseo" className="w-64" />
                <Button type="button" size="sm" disabled={!subDraft.trim() || subDraft.trim() === sub || subSaving} onClick={() => saveSub(subDraft.trim())}>
                  {subSaving ? <Loader2 className="animate-spin" /> : null} Lưu
                </Button>
                {editingSub ? <Button type="button" size="sm" variant="ghost" onClick={() => { setSubDraft(sub); setEditingSub(false); }}>Huỷ</Button> : null}
              </div>
            )}
            {editingSub || !sub ? <p className="text-amber-700 text-xs">{subDraft.trim() && subDraft.trim() !== sub ? "Chưa lưu — bấm Lưu để giữ tên này cho dự án." : ""}</p> : null}
            <p className="text-muted-foreground text-xs">Dùng <b>đúng y tên này</b> làm địa chỉ trên mọi nền tảng (vd seongonseo.netlify.app, seongonseo.vercel.app, seongonseo.wordpress.com). Chỉ chữ thường không dấu và số. Tên đã có người dùng trên nền tảng nào thì nền tảng đó báo lỗi — app không tự đổi tên. Ngoại lệ: GitHub và Codeberg dùng địa chỉ gốc theo tên tài khoản (tai-khoan.github.io); Telegraph tự đặt địa chỉ theo tiêu đề.</p>
          </div>
          <label className="flex w-fit cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={useAI} onChange={(e) => setUseAI(e.target.checked)} />
            <span>
              <b>Nhờ AI viết lại nội dung cho hay hơn</b> (tốn lượt AI)
              <span className="text-muted-foreground block text-xs">Để tắt: app tự soạn 4 trang từ thông tin + website, không dùng AI. App chỉ tự gọi AI khi thông tin quá ít (chưa có giới thiệu hoặc sản phẩm).</span>
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              size="lg"
              variant="outline"
              disabled={!ready || previewing || busy}
              onClick={async () => {
                setPreviewing(true);
                try {
                  setPreview(await previewSocial(biz, { useAI, site }));
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : String(e), { duration: 10000 });
                } finally {
                  setPreviewing(false);
                }
              }}
            >
              {previewing ? <Loader2 className="animate-spin" /> : null} {previewing ? "Đang soạn…" : "Xem trước nội dung 4 trang"}
            </Button>
            {countdown !== null ? (
              <Button size="lg" variant="destructive" onClick={cancelCountdown}>
                Huỷ — tự tạo sau {countdown} giây
              </Button>
            ) : busy ? (
              <>
                <Button size="lg" disabled>
                  <Loader2 className="animate-spin" /> Đang tạo (khoảng 30–90 giây)…
                </Button>
                <Button size="lg" variant="destructive" onClick={stopCreate}>
                  Dừng
                </Button>
              </>
            ) : (
              <Button size="lg" disabled={!ready || !chosen.length || (chosen.includes("blogger") && !blogId) || (chosen.includes("tumblr") && !tBlog) || (chosen.includes("wpcom") && !wpSiteId)} onClick={startCreate}>
                <Sparkles /> Tạo social trên {chosen.length} nền tảng
              </Button>
            )}
          </div>
          {!ready ? <p className="text-muted-foreground text-xs">Điền Tên thương hiệu, Ngành nghề, Website chính ở bước 2.</p> : null}
          {results ? (
            <div className="grid gap-3">
              {results.map((r) =>
                r.ok && r.social ? (
                  <SocialRow key={r.platform} s={r.social} highlight onDelete={null} projectId={projectId} onUpdate={updateRec} />
                ) : (
                  <AgentError key={r.platform} r={r} busy={retrying === r.platform} onRetry={() => retryOne(r.platform)} />
                ),
              )}
            </div>
          ) : null}
          {preview ? (
            <div className="grid gap-3 rounded-xl border p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{preview.siteTitle}</p>
                  <p className="text-muted-foreground text-xs">{preview.tagline}</p>
                  <p className="mt-1 text-xs font-semibold">{preview.source === "ai" ? "✨ AI viết" : "⚙ App tự soạn từ thông tin + website (không dùng AI)"}</p>
                  {preview.note ? <p className="text-xs text-amber-700">{preview.note}</p> : null}
                </div>
                <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>Đóng</Button>
              </div>
              <div className="bg-muted/40 grid gap-1.5 rounded-lg p-3">
                <p className="text-sm font-semibold">URL trang chủ dự kiến</p>
                {chosen.length ? (
                  chosen.map((pid) => {
                    const u = expectedHome(pid);
                    return (
                      <div key={pid} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-muted-foreground w-32 shrink-0 text-xs">{PLATFORMS.find((x) => x.id === pid)?.name}</span>
                        <code className="break-all">{u.url}</code>
                        {u.note ? <span className="text-muted-foreground text-xs">({u.note})</span> : null}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-muted-foreground text-xs">Tích nền tảng ở trên để xem địa chỉ dự kiến.</p>
                )}
                <p className="text-muted-foreground text-xs">Địa chỉ thật chỉ chốt khi tạo xong — tên đã có người dùng thì nền tảng đó báo lỗi, app không tự đổi tên.</p>
              </div>
              {preview.pages.map((p) => (
                <details key={p.kind} className="rounded-lg border px-3 py-2">
                  <summary className="cursor-pointer text-sm font-semibold">{p.title}{p.kind === "blog" ? " (trang danh sách bài — để trống)" : ""}</summary>
                  {p.html ? <div className="prose prose-sm mt-2 max-w-none text-sm" dangerouslySetInnerHTML={{ __html: p.html }} /> : null}
                </details>
              ))}
              <p className="text-muted-foreground text-xs">Đây là bản xem trước. Trang thật còn có logo, ảnh bìa, lưới sản phẩm có ảnh và chân trang màu thương hiệu.</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Đã tạo */}
      <AgentLogCard projectId={projectId} />
      {list.length ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Các social đã tạo ({list.length})</CardTitle>
              <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(list.map((x) => `${x.platform}\t${x.pages.find((p) => p.label === "Trang chủ")?.url || x.siteUrl}`).join(String.fromCharCode(10))).then(() => toast.success("Đã copy — dán vào sheet: cột 1 nền tảng, cột 2 link trang chủ"), () => toast.error("Không copy được"))}>
                Copy link trang chủ (dán vào sheet)
              </Button>
              {conns?.sheets?.connected && conns.sheets.trackSheet ? (
                <Button variant="outline" size="sm" disabled={trackBusy} onClick={writeSheetNow}>
                  {trackBusy ? <Loader2 className="animate-spin" /> : null} Ghi vào sheet theo dõi
                </Button>
              ) : null}
              <Button variant="destructive" size="sm" disabled={removing !== null} onClick={() => removeHard(list)}>
                {removing === "all" ? <Loader2 className="animate-spin" /> : <Trash2 />} Xoá hẳn tất cả trên nền tảng
              </Button>
            </div>
            <CardDescription>Tạo lại social cho cùng thương hiệu thì nên xoá hẳn trang cũ trước, tránh Google đánh giá trùng lặp / spam.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {list.map((s) => (
              <SocialRow
                key={s.id}
                s={s}
                projectId={projectId}
                onUpdate={updateRec}
                busy={removing === s.id || removing === "all"}
                onHardDelete={() => removeHard([s])}
                onDelete={async () => {
                  if (!confirm(`Chỉ bỏ "${s.siteUrl}" khỏi danh sách trong app?\n\nTrang thật trên ${s.platform} VẪN CÒN và Google vẫn thấy. Muốn gỡ hẳn thì dùng nút "Xoá hẳn trên nền tảng".`)) return;
                  await deleteSocialRecord(projectId, s.id);
                  setList((l) => l.filter((x) => x.id !== s.id));
                }}
              />
            ))}
          </CardContent>
        </Card>
      ) : null}
      </>
      ) : null}
    </div>
  );
}

/** Nhật ký agent: việc agent đã tự làm (✅) và việc cần người làm (🙋), tự cập nhật mỗi phút. */
function AgentLogCard({ projectId }: { projectId: string }) {
  const [data, setData] = useState<{ items: AgentLogItem[]; retries: { platform: string; attempt: number; due: string; firstError: string }[] } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!projectId) return;
    let stop = false;
    const load = () => getAgentLog(projectId).then((d) => { if (!stop) setData(d); }).catch(() => null);
    void load();
    const t = setInterval(load, 60_000);
    return () => { stop = true; clearInterval(t); };
  }, [projectId]);
  if (!data || (!data.items.length && !data.retries.length)) return null;
  const items = open ? data.items : data.items.slice(0, 4);
  const t = (iso: string) => new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">🤖 Nhật ký agent</CardTitle>
        <CardDescription>Việc agent đã tự sửa, và việc cần anh/chị làm tay (khi agent hết cách).</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-1.5 text-sm">
        {data.retries.map((r) => (
          <div key={r.platform} className="rounded-md bg-sky-50 px-2 py-1 text-sky-900">🔁 {r.platform}: sẽ tự thử lại lần {r.attempt} lúc {t(r.due)} — lỗi trước: {r.firstError}</div>
        ))}
        {items.map((x, i) => (
          <div key={i} className={`rounded-md px-2 py-1 ${x.ok ? "bg-emerald-50 text-emerald-900" : /^Cần/.test(x.text) ? "bg-amber-50 text-amber-900" : "bg-muted/50"}`}>
            <span className="opacity-60">{t(x.at)}</span> · <b>{x.platform}</b>: {x.ok ? "✅ " : /^Cần/.test(x.text) ? "🙋 " : ""}{x.text}
            {x.link ? <> · <a href={x.link} target="_blank" rel="noreferrer" className="underline">mở ↗</a></> : null}
          </div>
        ))}
        {data.items.length > 4 ? <Button variant="ghost" size="sm" className="w-fit" onClick={() => setOpen(!open)}>{open ? "Thu gọn" : `Xem thêm ${data.items.length - 4} việc`}</Button> : null}
      </CardContent>
    </Card>
  );
}

/** Tầng 1 agent: lỗi được đọc thành lời dễ hiểu + việc cần làm + link bấm thẳng + nút Thử lại. */
function AgentError({ r, busy, onRetry }: { r: SocialCreateResult; busy: boolean; onRetry: () => void }) {
  const d = r.diagnosis;
  return (
    <div className="grid gap-1.5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p><b>{r.name}:</b> {d?.message ?? r.error}</p>
        <Button variant="outline" size="sm" disabled={busy} onClick={onRetry}>{busy ? <Loader2 className="animate-spin" /> : null} Thử lại {r.name}</Button>
      </div>
      {r.autoRetryAt ? (
        <p className="rounded-md bg-sky-100 px-2 py-1 text-sky-900">🔁 <b>Agent sẽ tự thử lại lúc {new Date(r.autoRetryAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</b> (lỗi này thường tự hết) — anh/chị không cần làm gì, kết quả sẽ hiện ở "Nhật ký agent" và nhắn Lark.</p>
      ) : d?.fix ? <p className="text-red-900">👉 <b>Cần làm:</b> {d.fix}</p> : null}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {d?.link ? <a href={d.link} target="_blank" rel="noreferrer" className="text-primary font-semibold hover:underline">Mở trang cần sửa ↗</a> : null}
        {d ? <span className="text-muted-foreground">{d.by === "ai" ? "🤖 AI đọc lỗi" : "⚙ App tự đọc lỗi"}{d.retry ? " · thử lại sau ít phút có thể được" : ""}</span> : null}
      </div>
      {r.steps?.length ? <p className="text-muted-foreground text-[11px]">Agent đã làm: {r.steps.join(" → ")}</p> : null}
      {d && r.error ? (
        <details className="text-muted-foreground text-[11px]"><summary className="cursor-pointer">Lỗi gốc (gửi người phụ trách nếu cần)</summary><p className="break-all">{r.error}</p></details>
      ) : null}
    </div>
  );
}

/** Tầng 2 agent: kết quả tự kiểm tra sau khi tạo + nút Kiểm tra lại. */
function CheckBox({ s, projectId, onUpdate }: { s: SocialRecord; projectId?: string; onUpdate?: (s: SocialRecord) => void }) {
  const [busy, setBusy] = useState(false);
  const c = s.check;
  const fresh = Date.now() - new Date(s.at).getTime() < 30 * 60_000;
  async function run() {
    if (!projectId) return;
    setBusy(true);
    try {
      const r = await checkSocialNow(projectId, s.id);
      onUpdate?.(r.social);
      toast[r.check.ok ? "success" : "message"](r.check.summary);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const tone = !c ? "bg-sky-50 text-sky-900" : c.pending ? "bg-sky-50 text-sky-900" : c.ok ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900";
  return (
    <div className={`grid gap-1 rounded-lg px-3 py-2 text-xs ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">
          {!c ? (fresh ? "⏳ Agent sẽ tự quay lại kiểm tra từng trang sau ít phút" : "Chưa kiểm tra") : `${c.pending ? "⏳" : c.ok ? "✅" : "⚠️"} ${c.summary}`}
          {c ? <span className="font-normal opacity-70"> · {new Date(c.at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</span> : null}
        </span>
        {projectId ? <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={busy} onClick={run}>{busy ? <Loader2 className="animate-spin" /> : null} Kiểm tra lại</Button> : null}
      </div>
      {c?.items.filter((x) => !x.ok || x.note).map((x) => (
        <span key={x.url}>{x.ok ? "✓" : "✗"} <a href={x.url} target="_blank" rel="noreferrer" className="underline">{x.label}</a>{x.note ? ` — ${x.note}` : ""}</span>
      ))}
      {c?.fixed.map((f) => <span key={f}>🔧 {f}</span>)}
    </div>
  );
}

function SocialRow({ s, highlight, onDelete, onHardDelete, busy, projectId, onUpdate }: { s: SocialRecord; highlight?: boolean; onDelete: (() => void) | null; onHardDelete?: () => void; busy?: boolean; projectId?: string; onUpdate?: (s: SocialRecord) => void }) {
  // Link trần công khai (bản đã xuất bản) cho từng trang — để copy dán vào sheet; link quản trị để nhỏ ở cuối
  // Chỉ link trang chủ (để điền sheet); các trang con theo cùng địa chỉ gốc
  const home = s.pages.find((p) => p.label === "Trang chủ")?.url || s.siteUrl;
  const copy = (text: string, what: string) =>
    navigator.clipboard.writeText(text).then(() => toast.success(`Đã copy ${what}`), () => toast.error("Không copy được — bôi đen link rồi copy tay"));
  return (
    <div className={`grid gap-2 rounded-xl border p-4 ${highlight ? "border-primary bg-primary/5" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-0.5">
          <span className="font-semibold">{s.platform} · {s.brand}</span>
          <span className="text-muted-foreground text-xs">{new Date(s.at).toLocaleString("vi-VN")}</span>
          {s.indexable === true ? (
            <span className="text-success-foreground w-fit rounded-full bg-success px-2 py-0.5 text-[11px] font-semibold">✓ Công khai — Google quét được</span>
          ) : s.indexable === false ? (
            <span className="w-fit rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">⚠ Trang chưa công khai — cần bấm Launch / Ra mắt trong trang quản trị để Google index</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => copy(home, "link trang chủ")}>Copy link</Button>
          {onHardDelete ? (
            <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" disabled={busy} onClick={onHardDelete} title="Xoá hẳn trang trên nền tảng — link thành 404">
              {busy ? <Loader2 className="animate-spin" /> : <Trash2 />} Xoá hẳn
            </Button>
          ) : null}
          {onDelete ? (
            <Button variant="ghost" size="sm" onClick={onDelete} title="Chỉ bỏ khỏi danh sách trong app (trang thật vẫn còn)">
              Bỏ khỏi danh sách
            </Button>
          ) : null}
        </div>
      </div>
      <a href={home} target="_blank" rel="noreferrer" className="text-primary w-fit break-all text-sm font-semibold hover:underline">{home}</a>
      {s.pages.filter((p) => p.url !== home).length ? (
        <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
          <span>Các trang con:</span>
          {s.pages.filter((p) => p.url !== home).map((p) => (
            <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">{p.label} ↗</a>
          ))}
        </div>
      ) : null}
      <CheckBox s={s} projectId={projectId} onUpdate={onUpdate} />
      {s.adminUrl ? (
        <a href={s.adminUrl} target="_blank" rel="noreferrer" className="text-muted-foreground w-fit text-xs hover:underline">Trang quản trị (cần đăng nhập) ↗</a>
      ) : null}
    </div>
  );
}

/** Những gì app đọc được từ website: logo, màu, ảnh, sản phẩm — có nút bỏ. */
function SiteFound({ site, onClear }: { site: SiteBrand; onClear: () => void }) {
  return (
    <div className="bg-muted/40 grid gap-2 rounded-lg p-3 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        {site.logo ? <img src={site.logo} alt="Logo" className="h-10 max-w-32 rounded bg-white object-contain p-1" /> : <span className="text-muted-foreground">Không thấy logo</span>}
        {[["Màu chính", site.design?.primary], ["Màu phụ", site.design?.secondary]].map(([k, v]) => (v ? <span key={k} className="inline-flex items-center gap-1"><span className="inline-block size-4 rounded border" style={{ background: v }} /> {k} {v}</span> : null))}
        {site.design?.bodyFont ? <span>Font: <b>{site.design.bodyFont}</b>{site.design.fontsHref ? "" : " (không có trên Google Fonts — trang social dùng font gần giống)"}</span> : null}
        <span>{site.images.length} ảnh · {site.products.length} sản phẩm/mục · {site.socials.length} kênh MXH</span>
        <button type="button" className="ml-auto font-semibold text-red-600 hover:underline" onClick={onClear}>Bỏ dữ liệu website</button>
      </div>
      {site.images.length ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {site.images.slice(0, 10).map((i) => <img key={i.src} src={i.src} alt={i.alt} className="h-16 w-24 flex-none rounded object-cover" loading="lazy" />)}
        </div>
      ) : null}
    </div>
  );
}

/** Chọn / tạo / xoá dự án — mỗi dự án có thông tin thương hiệu, tài khoản gốc và danh sách social riêng. */
function ProjectBar(props: {
  projects: ProjectSummary[] | null;
  projectId: string;
  onOpen: (id: string) => void;
  onDelete: () => void;
  newName: string;
  setNewName: (v: string) => void;
  onAdd: () => void;
  adding: boolean;
  saveState: "" | "saving" | "saved";
}) {
  const { projects, projectId } = props;
  const add = (
    <form
      className="flex flex-1 gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        props.onAdd();
      }}
    >
      <Input value={props.newName} onChange={(e) => props.setNewName(e.target.value)} placeholder="Tên dự án mới, VD: Techcombank" className="min-w-0" />
      <Button type="submit" variant={projects?.length ? "outline" : "default"} disabled={!props.newName.trim() || props.adding}>
        {props.adding ? <Loader2 className="animate-spin" /> : <Plus />} Tạo dự án
      </Button>
    </form>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderOpen className="text-primary size-5" /> Dự án
        </CardTitle>
        <CardDescription>Mỗi dự án có thông tin thương hiệu, link sheet, tài khoản gốc và danh sách social riêng — không dùng lẫn của nhau. Dùng chung danh sách dự án với tab “Đăng lên trang có sẵn”.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {projects === null ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> Đang tải dự án…
          </p>
        ) : projects.length ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={projectId}
                onChange={(e) => props.onOpen(e.target.value)}
                className="border-input bg-background h-9 min-w-56 flex-1 rounded-md border px-3 text-sm font-semibold"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.brandName && p.brandName !== p.name ? ` · ${p.brandName}` : ""}
                  </option>
                ))}
              </select>
              <Button variant="outline" className="text-red-600 hover:text-red-700" onClick={props.onDelete} disabled={!projectId}>
                <Trash2 /> Xoá dự án
              </Button>
              <span className="text-muted-foreground w-24 text-xs">{props.saveState === "saving" ? "Đang lưu…" : props.saveState === "saved" ? "✓ Đã lưu" : ""}</span>
            </div>
            {add}
          </>
        ) : (
          <>
            <p className="text-sm">Chưa có dự án nào — tạo dự án đầu tiên để bắt đầu tạo social.</p>
            {add}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Tiêu đề 1 trong 3 nhóm social: tạo được ngay / bán tự động / thủ công. */
function SectionHead({ title, count, chip, desc, tone }: { title: string; count: number; chip: string; desc: string; tone: "green" | "amber" | "gray" }) {
  const t = {
    green: { icon: Zap, badge: "bg-emerald-500 text-white", chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", line: "from-emerald-500/40" },
    amber: { icon: Sparkles, badge: "bg-amber-500 text-white", chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400", line: "from-amber-500/40" },
    gray: { icon: Hand, badge: "bg-slate-500 text-white", chip: "bg-slate-500/10 text-slate-600 dark:text-slate-300", line: "from-slate-400/40" },
  }[tone];
  const Icon = t.icon;
  return (
    <div className="mt-2 grid gap-1.5">
      <div className="flex items-center gap-3">
        <span className={`grid size-8 shrink-0 place-items-center rounded-full shadow-sm ${t.badge}`}>
          <Icon className="size-4" />
        </span>
        <h3 className="text-base font-bold tracking-tight">{title}</h3>
        <span className="bg-muted rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums">{count}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${t.chip}`}>{chip}</span>
        <span className={`h-px flex-1 bg-gradient-to-r to-transparent ${t.line}`} />
      </div>
      <p className="text-muted-foreground pl-11 text-xs">{desc}</p>
    </div>
  );
}

/** Các nền tảng chưa tự động: bấm thẻ → lý do + các bước tạo tay + thông tin copy sẵn từ form. */
function UpcomingList({ biz }: { biz: BusinessInfo }) {
  const [open, setOpen] = useState<string | null>(null);
  const info: [string, string | undefined][] = [
    ["Tên", biz.brandName],
    ["Bio", biz.bio],
    ["Website", biz.targetUrl],
    ["Giới thiệu", biz.about],
    ["Email", biz.email],
    ["Số điện thoại", biz.phone],
    ["Địa chỉ", biz.address],
    ["Ảnh đại diện", biz.avatarUrl || biz.logoUrl],
    ["Ảnh bìa", biz.coverUrl],
  ];
  const filled = info.filter(([, v]) => v && v.trim());
  const group = (g: Upcoming["group"]) => {
    const list = UPCOMING.filter((u) => u.group === g);
    return (
      <div className="grid gap-2">
        {g === "semi" ? (
          <SectionHead tone="amber" title="Bán tự động" count={list.length} chip="Đang đưa vào app" desc="Làm 1 bước tay (tạo tài khoản, xác minh), phần còn lại app làm. Bấm từng thẻ để xem cách tạo tay trong lúc chờ." />
        ) : (
          <SectionHead tone="gray" title="Thủ công" count={list.length} chip="Làm tay" desc="Nền tảng chặn phần mềm tạo và sửa hồ sơ. Bấm từng thẻ để xem các bước và copy sẵn thông tin." />
        )}
        <div className="grid gap-2 md:grid-cols-2">
          {list.map((u) => {
            const on = open === u.name;
            return (
              <div key={u.name} className={`rounded-lg border ${on ? "border-primary md:col-span-2" : "bg-muted/40 border-transparent"}`}>
                <button type="button" className="hover:bg-muted grid w-full gap-0.5 rounded-lg p-3 text-left" onClick={() => setOpen(on ? null : u.name)}>
                  <p className="text-sm font-semibold">
                    {u.name} <span className="text-muted-foreground font-normal">· {u.domain}</span>
                    <span className="text-primary float-right text-xs">{on ? "Thu gọn ▲" : "Xem cách tạo ▼"}</span>
                  </p>
                  <p className="text-muted-foreground text-xs">{u.note}</p>
                </button>
                {on ? (
                  <div className="grid gap-3 border-t p-3 text-sm">
                    <div>
                      <p className="mb-1 font-semibold">Cách tạo tay (trong lúc chờ tự động):</p>
                      <ol className="list-decimal space-y-0.5 pl-5">
                        {u.steps.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ol>
                    </div>
                    <a href={u.signup} target="_blank" rel="noreferrer" className="text-primary inline-flex w-fit items-center gap-1 font-semibold hover:underline">
                      Mở trang đăng ký {u.name} <ExternalLink className="size-3.5" />
                    </a>
                    <div>
                      <p className="mb-1 font-semibold">Thông tin copy sẵn (từ form bên dưới):</p>
                      {filled.length ? (
                        <div className="grid gap-1">
                          {filled.map(([k, v]) => (
                            <div key={k} className="flex items-start gap-2 text-xs">
                              <span className="text-muted-foreground w-24 shrink-0">{k}</span>
                              <span className="line-clamp-2 flex-1 break-all">{v}</span>
                              <button type="button" className="text-primary shrink-0 font-semibold hover:underline" onClick={() => navigator.clipboard.writeText(v!).then(() => toast.success(`Đã copy ${k}`))}>
                                Copy
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-muted-foreground text-xs">Dán link sheet hoặc điền form ở bước 2 — thông tin sẽ hiện ở đây để copy.</p>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  };
  return (
    <div className="mt-2 grid gap-5">
      {group("semi")}
      {group("manual")}
    </div>
  );
}

/** Cài app Tumblr ngay trên web: hướng dẫn + copy sẵn + dán Client ID / Client Secret. */
function TumblrAppSetup({ redirectUri, onClose, onSaved }: { redirectUri: string; onClose: () => void; onSaved: () => void }) {
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const site = redirectUri.replace(/\/api\/tumblr\/callback$/, "");
  const Copy = ({ label, value }: { label: string; value: string }) => (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground w-40 shrink-0">{label}</span>
      <code className="bg-background rounded border px-2 py-0.5 break-all">{value}</code>
      <button type="button" className="text-primary text-xs font-semibold hover:underline" onClick={() => navigator.clipboard.writeText(value).then(() => toast.success("Đã copy"), () => toast.error("Không copy được — bôi đen rồi copy tay"))}>Copy</button>
    </div>
  );
  return (
    <div className="bg-muted/50 grid gap-3 rounded-lg p-3 text-sm">
      <p className="font-semibold">Cài app Tumblr (làm 1 lần, khoảng 3 phút)</p>
      <p>1. Đăng nhập Tumblr, mở <a href="https://www.tumblr.com/oauth/register" target="_blank" rel="noreferrer" className="text-primary font-semibold underline">trang đăng ký app <ExternalLink className="inline size-3" /></a>.</p>
      <div className="grid gap-1.5">
        <p>2. Điền các ô (bấm Copy rồi dán):</p>
        <Copy label="Application Name" value="Tro ly AI SEONGON" />
        <Copy label="Application Website" value={site} />
        <Copy label="Application Description" value="Tao trang social tu dong" />
        <Copy label="Default callback URL" value={redirectUri} />
        <Copy label="OAuth2 redirect URLs" value={redirectUri} />
        <p className="text-muted-foreground text-xs">Administrative contact email: email của bạn → tích đồng ý điều khoản → Register.</p>
      </div>
      <p>3. Trang hiện <b>OAuth Consumer Key</b> (= Client ID) và <b>Secret Key</b> (bấm Show) — dán vào đây:</p>
      <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
        <Input value={id} onChange={(e) => setId(e.target.value.trim())} placeholder="OAuth Consumer Key" autoComplete="off" />
        <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Secret Key" autoComplete="off" />
        <Button
          disabled={id.length < 20 || secret.trim().length < 20 || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await saveTumblrApp(id, secret);
              toast.success("Đã lưu app Tumblr — giờ bấm Kết nối tài khoản");
              onSaved();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : String(e), { duration: 10000 });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : null} Lưu
        </Button>
      </div>
      <button type="button" className="text-muted-foreground w-fit text-xs hover:underline" onClick={onClose}>Đóng</button>
    </div>
  );
}

/** Cài app Google (cho Blogger) ngay trên web: hướng dẫn từng bước + ô có nút copy + dán Client ID / Client Secret. */
function GoogleAppSetup({ redirectUri, hasApp, connected, open, onToggle, onSaved }: { redirectUri: string; hasApp: boolean; connected: boolean; open: boolean; onToggle: () => void; onSaved: () => void }) {
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary font-semibold underline">{children} <ExternalLink className="inline size-3" /></a>
  );
  if (hasApp && !open) {
    return (
      <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
        <span>✓ Bước 1: đã cài app Google (dùng chung mọi dự án).{connected ? " Bước 2: đã kết nối tài khoản cho dự án này." : " Bước 2: bấm Kết nối tài khoản cho dự án đang mở."}</span>
        <button type="button" className="text-primary font-semibold hover:underline" onClick={onToggle}>Thay Client ID / Secret</button>
        <button
          type="button"
          className="font-semibold text-red-600 hover:underline"
          onClick={async () => {
            if (!confirm("Xoá app Google đã cài? Phải cài lại mới kết nối Blogger được. Các trang đã tạo vẫn giữ nguyên.")) return;
            await deleteGoogleApp();
            onSaved();
          }}
        >
          Xoá app
        </button>
      </div>
    );
  }
  if (!open) return null;
  return (
    <div className="bg-muted/50 grid gap-3 rounded-lg p-3 text-sm">
      <p className="font-semibold">Cài app Google cho Blogger (làm 1 lần, khoảng 5 phút)</p>
      <p>1. Đăng nhập Gmail sẽ dùng làm Blogger, mở <A href="https://console.cloud.google.com/projectcreate">tạo dự án Google Cloud</A>, đặt tên "Tro ly AI SEONGON" rồi Create.</p>
      <p>2. Mở <A href="https://console.cloud.google.com/apis/library/blogger.googleapis.com">Blogger API</A> → bấm <b>Enable</b>. Làm tương tự với <A href="https://console.cloud.google.com/apis/library/sheets.googleapis.com">Google Sheets API</A> (để app tự ghi link vào sheet theo dõi).</p>
      <p>3. Mở <A href="https://console.cloud.google.com/auth/branding">màn hình đồng ý OAuth</A> → Get started → tên app "Tro ly AI SEONGON", email của bạn → Audience: <b>External</b> → Create. Sau đó vào mục <b>Audience</b> bấm <b>Publish app</b> (nếu để Testing thì kết nối tự hết hạn sau 7 ngày).</p>
      <div className="grid gap-1.5">
        <p>4. Mở <A href="https://console.cloud.google.com/auth/clients/create">tạo OAuth client</A> → Application type: <b>Web application</b> → mục Authorized redirect URIs bấm Add URI, dán:</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="bg-background rounded border px-2 py-0.5">{redirectUri}</code>
          <button type="button" className="text-primary text-xs font-semibold hover:underline" onClick={() => navigator.clipboard.writeText(redirectUri).then(() => toast.success("Đã copy"), () => toast.error("Không copy được — bôi đen rồi copy tay"))}>Copy</button>
        </div>
        <p className="text-muted-foreground text-xs">Bấm Create → hiện Client ID (đuôi .apps.googleusercontent.com) và Client Secret.</p>
      </div>
      <p>5. Dán vào đây:</p>
      <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
        <Input value={id} onChange={(e) => setId(e.target.value.trim())} placeholder="Client ID" autoComplete="off" />
        <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Client Secret" autoComplete="off" />
        <Button
          disabled={!/\.apps\.googleusercontent\.com$/.test(id) || secret.trim().length < 15 || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await saveGoogleApp(id, secret);
              toast.success("Đã lưu app Google — giờ bấm Kết nối Blogger");
              setId("");
              setSecret("");
              onSaved();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : String(e), { duration: 10000 });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : null} Lưu
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">Client Secret được mã hoá khi lưu, chỉ bạn dùng, dùng chung cho mọi dự án. Mỗi dự án bấm "Kết nối Blogger" bằng Gmail riêng của dự án đó.</p>
    </div>
  );
}

/** Cài app WordPress.com ngay trên web: hướng dẫn + các ô có nút copy + dán Client ID / Client Secret. */
function WpcomAppSetup({ redirectUri, hasApp, connected, open, onToggle, onSaved }: { redirectUri: string; hasApp: boolean; connected: boolean; open: boolean; onToggle: () => void; onSaved: () => void }) {
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const site = redirectUri.replace(/\/api\/wpcom\/callback$/, "");
  const Copy = ({ label, value }: { label: string; value: string }) => (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground w-28 shrink-0">{label}</span>
      <code className="bg-background rounded border px-2 py-0.5">{value}</code>
      <button type="button" className="text-primary text-xs font-semibold hover:underline" onClick={() => navigator.clipboard.writeText(value).then(() => toast.success("Đã copy"))}>
        Copy
      </button>
    </div>
  );
  if (hasApp && !open) {
    return (
      <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
        <span>✓ Bước 1: đã cài app WordPress.com (dùng chung mọi dự án).{connected ? " Bước 2: đã kết nối tài khoản cho dự án này." : " Bước 2: bấm Kết nối tài khoản cho dự án đang mở."}</span>
        <button type="button" className="text-primary font-semibold hover:underline" onClick={onToggle}>
          Thay Client ID / Secret
        </button>
        <button
          type="button"
          className="font-semibold text-red-600 hover:underline"
          onClick={async () => {
            if (!confirm("Xoá app WordPress.com đã cài? Kết nối WordPress.com cũng bị ngắt. Các trang đã tạo vẫn giữ nguyên.")) return;
            await deleteWpcomApp();
            onSaved();
          }}
        >
          Xoá app
        </button>
      </div>
    );
  }
  if (!open) return null;
  return (
    <div className="bg-muted/50 grid gap-3 rounded-lg p-3">
      <p className="text-sm font-semibold">Cài app WordPress.com (làm 1 lần, khoảng 3 phút)</p>
      <p className="text-sm">
        1. Đăng nhập tài khoản WordPress.com gốc, mở{" "}
        <a href="https://developer.wordpress.com/apps/new/" target="_blank" rel="noreferrer" className="text-primary font-semibold underline">
          trang tạo app <ExternalLink className="inline size-3" />
        </a>
        .
      </p>
      <div className="grid gap-1.5">
        <p className="text-sm">2. Điền các ô (bấm Copy rồi dán):</p>
        <Copy label="Name" value="Tro ly AI SEONGON" />
        <Copy label="Description" value="Tao trang social tu dong" />
        <Copy label="Website URL" value={site} />
        <Copy label="Redirect URLs" value={redirectUri} />
        <p className="text-muted-foreground text-xs">Type: chọn Web · ô "Javascript Origins" để trống · trả lời câu hỏi chống spam rồi bấm Create.</p>
      </div>
      <p className="text-sm">3. Trang hiện ra Client ID (dãy số) và Client Secret — copy dán vào đây:</p>
      <div className="grid gap-2 md:grid-cols-[180px_1fr_auto]">
        <Input value={id} onChange={(e) => setId(e.target.value.trim())} placeholder="Client ID" inputMode="numeric" />
        <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Client Secret" autoComplete="off" />
        <Button
          disabled={!/^\d{3,12}$/.test(id) || secret.trim().length < 20 || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await saveWpcomApp(id, secret);
              toast.success("Đã lưu app — giờ bấm Kết nối WordPress.com");
              setId("");
              setSecret("");
              onSaved();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : String(e), { duration: 10000 });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : null} Lưu
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">Client Secret được mã hoá khi lưu, chỉ bạn dùng. 4. Lưu xong bấm "Kết nối WordPress.com" để cho phép app tạo trang.</p>
    </div>
  );
}
