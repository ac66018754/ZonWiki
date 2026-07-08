'use client';

import type React from 'react';
import { useSyncExternalStore } from 'react';
import {
  type SwatchKey,
  MAX_SWATCHES,
  getSwatches,
  getDefaultSwatches,
  addSwatch,
  removeSwatchAt,
  subscribeSwatches,
} from '@/lib/customSwatches';

/**
 * 自訂色盤快選：一排「使用者存的常用色」＋一顆「＋」把目前顏色存進色盤。
 *
 * 取代固定的預設色（畫筆／形狀、文字字色、文字底色各自一組，見 {@link SwatchKey}）。
 * - 左鍵點色塊：套用該色。
 * - 右鍵點色塊：從色盤移除該色。
 * - 「＋」：把目前顏色（current）存進色盤（去重、上限 10）。
 *
 * 以模組層存放區（customSwatches.ts）即時同步：工具列內嵌快選與展開色盤裡的同一組色盤會連動。
 */
export function CustomSwatches({
  storageKey,
  current,
  onApply,
  square = false,
  size = 18,
}: {
  /** 色盤命名空間（pen／text-font／text-bg）。 */
  storageKey: SwatchKey;
  /** 目前顏色（按「＋」時存這個色）；transparent／空值時不可存。 */
  current?: string | null;
  /** 點色塊套用顏色。 */
  onApply: (hex: string) => void;
  /** 底色類色塊用圓角方形（true），前景色用圓形（false）。 */
  square?: boolean;
  /** 色塊邊長（px）。 */
  size?: number;
}) {
  // 以 external store 訂閱：任一處改動色盤，所有實體即時重繪（回傳穩定參照，不會無限重繪）。
  const colors = useSyncExternalStore(
    (cb) => subscribeSwatches(storageKey, cb),
    () => getSwatches(storageKey),
    // getServerSnapshot：回傳固定預設（不讀 localStorage），避免萬一在 SSR/hydration 邊界渲染時
    // client 端讀到與 server 不同的值而 hydration mismatch（目前兩個呼叫點都已用 ssr:false/mounted 閘門規避）。
    () => getDefaultSwatches(storageKey),
  );

  const normalizedCurrent = current && current !== 'transparent' ? current : null;
  const canAdd = !!normalizedCurrent && !colors.includes(normalizedCurrent) && colors.length < MAX_SWATCHES;
  const radius = square ? 4 : '50%';

  const swatchStyle = (c: string): React.CSSProperties => ({
    width: size,
    height: size,
    flexShrink: 0,
    borderRadius: radius,
    background: c,
    padding: 0,
    cursor: 'pointer',
    // 目前色加粗框標示；其餘用中性描邊確保在任何底色上都看得到邊界。
    border: normalizedCurrent === c ? '2px solid var(--text-primary)' : '1px solid var(--border-strong, #999)',
  });

  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }} data-custom-swatches={storageKey}>
      {colors.map((c, i) => (
        <button
          key={`${c}-${i}`}
          type="button"
          onClick={() => onApply(c)}
          onContextMenu={(e) => {
            // 右鍵移除此色（不跳系統選單）。
            e.preventDefault();
            removeSwatchAt(storageKey, i);
          }}
          title={`${c}（點擊套用・右鍵移除）`}
          style={swatchStyle(c)}
        />
      ))}
      {colors.length < MAX_SWATCHES && (
        <button
          type="button"
          onClick={() => normalizedCurrent && addSwatch(storageKey, normalizedCurrent)}
          disabled={!canAdd}
          title={
            canAdd
              ? '把目前顏色存進色盤'
              : normalizedCurrent
                ? '目前顏色已在色盤中'
                : '先選一個顏色才能儲存'
          }
          aria-label="儲存目前顏色到色盤"
          style={{
            width: size,
            height: size,
            flexShrink: 0,
            borderRadius: radius,
            border: '1px dashed var(--border-strong, #999)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: canAdd ? 'pointer' : 'not-allowed',
            opacity: canAdd ? 1 : 0.45,
            fontSize: Math.round(size * 0.72),
            lineHeight: 1,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
        >
          ＋
        </button>
      )}
    </div>
  );
}
