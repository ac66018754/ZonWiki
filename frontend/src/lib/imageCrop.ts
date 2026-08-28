'use client';

/**
 * 圓形頭像／標誌的「裁切‧縮放‧旋轉」共用運算。
 *
 * 由 {@link import('@/components/ImageCropModal').ImageCropModal} 使用：
 * 編輯器的預覽畫布與最終輸出的圖檔，**走同一支繪製函式、只差邊長**——
 * 這是「所見即所得」的關鍵：使用者在預覽裡看到什麼，存下來就是什麼。
 *
 * 座標約定：位移（offsetX/offsetY）以「正方形邊長的倍數」表示（例如 0.25 ＝ 往右移四分之一邊長），
 * 而不是像素。這樣同一組參數套到 320px 的預覽與 256px 的輸出都會得到完全相同的構圖。
 */

/** 允許選擇的原始檔大小上限。純防呆：太大的檔連解碼都慢。 */
export const IMAGE_MAX_INPUT_BYTES = 20 * 1024 * 1024;

/** 輸出圖片的邊長（正方形）。顯示只用到 32~96px，256 足夠應付高解析螢幕。 */
export const CROP_OUTPUT_SIZE = 256;

/** 縮放倍率的可用範圍（1＝剛好蓋滿正方形）。 */
export const CROP_MIN_ZOOM = 1;
export const CROP_MAX_ZOOM = 4;

/**
 * 裁切參數。
 */
export interface CropTransform {
  /** 縮放倍率（1＝剛好蓋滿裁切框；見 CROP_MIN_ZOOM / CROP_MAX_ZOOM）。 */
  zoom: number;
  /** 旋轉角度（度；順時針為正）。 */
  rotationDeg: number;
  /** 水平位移（正方形邊長的倍數，正值往右）。 */
  offsetX: number;
  /** 垂直位移（正方形邊長的倍數，正值往下）。 */
  offsetY: number;
}

/** 尚未調整過的預設參數（置中、不旋轉、剛好蓋滿）。 */
export const DEFAULT_CROP: CropTransform = { zoom: 1, rotationDeg: 0, offsetX: 0, offsetY: 0 };

/** 可被 canvas 繪製、且知道自身尺寸的影像來源。 */
export type DecodedImage = (ImageBitmap | HTMLImageElement) & { width: number; height: number };

/**
 * 把圖片檔解碼成可繪製的來源。
 * 優先用 createImageBitmap（快、不進 DOM）；環境或格式不支援時退回 <img> + objectURL。
 * @param file 使用者選的圖片檔。
 * @returns 可傳給 canvas drawImage 的影像來源。
 * @throws Error 非圖片、過大或解碼失敗時丟出（message 可直接顯示給使用者）。
 */
export async function decodeImageFile(file: File): Promise<DecodedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('請選擇圖片檔（png / jpg / webp / gif 等）');
  }
  if (file.size > IMAGE_MAX_INPUT_BYTES) {
    throw new Error('圖片太大（上限 20MB），請先壓縮再試');
  }

  if (typeof createImageBitmap === 'function') {
    try {
      return (await createImageBitmap(file)) as DecodedImage;
    } catch {
      // 少數格式（部分 SVG／動畫）createImageBitmap 會失敗 → 走下面的 <img> 後援。
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<DecodedImage>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img as DecodedImage);
      img.onerror = () => reject(new Error('無法讀取這張圖片，請換一張試試'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 算出「zoom = 1 時剛好蓋滿裁切框」所需的縮放比例。
 *
 * 旋轉會讓需要的比例變大：把裁切框反向旋轉後，它的外接矩形邊長是 `size × (|cosθ| + |sinθ|)`，
 * 只要圖片的短邊放大到能蓋住這個外接矩形，旋轉後就一定蓋得滿裁切框、不會露出透明角。
 *
 * @param img 影像來源（取其原始寬高）。
 * @param size 裁切框邊長（像素）。
 * @param rotationDeg 旋轉角度（度）。
 * @returns 需要的縮放比例。
 */
export function coverBaseScale(img: DecodedImage, size: number, rotationDeg: number): number {
  const rad = (rotationDeg * Math.PI) / 180;
  const spread = Math.abs(Math.cos(rad)) + Math.abs(Math.sin(rad));
  const shortSide = Math.min(img.width, img.height) || 1;
  return (size * spread) / shortSide;
}

/**
 * 把位移夾在合理範圍內：最多只能拖到「旋轉後外接矩形的邊緣貼齊裁切框邊緣」。
 * 沒有夾取的話使用者可以把圖整個拖出畫面，只剩一片空白。
 *
 * @param transform 目前的裁切參數。
 * @param img 影像來源。
 * @returns 夾取後的裁切參數（其餘欄位原樣帶回）。
 */
export function clampCrop(transform: CropTransform, img: DecodedImage): CropTransform {
  // 以「邊長 = 1」的單位正方形計算，得到的界線本身就是「邊長的倍數」，與 offset 同單位。
  const scale = coverBaseScale(img, 1, transform.rotationDeg) * transform.zoom;
  const rad = (transform.rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const boxW = scale * (img.width * cos + img.height * sin);
  const boxH = scale * (img.width * sin + img.height * cos);
  const maxX = Math.max(0, (boxW - 1) / 2);
  const maxY = Math.max(0, (boxH - 1) / 2);
  return {
    ...transform,
    offsetX: Math.min(maxX, Math.max(-maxX, transform.offsetX)),
    offsetY: Math.min(maxY, Math.max(-maxY, transform.offsetY)),
  };
}

/**
 * 依裁切參數把影像畫進正方形畫布。
 *
 * 預覽與輸出共用本函式（只差 size），所以兩者的構圖必然一致。
 *
 * @param ctx 目標畫布的 2D 內容（畫布應為 size×size）。
 * @param img 影像來源。
 * @param size 正方形邊長（像素）。
 * @param transform 裁切參數。
 */
export function drawCrop(
  ctx: CanvasRenderingContext2D,
  img: DecodedImage,
  size: number,
  transform: CropTransform,
): void {
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.imageSmoothingQuality = 'high';
  // 先移到中心並套用位移（位移單位是邊長的倍數，故乘上 size）。
  ctx.translate(size / 2 + transform.offsetX * size, size / 2 + transform.offsetY * size);
  ctx.rotate((transform.rotationDeg * Math.PI) / 180);
  const scale = coverBaseScale(img, size, transform.rotationDeg) * transform.zoom;
  ctx.scale(scale, scale);
  ctx.drawImage(img, -img.width / 2, -img.height / 2, img.width, img.height);
  ctx.restore();
}

/**
 * 依裁切參數輸出最終圖片的 data URI。
 *
 * @param img 影像來源。
 * @param transform 裁切參數。
 * @param size 輸出邊長（預設 {@link CROP_OUTPUT_SIZE}）。
 * @returns data URI（優先 WebP；瀏覽器不支援時退回 PNG）。
 * @throws Error 取不到 2D 內容時丟出。
 */
export function cropToDataUrl(
  img: DecodedImage,
  transform: CropTransform,
  size: number = CROP_OUTPUT_SIZE,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('瀏覽器不支援影像處理，無法裁切圖片');
  drawCrop(ctx, img, size, transform);
  // WebP 檔案小很多；少數舊瀏覽器不支援時 toDataURL 會靜默回 PNG，故用回傳值判斷而非假設成功。
  const webp = canvas.toDataURL('image/webp', 0.85);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}
