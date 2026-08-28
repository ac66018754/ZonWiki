'use client';

/**
 * 自訂品牌標誌（Header 左上角那顆圓形圖示）的影像處理。
 *
 * 為什麼要在瀏覽器端縮圖：這張圖只會顯示成 32px，但使用者選的通常是手機拍的幾 MB 大圖。
 * 直接存進 DB 欄位既浪費、也會拖慢每次 /api/me。先縮到 128×128 再存，實測約 5~15KB。
 *
 * 為什麼縮成 data URI 而不是走 /api/attachments：附件有「每日孤兒掃描」——只有被筆記內容
 * 引用的附件才算有主，Logo 沒有任何筆記引用它，隔天就會被當孤兒軟刪除。存 data URI 完全繞開。
 */

/** 縮圖後的邊長（正方形；顯示成 32px，2x/3x 螢幕也夠銳利）。 */
export const BRAND_LOGO_SIZE = 128;

/** 允許選擇的檔案大小上限（縮圖前的原始檔）。純防呆：太大的檔連解碼都慢。 */
export const BRAND_LOGO_MAX_INPUT_BYTES = 20 * 1024 * 1024;

/**
 * 把使用者選的圖片檔縮成 128×128 的正方形 data URI。
 *
 * 裁切方式為「置中裁切（cover）」：先等比放大到剛好蓋滿正方形，再從中央裁掉多餘的部分——
 * 因為標誌會被切成圓形，用 contain（留白）會在圓內留下難看的空邊。
 *
 * @param file 使用者選的圖片檔。
 * @returns 圖片的 data URI（優先 WebP，瀏覽器不支援時退回 PNG）。
 * @throws Error 檔案不是圖片、過大、或解碼失敗時丟出（message 為可直接顯示的繁中訊息）。
 */
export async function fileToBrandLogoDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('請選擇圖片檔（png / jpg / webp / gif 等）');
  }
  if (file.size > BRAND_LOGO_MAX_INPUT_BYTES) {
    throw new Error('圖片太大（上限 20MB），請先壓縮再試');
  }

  const bitmap = await decodeImage(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = BRAND_LOGO_SIZE;
    canvas.height = BRAND_LOGO_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('瀏覽器不支援影像處理，無法縮圖');

    // 置中裁切（cover）：取原圖中央的正方形區域，畫滿整個畫布。
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, BRAND_LOGO_SIZE, BRAND_LOGO_SIZE);

    // WebP 檔案小很多；少數舊瀏覽器不支援時 toDataURL 會靜默回 PNG，故用回傳值判斷而非假設成功。
    const webp = canvas.toDataURL('image/webp', 0.9);
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
  } finally {
    // ImageBitmap 佔的是 GPU/原生記憶體，不會被 GC 及時回收，用完要自己關。
    if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}

/**
 * 把圖片檔解碼成可繪製的來源。
 * 優先用 createImageBitmap（快、不進 DOM）；環境不支援時退回 <img> + objectURL。
 * @param file 圖片檔。
 * @returns 可傳給 canvas drawImage 的影像來源。
 */
async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // 某些格式（少數 SVG／動畫）createImageBitmap 會失敗 → 走下面的 <img> 後援。
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('無法讀取這張圖片，請換一張試試'));
      img.src = url;
    });
  } finally {
    // 注意：要等 onload 之後才能撤銷；這裡在 Promise settle 後才執行，圖已解碼完成。
    URL.revokeObjectURL(url);
  }
}
