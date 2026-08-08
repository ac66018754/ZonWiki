/**
 * 共用「快速連點兩下右鍵」判定器。
 *
 * 對應設計文件《互動表格與讀模式直編設計》§3.4：讀模式的儲存格直編與程式碼區塊直編
 * 都以「雙右鍵」觸發，沿用 MarkdownEditor 被測試釘死的慣例（500ms、Date.now()）。
 * MarkdownEditor.tsx 內的既有實作留在原地不動（避免動 12 個呼叫端）；
 * 新功能一律改用本模組。
 */

/**
 * 「快速連點兩下右鍵」判定的間隔上限（毫秒）。
 * 與 MarkdownEditor.tsx:18 的 DOUBLE_RIGHT_CLICK_MS 對齊（兩處必須同值，慣例已被測試釘死）。
 * 間隔判定 pin 在 Date.now()——不可改用 event.timeStamp / performance.now()，
 * 單元測試以 vi.spyOn(Date, 'now') 控制間隔，換來源會讓測試控不到時間。
 */
export const DOUBLE_RIGHT_CLICK_MS = 500;

/**
 * 判定器需要讀的最小事件形狀（真實 MouseEvent 與測試替身皆滿足）。
 */
export type ContextMenuEventLike = {
  /** 事件是否已被其他監聽器 preventDefault（NoteOverlay 繪圖取消會先吃掉右鍵）。 */
  defaultPrevented: boolean;
};

/**
 * createDoubleRightClickTracker 回傳的判定器介面。
 */
export type DoubleRightClickTracker<TEvent extends ContextMenuEventLike> = {
  /** 每次 contextmenu 事件呼叫一次；累積到兩擊（間隔 ≤ 500ms）即觸發 onTrigger。 */
  handleContextMenu: (event: TEvent) => void;
  /** 手動歸零計數（例如指標離開目標區域時）。 */
  reset: () => void;
};

/**
 * 建立一個「快速連點兩下右鍵」判定器。
 *
 * 規則：
 * - 兩次有效右鍵間隔 ≤ DOUBLE_RIGHT_CLICK_MS（500ms）→ 呼叫 onTrigger（帶第二擊的事件）。
 * - `event.defaultPrevented` 為真＝已被別人吃掉（如 NoteOverlay 繪圖模式的「右鍵＝取消」在
 *   document capture 階段先 preventDefault）→ 這一擊不計數，也不打斷原本進行中的計數。
 * - 觸發後歸零：第三擊會重新開始計數，不會連鎖觸發。
 * - 超時的一擊不觸發，但成為新的第一擊（與 MarkdownEditor 既有行為一致）。
 *
 * ⚠️ 呼叫順序注意：呼叫端若要自行 preventDefault（右鍵抑制範圍＝表格與程式碼區塊內），
 * 必須「先」呼叫 handleContextMenu 再 preventDefault——順序反了每一擊都會被誤判為已被吃掉。
 *
 * @param onTrigger 兩擊成立時的回呼；參數為觸發那一擊（第二擊）的事件物件。
 * @returns 判定器（handleContextMenu／reset）；每個目標區域各建一個實例，互不干擾。
 */
export function createDoubleRightClickTracker<TEvent extends ContextMenuEventLike>(
  onTrigger: (event: TEvent) => void
): DoubleRightClickTracker<TEvent> {
  /** 上一次「有效右鍵」的時間戳（Date.now() 毫秒）；null＝尚無前一擊。 */
  let lastRightClickAt: number | null = null;

  const handleContextMenu = (event: TEvent): void => {
    if (event.defaultPrevented) return; // 已被別人吃掉 → 不計數

    const now = Date.now();
    if (lastRightClickAt !== null && now - lastRightClickAt <= DOUBLE_RIGHT_CLICK_MS) {
      lastRightClickAt = null; // 觸發後歸零
      onTrigger(event);
      return;
    }
    lastRightClickAt = now; // 第一擊（或超時後重新起算）
  };

  const reset = (): void => {
    lastRightClickAt = null;
  };

  return { handleContextMenu, reset };
}
