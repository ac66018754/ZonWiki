'use client';

import type React from 'react';
import { ColorPickerInline } from '@/components/ColorPicker';
import { CustomSwatches } from '@/components/CustomSwatches';
import { parseTextExtra, type TextExtra } from './TextBox';

/**
 * 共用的「純文字框屬性面板」（筆記頁與開問啦畫布共用）。
 *
 * 版面（依使用者要求）拆成三排：
 *   第一排：字級（＋右側刪除鈕）
 *   第二排：字色（使用者自訂 10 色快選 ＋ 球球展開完整色盤）
 *   第三排：底（透明 ＋ 使用者自訂 10 色快選 ＋ 球球展開完整色盤）
 *
 * 字色與底色各自一組獨立的自訂色盤（見 CustomSwatches / customSwatches.ts），不再沿用固定預設色。
 *
 * 純呈現元件：選取的文字框內容、色盤開合狀態與行為皆由父層以 props 傳入。
 * 回傳一個 fragment（屬性面板 + 兩個完整色盤），通常放進 {@link import('./DrawingToolbar').DrawingToolbar}
 * 的 topContent 插槽，疊在工具列上方。
 */
export function TextPropsPanel({
  fontColor,
  dataJson,
  onSetFontColor,
  onUpdateExtra,
  showFontPop,
  showBgPop,
  onToggleFontPop,
  onToggleBgPop,
  onDelete,
  testIdPrefix,
}: {
  /** 目前文字框字色。 */
  fontColor: string;
  /** 目前文字框的 dataJson（解析出 bg / fontSize / rotation）。 */
  dataJson?: string | null;
  onSetFontColor: (hex: string) => void;
  onUpdateExtra: (patch: Partial<TextExtra>) => void;
  showFontPop: boolean;
  showBgPop: boolean;
  /** 切換字色完整色盤（會順手關閉背景色盤）。 */
  onToggleFontPop: () => void;
  /** 切換背景完整色盤（會順手關閉字色色盤）。 */
  onToggleBgPop: () => void;
  onDelete: () => void;
  testIdPrefix: string;
}) {
  const te = parseTextExtra(dataJson);
  const curFont = fontColor || '#ef4444';
  const lbl: React.CSSProperties = { color: 'var(--text-secondary)', whiteSpace: 'nowrap', minWidth: 28 };
  const rowStyle: React.CSSProperties = { display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' };
  const ballBase: React.CSSProperties = {
    width: 18, height: 18, flexShrink: 0, borderRadius: '50%', cursor: 'pointer', padding: 0,
    border: '2px solid var(--text-tertiary)',
  };

  return (
    <>
      <div
        data-draw-textprops
        data-testid={`${testIdPrefix}-textprops`}
        style={{
          display: 'flex', flexDirection: 'column', gap: 6,
          background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)', padding: '6px 8px', boxShadow: 'var(--shadow-md)',
          fontSize: 'var(--text-xs)', minWidth: 210,
        }}
      >
        {/* 第一排：字級（＋刪除鈕靠右） */}
        <div style={rowStyle}>
          <span style={lbl}>字級</span>
          <input
            type="range" min={10} max={80} value={te.fontSize}
            onChange={(e) => onUpdateExtra({ fontSize: Number(e.target.value) })}
            style={{ width: 96 }}
            title={`字級：${te.fontSize}`}
            data-testid={`${testIdPrefix}-text-fontsize`}
          />
          <span style={{ flex: 1 }} />
          <button
            className="tk-btn"
            style={{ cursor: 'pointer', fontSize: 'var(--text-sm)', padding: '1px 6px', flexShrink: 0 }}
            onClick={onDelete}
            title="刪除此文字框"
            data-testid={`${testIdPrefix}-text-delete`}
          >
            🗑
          </button>
        </div>

        {/* 第二排：字色（自訂 10 色 + 球球展開完整色盤） */}
        <div style={{ ...rowStyle, borderTop: '1px solid var(--border-default)', paddingTop: 6 }}>
          <span style={lbl}>字色</span>
          <CustomSwatches storageKey="text-font" current={curFont} onApply={onSetFontColor} size={16} />
          <button
            data-draw-textcolorbtn data-testid={`${testIdPrefix}-text-fontball`} title="更多字色（展開色盤）"
            onClick={onToggleFontPop}
            style={{ ...ballBase, background: curFont }}
          />
        </div>

        {/* 第三排：底（透明 + 自訂 10 色 + 球球展開完整色盤） */}
        <div style={{ ...rowStyle, borderTop: '1px solid var(--border-default)', paddingTop: 6 }}>
          <span style={lbl}>底</span>
          <button
            className={`tk-btn ${te.bg ? '' : 'tk-btn--primary'}`}
            style={{ cursor: 'pointer', fontSize: 'var(--text-xs)', padding: '1px 6px', flexShrink: 0 }}
            onClick={() => onUpdateExtra({ bg: null })}
            title="背景透明"
            data-testid={`${testIdPrefix}-text-bg-none`}
          >
            透明
          </button>
          <CustomSwatches storageKey="text-bg" current={te.bg} onApply={(hex) => onUpdateExtra({ bg: hex })} square size={16} />
          <button
            data-draw-textcolorbtn data-testid={`${testIdPrefix}-text-bgball`} title="更多背景色（展開色盤）"
            onClick={onToggleBgPop}
            style={{
              ...ballBase,
              background: te.bg ?? 'transparent',
              // 透明時用棋盤格表示「無背景」
              backgroundImage: te.bg ? undefined
                : 'linear-gradient(45deg, #bbb 25%, transparent 25%, transparent 75%, #bbb 75%), linear-gradient(45deg, #bbb 25%, #fff 25%, #fff 75%, #bbb 75%)',
              backgroundSize: '8px 8px', backgroundPosition: '0 0, 4px 4px',
            }}
          />
        </div>
      </div>

      {/* 字色完整色盤（點球球展開；快選＝自訂 text-font 色盤） */}
      {showFontPop && (
        <div
          data-draw-textpop data-testid={`${testIdPrefix}-text-fontpop`}
          style={{
            width: 220, background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', padding: 8,
          }}
        >
          <ColorPickerInline
            initial={curFont}
            onChange={(hex) => onSetFontColor(hex)}
            onPick={(hex) => onSetFontColor(hex)}
            swatchKey="text-font"
          />
        </div>
      )}
      {/* 背景完整色盤（點球球展開；快選＝自訂 text-bg 色盤） */}
      {showBgPop && (
        <div
          data-draw-textpop data-testid={`${testIdPrefix}-text-bgpop`}
          style={{
            width: 220, background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', padding: 8,
          }}
        >
          <ColorPickerInline
            initial={te.bg ?? '#ffffff'}
            onChange={(hex) => onUpdateExtra({ bg: hex })}
            onPick={(hex) => onUpdateExtra({ bg: hex })}
            swatchKey="text-bg"
          />
        </div>
      )}
    </>
  );
}
