/**
 * 組出「開啟某篇筆記」的頁面連結（/notes/{slug}）。
 *
 * 為什麼要「逐段 encodeURIComponent、以 / 接回」而非裸串、也不是整串編碼：
 * - 舊檔案匯入時代的筆記 slug 可含「#」（prod 實例：programming/c#/f）。裸串組 href 時，
 *   瀏覽器會把「#」之後整段當成 URL fragment（錨點）切掉，Next 路由收到的路徑因此變短，
 *   導頁變成「筆記不存在」。逐段 encodeURIComponent 會把「#」編成 %23，fragment 陷阱消失。
 * - slug 內的「/」帶「層級分隔」語意（多段路徑），必須保留成真正的路徑分隔符，不能被編成 %2F。
 *   故先以「/」切段、每段各自 encodeURIComponent、再以「/」接回，同時滿足
 *   「特殊字元編碼」與「層級分隔保留」兩個需求（整串 encodeURIComponent 會連「/」一起編掉，破壞層級）。
 *
 * decode∘encode 恆等：decodeURIComponent(noteHref(slug)) === "/notes/" + slug，
 * 讓側欄以 decodeURIComponent(pathname) 與裸 slug 比對「目前筆記」高亮時不會失準。
 *
 * @param slug 筆記 slug（可含「/」層級與「#」等特殊字元）；空字串／null／undefined 視為「無指定」。
 * @returns 筆記頁連結；slug 為空時退回筆記清單頁 "/notes"。
 */
export function noteHref(slug?: string | null): string {
  if (!slug) return "/notes";
  return "/notes/" + slug.split("/").map(encodeURIComponent).join("/");
}
