'use client';

import type React from 'react';
import { ColorPickerInline } from '@/components/ColorPicker';
import { parseTextExtra, type TextExtra } from './TextBox';

/** 純文字框的字色 / 背景「快選」常用色（只放 4 個；其餘點色盤球球展開挑）。 */
const TEXT_PRESET_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6'];

/**
 * 共用的「純文字框屬性面板」（筆記頁與開問啦畫布共用）：字級 ｜ 字色 ｜ 底 ｜ 刪除。
 * 顏色各只放 4 個快選＋一顆球球，點球球展開完整色盤。
 *
 * 純呈現元件：選取的文字框內容、色盤開合狀態與行為皆由父層以 props 傳入。
 * 回傳一個 fragment（屬性列 + 兩個色盤），通常放進 {@link DrawingToolbar} 的 topContent 插槽，
 * 疊在工具列上方。
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
  const lbl: React.CSSProperties = { color: 'var(--text-secondary)', whiteSpace: 'nowrap', marginLeft: 2 };
  const dividerStyle: React.CSSProperties = { width: 1, alignSelf: 'stretch', background: 'var(--border-default)', margin: '2px 3px' };

  return (
    <>
      <div
        data-draw-textprops
        data-testid={`${testIdPrefix}-textprops`}
        style={{
          display: 'flex', gap: 5, flexWrap: 'nowrap', alignItems: 'center', justifyContent: 'flex-end',
          background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)', padding: '5px 8px', boxShadow: 'var(--shadow-md)',
          fontSize: 'var(--text-xs)',
        }}
      >
        {/* 字級 */}
        <span style={lbl}>字級</span>
        <input
          type="range" min={10} max={80} value={te.fontSize}
          onChange={(e) => onUpdateExtra({ fontSize: Number(e.target.value) })}
          style={{ width: 72 }}
          title={`字級：${te.fontSize}`}
          data-testid={`${testIdPrefix}-text-fontsize`}
        />

        <span style={dividerStyle} />
        {/* 字色：4 快選 + 球球展開完整色盤 */}
        <span style={lbl}>字色</span>
        {TEXT_PRESET_COLORS.map((c) => (
          <button
            key={`fc-${c}`} onClick={() => onSetFontColor(c)} title="字體顏色"
            style={{
              width: 16, height: 16, flexShrink: 0, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
              border: curFont === c ? '2px solid var(--text-primary)' : '1px solid rgba(0,0,0,0.25)',
            }}
          />
        ))}
        <button
          data-draw-textcolorbtn data-testid={`${testIdPrefix}-text-fontball`} title="更多字色（展開色盤）"
          onClick={onToggleFontPop}
          style={{
            width: 18, height: 18, flexShrink: 0, borderRadius: '50%', background: curFont,
            border: '2px solid var(--text-tertiary)', cursor: 'pointer', padding: 0,
          }}
        />

        <span style={dividerStyle} />
        {/* 底：透明 + 4 快選 + 球球 */}
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
        {TEXT_PRESET_COLORS.map((c) => (
          <button
            key={`bg-${c}`} onClick={() => onUpdateExtra({ bg: c })} title="背景顏色"
            style={{
              width: 16, height: 16, flexShrink: 0, borderRadius: 4, background: c, cursor: 'pointer', padding: 0,
              border: te.bg === c ? '2px solid var(--text-primary)' : '1px solid rgba(0,0,0,0.25)',
            }}
          />
        ))}
        <button
          data-draw-textcolorbtn data-testid={`${testIdPrefix}-text-bgball`} title="更多背景色（展開色盤）"
          onClick={onToggleBgPop}
          style={{
            width: 18, height: 18, flexShrink: 0, borderRadius: '50%', cursor: 'pointer', padding: 0,
            border: '2px solid var(--text-tertiary)',
            background: te.bg ?? 'transparent',
            // 透明時用棋盤格表示「無背景」
            backgroundImage: te.bg ? undefined
              : 'linear-gradient(45deg, #bbb 25%, transparent 25%, transparent 75%, #bbb 75%), linear-gradient(45deg, #bbb 25%, #fff 25%, #fff 75%, #bbb 75%)',
            backgroundSize: '8px 8px', backgroundPosition: '0 0, 4px 4px',
          }}
        />

        <span style={dividerStyle} />
        {/* 刪除 */}
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

      {/* 字色完整色盤（點球球展開） */}
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
          />
        </div>
      )}
      {/* 背景完整色盤（點球球展開） */}
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
          />
        </div>
      )}
    </>
  );
}
