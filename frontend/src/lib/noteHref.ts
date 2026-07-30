/**
 * 匹配「孤立 surrogate」（畸形 UTF-16 碼元）：高位代理（U+D800–U+DBFF）後面沒有緊接低位、
 * 或低位代理（U+DC00–U+DFFF）前面沒有高位。合法的 surrogate pair（高位緊接低位）不會被匹配到。
 * 供 encodeSlugPath 在 encodeURIComponent 拋 URIError 時，把孤立 surrogate 換成 U+FFFD 再編碼。
 */
const LONE_SURROGATE_PATTERN =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * 逐段編碼筆記 slug（不含 /notes 前綴）：以「/」切段、每段 encodeURIComponent、再以「/」接回。
 *
 * 為什麼要「逐段編碼、以 / 接回」而非裸串、也不是整串編碼：
 * - 舊檔案匯入時代的 slug 可含「#」（prod 實例：programming/c#/f）。裸串放進 URL 時，「#」之後整段
 *   會被瀏覽器當成 fragment（錨點）切掉，導頁變「筆記不存在」；逐段 encodeURIComponent 會把「#」
 *   編成 %23，fragment 陷阱消失。
 * - slug 內的「/」帶「層級分隔」語意，必須保留成真正的路徑分隔符（整串 encodeURIComponent 會連「/」
 *   一起編成 %2F，破壞層級）。故先以「/」切段、每段各自編碼、再以「/」接回。
 *
 * 畸形 Unicode 防禦：encodeURIComponent 對「孤立 surrogate」會丟 URIError；舊匯入資料可能含此類壞字串，
 * 側欄逐筆渲染 <Link> 時一顆壞 slug 會讓整份清單崩掉（對抗式復審 MEDIUM #2）。故以 try/catch 兜底——
 * catch 到 URIError 時，先把該段的孤立 surrogate 換成 U+FFFD（置換字元）再編碼；合法 surrogate pair
 * 能正常編碼、不會進 catch。
 *
 * 註：encodeURIComponent 不編碼 RFC 3986 sub-delims「! * ' ( )」，後端 EncodeSlugForUrl 已對齊此語意，
 * 確保同一 slug 前後端組出的 URL 逐位元組相同（返回堆疊字面比對才不會誤判）。
 *
 * @param slug 筆記 slug（可含「/」層級與「#」等特殊字元）
 * @returns 逐段編碼後、以「/」接回的路徑片段（不含 /notes 前綴；空字串回空字串）
 */
export function encodeSlugPath(slug: string): string {
  return slug
    .split("/")
    .map((segment) => {
      try {
        return encodeURIComponent(segment);
      } catch {
        // 孤立 surrogate → 置換字元 U+FFFD 後再編碼（見上方 JSDoc 的「畸形 Unicode 防禦」）。
        return encodeURIComponent(segment.replace(LONE_SURROGATE_PATTERN, "�"));
      }
    })
    .join("/");
}

/**
 * 組出「開啟某篇筆記」的頁面連結（/notes/{slug}）。編碼細節（# fragment 陷阱、/ 層級保留、
 * 畸形 Unicode 防禦、sub-delims 與後端對齊）全部委由 encodeSlugPath，見其 JSDoc。
 *
 * decode∘encode 恆等：decodeURIComponent(noteHref(slug)) === "/notes/" + slug，
 * 讓側欄以 decodeURIComponent(pathname) 與裸 slug 比對「目前筆記」高亮時不會失準。
 *
 * @param slug 筆記 slug（可含「/」層級與「#」等特殊字元）；空字串／null／undefined 視為「無指定」。
 * @returns 筆記頁連結；slug 為空時退回筆記清單頁 "/notes"。
 */
export function noteHref(slug?: string | null): string {
  if (!slug) return "/notes";
  return "/notes/" + encodeSlugPath(slug);
}
