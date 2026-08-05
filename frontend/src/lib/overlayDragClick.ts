/**
 * 便利貼/圖片板 top bar 的「點擊 vs 拖曳」判定器。
 *
 * 需求背景：點一下 top bar 要能切換收合/展開，但按住拖曳仍要能移動整張便利貼。
 * 兩者共用同一個 pointerdown 起點，故以「位移閾值」區分：
 * - pointermove 未超過閾值前是「死區」——不套用移動（避免手指/滑鼠微晃把便利貼推歪）；
 * - 一旦任一軸位移達到閾值即進入「拖曳」，之後所有 move 都套用，且放開時不再視為點擊
 *   （即使拖回原點也不退回點擊——使用者已表達「我在拖」的意圖）。
 *
 * 注意：每次 pointerdown 都必須「新建」一個 tracker（閉包狀態只活一個手勢），
 * 絕不可提升為模組層級單例——否則第一次拖曳後所有點擊都會被永久誤判為拖曳。
 */

/**
 * 點擊/拖曳的位移閾值（螢幕像素）。
 * 沿用專案既有拖曳把手慣例 8px（見 SubtaskChecklist 的拖曳排序），
 * 桌機滑鼠與手機觸控（手指按壓時的自然晃動較大）皆適用。
 * 畫布（有 zoom）情境請餵「除以 zoom 之前」的螢幕位移，讓點擊容忍度不隨縮放改變。
 */
export const CLICK_DRAG_THRESHOLD_PX = 8;

/** 判定器介面：move 回報是否應套用位移；isClick 於放開時判定是否視為點擊。 */
export interface DragClickTracker {
  /**
   * 回報一次 pointermove 的「累計」位移（相對 pointerdown 起點的螢幕像素）。
   * @param dxPx 相對起點的水平位移（px，可為負值與浮點）。
   * @param dyPx 相對起點的垂直位移（px，可為負值與浮點）。
   * @returns 是否應套用這次移動（false＝仍在死區，呼叫端應直接略過本次 move）。
   */
  move(dxPx: number, dyPx: number): boolean;
  /**
   * 放開（pointerup）時判定：整個手勢是否從未超過閾值＝「點擊」。
   * 純讀取、可重複呼叫，結果只由先前的 move 歷史決定。
   * @returns true＝點擊（呼叫端可切換收合/展開、跳過座標持久化）；false＝拖曳。
   */
  isClick(): boolean;
}

/**
 * 建立一個「單一手勢」生命週期的點擊/拖曳判定器。
 * @param thresholdPx 位移閾值（px），任一軸絕對值「達到」（>=）即視為拖曳；預設 {@link CLICK_DRAG_THRESHOLD_PX}。
 *   （注意：threshold=0 代表只要呼叫過一次 move 就是拖曳，與「完全沒 move」的點擊有別。）
 * @returns 判定器實例（每次 pointerdown 各自新建，互不干擾）。
 */
export function createDragClickTracker(thresholdPx: number = CLICK_DRAG_THRESHOLD_PX): DragClickTracker {
  // 是否已超過閾值（進入拖曳）；一旦為 true 即不可逆。
  let dragging = false;
  return {
    move(dxPx: number, dyPx: number): boolean {
      if (!dragging && Math.abs(dxPx) < thresholdPx && Math.abs(dyPx) < thresholdPx) {
        return false; // 死區：不套用移動，維持「可能是點擊」的狀態。
      }
      dragging = true;
      return true;
    },
    isClick(): boolean {
      return !dragging;
    },
  };
}
