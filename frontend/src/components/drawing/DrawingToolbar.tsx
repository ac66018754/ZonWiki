'use client';

import type React from 'react';
import { useState } from 'react';
import { ColorPickerInline } from '@/components/ColorPicker';
import type { DrawTool } from '@/lib/drawing/shapes';

/**
 * 「畫筆/螢光筆」共用顏色按鈕適用的工具（顏色對所有手繪形狀都有意義）。
 */
function isColorTool(tool: DrawTool): boolean {
  return tool === 'pen' || tool === 'highlight' || tool === 'line' || tool === 'rect' || tool === 'ellipse';
}
/** 是否為「虛線」適用工具（螢光筆不提供虛線）。 */
function isDashTool(tool: DrawTool): boolean {
  return tool === 'pen' || tool === 'line' || tool === 'rect' || tool === 'ellipse';
}
/** 是否要顯示線寬滑桿（含局部橡皮擦的擦除半徑）。 */
function isWidthTool(tool: DrawTool): boolean {
  return isColorTool(tool) || tool === 'erase-area';
}

/** 第一格（Row1 最左）的設定：筆記＝「目錄」、開問啦＝「工具箱（收合）」。 */
export interface LeadingSlot {
  /** 顯示文字（例如「📖 目錄」「🧰」）。 */
  label: React.ReactNode;
  /** 滑鼠移上去的提示。 */
  title: string;
  /** 點擊行為。 */
  onClick: () => void;
  /** 是否處於「開啟中（On）」狀態 → 加深底色（例如目錄正開著）。 */
  active?: boolean;
  /** data-testid。 */
  testId?: string;
}

/**
 * 共用的右下角手繪工具列（筆記頁與開問啦畫布共用同一版面，避免兩份走樣）。
 *
 * 版面固定為三列（依使用者規格）：
 *   Row1：目錄/工具箱 ｜ 便利貼 ｜ 圖片板
 *   Row2：畫筆 ｜ 螢光筆 ｜ 直線 ｜ 矩形 ｜ 橢圓 ｜ 文字
 *   Row3：局部橡皮擦 ｜ 整體橡皮擦 ｜ 框選橡皮擦 ｜ 清除全部手繪
 * 之後是「情境控制列」（顏色/線寬/透明度/虛線/微調提示 + 各端專屬按鈕 + 完成），
 * 以及點顏色球球展開的完整色盤（往上開）。
 *
 * 本元件為純呈現（presentational）：所有狀態與行為由父層（NoteOverlay / CanvasAnnotationLayer）透過 props 傳入，
 * 確保兩端行為一致、未來改工具只需改這一處。
 */
