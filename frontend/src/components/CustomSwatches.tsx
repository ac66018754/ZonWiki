'use client';

import type React from 'react';
import { useState, useSyncExternalStore } from 'react';
import {
  type SwatchKey,
  MAX_SWATCHES,
  getSwatches,
  getDefaultSwatches,
  addSwatch,
  removeSwatchAt,
  setSwatchAt,
  subscribeSwatches,
} from '@/lib/customSwatches';

/**
 * 自訂色盤快選：一排「使用者存的常用色」＋「＋」存目前色＋「✎ 編輯」切換。
 *
 * 三組色盤（畫筆／文字字色／文字底色，見 {@link SwatchKey}）一律「空的」開始，由使用者自行加。
 * - 一般模式：左鍵點色塊 → 套用該色。
 * - 「＋」：把目前顏色（current）存進色盤（去重、上限 10）。
 * - 「✎ 編輯」→ 進入編輯模式：每個色塊右上出現「✕」可移除（觸控也能點）；點色塊本身 → 把該格改成目前顏色。
 *   （右鍵任何色塊亦可直接移除，桌機快捷。）
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
  /** 目前顏色（按「＋」／編輯模式點色塊時用這個色）；transparent／空值時不可存。 */
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
    () => getDefaultSwatches(storageKey),
  );
  const [editing, setEditing] = useState(false);

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
    // 目前色加粗框標示；其餘用中性描邊確保在任何底色上都看得到邊界。編輯模式一律加虛線框提示可改。
    border: editing
      ? '2px dashed var(--action-primary-bg, #2563eb)'
      : normalizedCurrent === c
        ? '2px solid var(--text-primary)'
        : '1px solid var(--border-strong, #999)',
  });

  /** 迷你「✕ 移除」徽章（編輯模式時疊在色塊右上角，觸控可點）。 */
  const removeBadgeStyle: React.CSSProperties = {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 14,
    height: 14,
    lineHeight: '12px',
    fontSize: 10,
    borderRadius: '50%',
    border: '1px solid var(--bg-surface)',
    background: 'var(--status-danger-fg, #dc2626)',
    color: '#fff',
    cursor: 'pointer',
    padding: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const toolBtnStyle = (active: boolean): React.CSSProperties => ({
    width: size,
    height: size,
    flexShrink: 0,
    borderRadius: radius,
    border: active ? '1px solid var(--action-primary-bg, #2563eb)' : '1px dashed var(--border-strong, #999)',
    background: active ? 'var(--action-primary-bg, #2563eb)' : 'transparent',
    color: active ? 'var(--action-primary-fg, #fff)' : 'var(--text-secondary)',
    cursor: 'pointer',
    fontSize: Math.round(size * 0.62),
    lineHeight: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  });

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }} data-custom-swatches={storageKey}>
      {colors.length === 0 && (
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
          用「＋」把常用色存進來
        </span>
      )}
      {colors.map((c, i) => (
        <span key={`${c}-${i}`} style={{ position: 'relative', display: 'inline-flex' }}>
          <button
            type="button"
            onClick={() => {
              if (editing) {
                // 編輯模式：把這格改成目前顏色（沒有目前色就不動）。
                if (normalizedCurrent) setSwatchAt(storageKey, i, normalizedCurrent);
              } else {
                onApply(c);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              removeSwatchAt(storageKey, i);
            }}
            title={editing ? `${c}（點色塊＝改成目前顏色・✕＝移除）` : `${c}（點擊套用・右鍵移除）`}
            style={swatchStyle(c)}
          />
          {editing && (
            <button
              type="button"
              onClick={() => removeSwatchAt(storageKey, i)}
              title="移除此色"
              aria-label="移除此色"
              style={removeBadgeStyle}
            >
              ✕
            </button>
          )}
        </span>
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
          style={{ ...toolBtnStyle(false), opacity: canAdd ? 1 : 0.45, cursor: canAdd ? 'pointer' : 'not-allowed' }}
        >
          ＋
        </button>
      )}
      {colors.length > 0 && (
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          title={editing ? '完成編輯' : '編輯色盤（移除／改色）'}
          aria-label={editing ? '完成編輯色盤' : '編輯色盤'}
          aria-pressed={editing}
          style={toolBtnStyle(editing)}
        >
          {editing ? '✓' : '✎'}
        </button>
      )}
    </div>
  );
}
