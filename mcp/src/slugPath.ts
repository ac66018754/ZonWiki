/**
 * 匹配「孤立 surrogate」（畸形 UTF-16 碼元）：高位代理（U+D800–U+DBFF）後面沒有緊接低位、
 * 或低位代理（U+DC00–U+DFFF）前面沒有高位。合法的 surrogate pair（高位緊接低位）不會被匹配到。
 * 供 encodeSlugPath 在 encodeURIComponent 拋 URIError 時，把孤立 surrogate 換成 U+FFFD 再編碼。
 */
const LONE_SURROGATE_PATTERN =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/**
 * 把筆記 slug 逐段編碼成可安全放進 URL 路徑的字串（段與段之間的「/」保留為層級分隔）。
 *
 * 為什麼要「逐段 encodeURIComponent、以 / 接回」而非裸串：
 * MCP 的 get_note 原本把 slug 直接串進 `/api/notes/${slug}`，slug 含「#」時 fetch 會把其後整段
 * 當 URL fragment 丟棄（實證：get_note("programming/c#/f") 回 Note not found，但該筆記存在）。
 * 逐段 encodeURIComponent 會把「#」編成 %23（fragment 陷阱消失），同時保留「/」層級分隔
 * （整串 encodeURIComponent 會連「/」一起編成 %2F，破壞層級）。
 *
 * 畸形 Unicode 防禦：encodeURIComponent 對「孤立 surrogate」會丟 URIError；舊匯入資料可能含此類壞字串。
 * 故以 try/catch 兜底——catch 到 URIError 時，先把該段的孤立 surrogate 換成 U+FFFD（置換字元）再編碼；
 * 合法 surrogate pair 能正常編碼、不會進 catch（對抗式復審 MEDIUM #2）。
 *
 * 契約與前端 frontend/src/lib/noteHref.ts 的 encodeSlugPath 完全一致（含孤立 surrogate 防禦、
 * 以及不編碼 sub-delims「! * ' ( )」的 encodeURIComponent 語意）；兩套件（MCP／前端）無共用機制，
 * 故各自持有一份、以此註解互指，改動編碼規則時兩邊要一起改。
 *
 * @param slug - 筆記 slug（可含「/」層級與「#」等特殊字元）
 * @returns 逐段編碼後、以「/」接回的路徑片段（不含任何前綴；空字串回空字串）
 */
export function encodeSlugPath(slug: string): string {
  return slug
    .split('/')
    .map((segment) => {
      try {
        return encodeURIComponent(segment)
      } catch {
        // 孤立 surrogate → 置換字元 U+FFFD 後再編碼（見上方 JSDoc 的「畸形 Unicode 防禦」）。
        return encodeURIComponent(segment.replace(LONE_SURROGATE_PATTERN, '�'))
      }
    })
    .join('/')
}
