/**
 * 浮層元件共用常數與樣式（便利貼 / 圖片板）。
 * 由 NoteOverlay 抽出，讓筆記頁浮層與開問啦畫布標註共用。
 */

/** 便利貼可選底色。 */
export const STICKY_COLORS = ['#fff9c4', '#ffe0b2', '#c8e6c9', '#bbdefb', '#f8bbd0', '#e1bee7'];

/** 便利貼/圖片板元件吃的最小資料形狀（NoteOverlayItem 與 CanvasAnnotationItem 皆滿足）。 */
export interface OverlayItemView {
  /** 便利貼底色。 */
  color?: string | null;
  /** 便利貼文字。 */
  text?: string | null;
  /** 型別專屬資料 JSON：slide→圖片清單（見 {@link parseSlideData}）。 */
  dataJson?: string | null;
}

/**
 * 圖片板 dataJson 的解析結果：標題 ＋ 圖片清單。
 * 相容兩種格式：
 * - 舊格式：純圖片陣列 `["url1","url2"]`（無標題）。
 * - 新格式：物件 `{ title?: string, images: string[] }`（可自訂標題）。
 */
export interface SlideData {
  /** 圖片板自訂標題（未設為空字串）。 */
  title: string;
  /** 圖片清單（網址或 data URL）。 */
  images: string[];
}

/**
 * 安全解析圖片板 dataJson（相容舊的「純陣列」與新的 `{title, images}` 物件格式）。
 * @param dataJson 圖片板 NoteOverlayItem.dataJson。
 * @returns 標題與圖片清單；解析失敗回 `{ title: '', images: [] }`。
 */
export function parseSlideData(dataJson: string | null | undefined): SlideData {
  if (!dataJson) return { title: '', images: [] };
  try {
    const parsed = JSON.parse(dataJson);
    // 舊格式：純陣列。
    if (Array.isArray(parsed)) {
      return { title: '', images: parsed.filter((x): x is string => typeof x === 'string') };
    }
    // 新格式：物件（含標題）。
    if (parsed && typeof parsed === 'object') {
      const images = Array.isArray((parsed as { images?: unknown }).images)
        ? ((parsed as { images: unknown[] }).images.filter((x): x is string => typeof x === 'string'))
        : [];
      const title = typeof (parsed as { title?: unknown }).title === 'string'
        ? (parsed as { title: string }).title
        : '';
      return { title, images };
    }
  } catch {
    /* 格式錯誤 → 視為空 */
  }
  return { title: '', images: [] };
}

/** 圖片板左右切換鈕的定位樣式。 */
export function navBtn(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute', top: '50%', transform: 'translateY(-50%)', [side]: 4,
    width: 22, height: 22, borderRadius: '50%', border: 'none', cursor: 'pointer',
    background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 16, lineHeight: '1',
  } as React.CSSProperties;
}
