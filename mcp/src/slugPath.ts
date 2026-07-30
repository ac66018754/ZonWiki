/**
 * 把筆記 slug 逐段編碼成可安全放進 URL 路徑的字串（段與段之間的「/」保留為層級分隔）。
 *
 * 為什麼要「逐段 encodeURIComponent、以 / 接回」而非裸串：
 * MCP 的 get_note 原本把 slug 直接串進 `/api/notes/${slug}`，slug 含「#」時 fetch 會把其後整段
 * 當 URL fragment 丟棄（實證：get_note("programming/c#/f") 回 Note not found，但該筆記存在）。
 * 逐段 encodeURIComponent 會把「#」編成 %23（fragment 陷阱消失），同時保留「/」層級分隔
 * （整串 encodeURIComponent 會連「/」一起編成 %2F，破壞層級）。
 *
 * 契約與前端 frontend/src/lib/noteHref.ts 的編碼段完全一致；兩套件（MCP／前端）無共用機制，
 * 故各自持有一份、以此註解互指，改動編碼規則時兩邊要一起改。
 *
 * @param slug - 筆記 slug（可含「/」層級與「#」等特殊字元）
 * @returns 逐段編碼後、以「/」接回的路徑片段（不含任何前綴；空字串回空字串）
 */
export function encodeSlugPath(slug: string): string {
  return slug.split('/').map(encodeURIComponent).join('/')
}
