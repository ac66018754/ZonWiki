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
  /** 型別專屬資料 JSON：slide→圖片清單。 */
  dataJson?: string | null;
}

/** 圖片板左右切換鈕的定位樣式。 */
export function navBtn(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute', top: '50%', transform: 'translateY(-50%)', [side]: 4,
    width: 22, height: 22, borderRadius: '50%', border: 'none', cursor: 'pointer',
    background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 16, lineHeight: '1',
  } as React.CSSProperties;
}