export function DrawingToolbar({
  position,
  maxWidth = 320,
  leading,
  onAddSticky,
  onAddSlide,
  onAddText,
  tool,
  onSelectTool,
  penColor,
  showPenColor,
  onTogglePenColor,
  onPenColorChange,
  penWidth,
  onPenWidthChange,
  penDash,
  onToggleDash,
  highlightOpacity,
  onHighlightOpacityChange,
  highlightStraight,
  onToggleHighlightStraight,
  adjustHint,
  eraseRadius,
  selectedShapeIdx,
  hasShapes,
  onClear,
  drawingActive,
  onDone,
  extraControls,
  topContent,
  testIdPrefix,
}: {
  /** 固定定位（兩端不同：筆記 bottom:24/right:24、開問啦 bottom:168/right:16）。 */
  position: { bottom: number; right: number };
  /** 面板最大寬度。 */
  maxWidth?: number;
  leading: LeadingSlot;
  onAddSticky: () => void;
  onAddSlide: () => void;
  onAddText: () => void;
  tool: DrawTool;
  onSelectTool: (t: Exclude<DrawTool, null>) => void;
  penColor: string;
  showPenColor: boolean;
  onTogglePenColor: () => void;
  onPenColorChange: (hex: string) => void;
  penWidth: number;
  onPenWidthChange: (w: number) => void;
  penDash: boolean;
  onToggleDash: () => void;
  /** 螢光筆透明度（0~1）。 */
  highlightOpacity: number;
  onHighlightOpacityChange: (o: number) => void;
  /** 螢光筆「直線模式」是否開啟（可選；與 onToggleHighlightStraight 一起提供才顯示開關）。 */
  highlightStraight?: boolean;
  /** 切換螢光筆直線模式（可選；未提供＝該端不支援此功能，不顯示開關）。 */
  onToggleHighlightStraight?: () => void;
  /** 「調整中」的提示文字（可選；提供時取代預設的「調整剛畫的圖形」提示）。 */
  adjustHint?: string;
  /** 局部橡皮擦目前半徑（顯示用）。 */
  eraseRadius: number;
  /** 「剛畫完、可即時微調」的形狀索引（null＝無）。 */
  selectedShapeIdx: number | null;
  /** 是否已有手繪（決定「清除全部」是否可按）。 */
  hasShapes: boolean;
  onClear: () => void;
  /** 是否正在使用某個繪圖工具。 */
  drawingActive: boolean;
  onDone: () => void;
  /** 各端專屬的額外控制（例如筆記的「歸位 / ＋高 / −高」）。 */
  extraControls?: React.ReactNode;
  /** 疊在工具列「上方」的內容（例如選取文字框時的屬性面板）。 */
  topContent?: React.ReactNode;
  /** data-testid 前綴（筆記＝overlay、開問啦＝canvas-anno）。 */
  testIdPrefix: string;
}) {
  const isHighlight = tool === 'highlight';
  const showColor = isColorTool(tool);

  // 整個工具列的「收合」狀態（預設展開）。收合後只剩右上角的展開鈕，省畫面、避免擋住內容。
  // 為純呈現元件的局部 UI 狀態，與繪圖/便利貼等業務狀態無關，故放元件內部即可。
  const [collapsed, setCollapsed] = useState(false);

  /** Row2 的繪圖工具（含「文字」動作鈕）。 */
  const drawTools: [Exclude<DrawTool, null>, string, string][] = [
    ['pen', '✏️', '畫筆（自由筆）'],
    ['highlight', '🖍️', '螢光筆（半透明，可調透明度）'],
    ['line', '／', '直線'],
    ['rect', '▭', '矩形'],
    ['ellipse', '◯', '橢圓'],
  ];
  /** Row3 的橡皮擦（依規格順序：局部 → 整體 → 框選）。 */
  const eraseTools: [Exclude<DrawTool, null>, string, string][] = [
    ['erase-area', '🧽', '橡皮擦：局部擦除（擦到哪、那裏消失）'],
    ['erase-stroke', '🧹', '橡皮擦：整體刪除（點一筆即刪整筆）'],
    ['erase-box', '⬚', '橡皮擦：框選擦除（框到哪、那裏消失，同一形狀不連帶整個刪除）'],
  ];

  const rowStyle: React.CSSProperties = {
    display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'flex-start', flexWrap: 'nowrap',
  };

  const renderToolBtn = ([t, icon, label]: [Exclude<DrawTool, null>, string, string]) => (
    <button
      key={t}
      className={`tk-btn ${tool === t ? 'tk-btn--primary' : ''}`}
      style={{ cursor: 'pointer' }}
      title={label}
      onClick={() => onSelectTool(t)}
      data-testid={`${testIdPrefix}-tool-${t}`}
    >
      {icon}
    </button>
  );

  return (
    <div
      style={{
        position: 'fixed', bottom: position.bottom, right: position.right, zIndex: 1400, pointerEvents: 'auto',
        display: 'flex', flexDirection: 'column-reverse', gap: 4, alignItems: 'flex-end',
      }}
      data-testid={`${testIdPrefix}-toolbar`}
    >
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 4,
        background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)', padding: 4, boxShadow: 'var(--shadow-md)', maxWidth,
      }}>
        {/* 右上角：收合／展開整個工具列（預設展開）。收合時順手結束繪圖，避免工具列收起、畫布卻仍鎖住。 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="tk-btn"
            style={{ cursor: 'pointer', padding: '0 6px', lineHeight: 1.4 }}
            onClick={() =>
              setCollapsed((prev) => {
                const next = !prev;
                if (next && drawingActive) onDone();
                return next;
              })
            }
            title={collapsed ? '展開工具列' : '收合工具列'}
            aria-label={collapsed ? '展開工具列' : '收合工具列'}
            aria-expanded={!collapsed}
            data-testid={`${testIdPrefix}-toolbar-collapse`}
          >
            {collapsed ? '▴' : '▾'}
          </button>
        </div>

        {!collapsed && (
          <>
        {/* Row1：目錄/工具箱 ｜ 便利貼 ｜ 圖片板 */}
        <div style={rowStyle}>
          <button
            className={`tk-btn ${leading.active ? 'tk-btn--primary' : ''}`}
            style={{ cursor: 'pointer' }}
            onClick={leading.onClick}
            title={leading.title}
            data-testid={leading.testId}
          >
            {leading.label}
          </button>
          <button className="tk-btn" style={{ cursor: 'pointer' }} onClick={onAddSticky} title="新增便利貼" data-testid={`${testIdPrefix}-add-sticky`}>＋便利貼</button>
          <button className="tk-btn" style={{ cursor: 'pointer' }} onClick={onAddSlide} title="新增圖片板（可放多張圖、手動切換）" data-testid={`${testIdPrefix}-add-slide`}>＋圖片板</button>
        </div>

        {/* Row2：畫筆 ｜ 螢光筆 ｜ 直線 ｜ 矩形 ｜ 橢圓 ｜ 文字 */}
        <div style={rowStyle}>
          {drawTools.map(renderToolBtn)}
          <button
            className="tk-btn"
            style={{ cursor: 'pointer', fontWeight: 700 }}
            onClick={onAddText}
            title="新增純文字框（可打字、設背景顏色/透明、旋轉縮放、調字級字色）"
            data-testid={`${testIdPrefix}-add-text`}
          >
            T
          </button>
        </div>

        {/* Row3：局部橡皮擦 ｜ 整體橡皮擦 ｜ 框選橡皮擦 ｜ 清除全部手繪 */}
        <div style={rowStyle}>
          {eraseTools.map(renderToolBtn)}
          <button
            className="tk-btn"
            style={{ cursor: 'pointer', opacity: hasShapes ? 1 : 0.4 }}
            onClick={onClear}
            disabled={!hasShapes}
            title="清除全部手繪（可 Ctrl+Z 復原）"
            data-testid={`${testIdPrefix}-clear`}
          >
            清除全部
          </button>
        </div>

        {/* 情境控制列：顏色／線寬／透明度／虛線／微調提示 + 各端專屬鈕 + 完成 */}
        {(showColor || tool === 'erase-area' || drawingActive || extraControls) && (
          <div style={{ ...rowStyle, flexWrap: 'wrap', borderTop: '1px solid var(--border-default)', paddingTop: 4 }}>
            {showColor && (
              <button
                title={isHighlight ? '螢光筆顏色' : '畫筆顏色'}
                onClick={onTogglePenColor}
                data-testid={`${testIdPrefix}-pen-color`}
                data-draw-colorbtn
                style={{ width: 18, height: 18, flexShrink: 0, borderRadius: '50%', background: penColor, border: '1px solid var(--border-strong, #999)', cursor: 'pointer' }}
              />
            )}
            {isWidthTool(tool) && (
              <input
                type="range" min={1} max={isHighlight ? 40 : 20} value={penWidth}
                onChange={(e) => onPenWidthChange(Number(e.target.value))}
                title={tool === 'erase-area' ? `橡皮擦大小：${eraseRadius}` : `線寬：${penWidth}`}
                style={{ width: 70 }}
                data-testid={`${testIdPrefix}-pen-width`}
              />
            )}
            {isHighlight && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }} title={`透明度：${Math.round(highlightOpacity * 100)}%`}>
                透明
                <input
                  type="range" min={10} max={90} value={Math.round(highlightOpacity * 100)}
                  onChange={(e) => onHighlightOpacityChange(Number(e.target.value) / 100)}
                  style={{ width: 60 }}
                  data-testid={`${testIdPrefix}-hl-opacity`}
                />
              </label>
            )}
            {/* 螢光筆「直線模式」開關（僅在該端有提供切換回呼時顯示）。 */}
            {isHighlight && onToggleHighlightStraight && (
              <button
                className={`tk-btn ${highlightStraight ? 'tk-btn--primary' : ''}`}
                style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
                title={highlightStraight ? '直線模式：開（拖曳畫出筆直的螢光線）' : '直線模式：關（自由手繪螢光筆）'}
                onClick={onToggleHighlightStraight}
                data-testid={`${testIdPrefix}-hl-straight`}
              >
                📏 直線
              </button>
            )}
            {isDashTool(tool) && (
              <button
                className={`tk-btn ${penDash ? 'tk-btn--primary' : ''}`}
                style={{ cursor: 'pointer' }}
                title="虛線 / 實線"
                onClick={onToggleDash}
              >
                {penDash ? '┄' : '—'}
              </button>
            )}
            {selectedShapeIdx !== null && showColor && (
              <span
                style={{ fontSize: 'var(--text-xs)', color: 'var(--action-secondary-fg)', whiteSpace: 'nowrap' }}
                title="可直接調整工具列的顏色 / 線寬 / 虛線，會即時套用到剛畫的圖形"
                data-testid={`${testIdPrefix}-adjust-hint`}
              >
                ✎ {adjustHint ?? '調整剛畫的圖形'}
              </span>
            )}
            {extraControls}
            {drawingActive && (
              <button className="tk-btn" style={{ cursor: 'pointer' }} onClick={onDone} title="結束繪圖（回到一般互動）" data-testid={`${testIdPrefix}-done`}>完成</button>
            )}
          </div>
        )}
          </>
        )}
      </div>

      {/* 顏色完整色盤（點顏色球球展開；往上開、留在畫面內）。選色後不自動關閉（連續調色）。 */}
      {!collapsed && showPenColor && showColor && (
        <div
          data-draw-colorpop
          style={{
            width: 220, background: 'var(--bg-surface)', border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', padding: 8,
          }}
        >
          <ColorPickerInline
            initial={penColor}
            onChange={(hex) => onPenColorChange(hex)}
            onPick={(hex) => onPenColorChange(hex)}
            swatchKey="pen"
          />
        </div>
      )}

      {/* 疊在最上方的情境內容（如文字框屬性面板）。column-reverse 下放在最後＝視覺最上層。 */}
      {!collapsed && topContent}
    </div>
  );
}
