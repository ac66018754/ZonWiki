'use client';

import { useEffect, useRef } from 'react';

/** 純文字框的額外屬性（存在標註的 dataJson）：背景色（null＝透明）、字級（px）、旋轉角度（度）。 */
export interface TextExtra {
  bg: string | null;
  fontSize: number;
  rotation: number;
}

/** 從 dataJson 安全解析純文字框的額外屬性（壞資料回預設）。 */
export function parseTextExtra(dataJson?: string | null): TextExtra {
  try {
    const o = JSON.parse(dataJson || '{}') as Record<string, unknown>;
    return {
      bg: typeof o.bg === 'string' ? (o.bg as string) : null,
      fontSize: typeof o.fontSize === 'number' ? (o.fontSize as number) : 18,
      rotation: typeof o.rotation === 'number' ? (o.rotation as number) : 0,
    };
  } catch {
    return { bg: null, fontSize: 18, rotation: 0 };
  }
}

/** 純文字框元件吃的最小資料形狀。 */
interface TextItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  /** 字體顏色。 */
  color?: string | null;
  /** 文字內容。 */
  text?: string | null;
  /** 額外屬性 JSON（bg / fontSize / rotation）。 */
  dataJson?: string | null;
}

/**
 * 共用的「純文字框」（Snipaste 風格）：可自由打字、設定背景（含透明）、字級、字色，
 * 並可拖曳移動、右下角縮放、上方握把旋轉。座標系與縮放由呼叫端決定：
 * - 開問啦畫布：座標＝畫布座標 (flow coordinates)、zoom＝畫布縮放、toFlow＝screenToFlowPosition。
 * - 筆記頁：座標＝相對內文容器像素、zoom＝1、toFlow＝（螢幕座標 − 容器左上角）。
 *
 * 互動：
 * - 未選取：只顯示文字（與背景）。點一下選取。
 * - 已選取（非編輯）：顯示虛線外框＋縮放/旋轉握把；拖曳框身＝移動；雙擊＝進入編輯。
 * - 編輯中：文字框可打字；點框外結束編輯。
 *
 * 旋轉以「中心」為樞紐；縮放以「對角（左上）固定」計算，皆考慮目前旋轉角度。
 */
export function DrawingTextBox({
  item, zoomRef, toFlow, selected, editing, interactive = true,
  onSelect, onStartEdit, onStopEdit, onChange, onCommit, onAdjustWheel, overlayId,
  isQuestion, onToggleQuestion,
}: {
  item: TextItem;
  /** 目前縮放（用 ref 取最新值，供拖曳換算）。筆記頁固定為 1。 */
  zoomRef: React.RefObject<number>;
  /** 螢幕座標 → 內容座標（畫布座標或內文相對座標）。 */
  toFlow: (clientX: number, clientY: number) => { x: number; y: number };
  selected: boolean;
  editing: boolean;
  /** 是否可互動（false＝整個文字框 pointer-events:none，讓底下的繪圖擷取面接管，預設 true）。 */
  interactive?: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  /** 即時更新本地狀態（不持久化）。 */
  onChange: (patch: Partial<TextItem>) => void;
  /** 持久化（拖曳/縮放/旋轉結束、文字失焦時）。 */
  onCommit: (patch: Partial<TextItem>) => void;
  /**
   * 選取/編輯中滾輪滾動時呼叫（deltaY：向上負、向下正），供「滾輪調整大小」（可選；
   * 未提供＝該端不支援，滾輪維持頁面捲動）。
   */
  onAdjustWheel?: (deltaY: number) => void;
  /**
   * 選擇性：標註（浮層）識別碼；提供時會標到根元素的 data-overlay-id，
   * 供筆記頁 ?overlay= 捲動定位與高亮使用（開問啦畫布不需要，故為選擇性）。
   */
  overlayId?: string;
  /**
   * 選擇性：此文字框是否被標記為「問題」（僅筆記頁使用；開問啦畫布不傳＝零改變）。
   */
  isQuestion?: boolean;
  /**
   * 選擇性：切換「設為問題／移除問題」的回呼（僅筆記頁傳入；有傳才顯示 ❓ 切換鈕）。
   */
  onToggleQuestion?: () => void;
}) {
  const extra = parseTextExtra(item.dataJson);
  const fontColor = item.color || '#ef4444';
  const taRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  /** 取 dataJson 的原始物件（保留 anchor 等未知欄位；寫回時必須合併，不可只寫已知三欄）。 */
  const rawData = (): Record<string, unknown> => {
    try {
      const o = JSON.parse(item.dataJson || '{}') as unknown;
      if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, unknown>;
    } catch { /* 壞資料 → 空物件 */ }
    return {};
  };

  // 選取/編輯中 → 攔截滾輪做「調整大小」（原生監聽器＋passive:false 才能 preventDefault 擋頁面捲動）。
  useEffect(() => {
    if (!onAdjustWheel || (!selected && !editing)) return;
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      onAdjustWheel(e.deltaY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onAdjustWheel, selected, editing]);

  // 進入編輯模式 → 聚焦文字框並把游標移到末端。
  useEffect(() => {
    if (editing) {
      const ta = taRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    }
  }, [editing]);

  const deg = extra.rotation;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // ── 拖曳移動（螢幕位移 ÷ zoom = 內容位移）──
  const startMove = (e: React.PointerEvent) => {
    if (editing) return;
    e.preventDefault();
    e.stopPropagation();
    const z = zoomRef.current || 1;
    const sx = e.clientX, sy = e.clientY, ox = item.x, oy = item.y;
    let nx = ox, ny = oy;
    const move = (ev: PointerEvent) => {
      nx = ox + (ev.clientX - sx) / z;
      ny = oy + (ev.clientY - sy) / z;
      onChange({ x: nx, y: ny });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onCommit({ x: nx, y: ny });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ── 縮放（右下角握把；固定對角左上、隨旋轉換算）──
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const c0x = item.x + item.width / 2, c0y = item.y + item.height / 2;
    // 左上角（縮放時固定）的內容座標：中心 + R(deg)·(-w/2,-h/2)
    const tlx = c0x + (-item.width / 2) * cos - (-item.height / 2) * sin;
    const tly = c0y + (-item.width / 2) * sin + (-item.height / 2) * cos;
    let next = { x: item.x, y: item.y, width: item.width, height: item.height };
    const move = (ev: PointerEvent) => {
      const p = toFlow(ev.clientX, ev.clientY);
      const vx = p.x - tlx, vy = p.y - tly;
      // 把（左上→指標）向量轉回未旋轉座標 → 得到新寬高
      const w = Math.max(40, vx * cos + vy * sin);
      const h = Math.max(24, -vx * sin + vy * cos);
      // 新中心 = 左上 + R(deg)·(w/2,h/2)
      const ncx = tlx + (w / 2) * cos - (h / 2) * sin;
      const ncy = tly + (w / 2) * sin + (h / 2) * cos;
      next = { x: ncx - w / 2, y: ncy - h / 2, width: w, height: h };
      onChange(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onCommit(next);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ── 旋轉（上方握把；繞中心）──
  const startRotate = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ccx = item.x + item.width / 2, ccy = item.y + item.height / 2;
    let nextDeg = deg;
    const move = (ev: PointerEvent) => {
      const p = toFlow(ev.clientX, ev.clientY);
      // 握把在上方，故 +90 讓「指標朝上」對應 0 度
      nextDeg = Math.round((Math.atan2(p.y - ccy, p.x - ccx) * 180) / Math.PI + 90);
      onChange({ dataJson: JSON.stringify({ ...rawData(), rotation: nextDeg }) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onCommit({ dataJson: JSON.stringify({ ...rawData(), rotation: nextDeg }) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const handle = (cursor: string): React.CSSProperties => ({
    position: 'absolute', width: 12, height: 12, background: '#2684ff', border: '1.5px solid #fff',
    borderRadius: '50%', cursor, pointerEvents: 'auto', zIndex: 2,
  });

  return (
    <div
      ref={rootRef}
      style={{
        position: 'absolute', left: item.x, top: item.y, width: item.width, height: item.height,
        zIndex: item.zIndex, transform: `rotate(${deg}deg)`, transformOrigin: 'center center',
        pointerEvents: interactive ? 'auto' : 'none',
      }}
      data-testid="anno-text"
      data-overlay-id={overlayId}
      // 只有左鍵選取/拖曳（右鍵留給「取消模式」）。
      onPointerDown={(e) => { if (e.button !== 0) return; if (!editing) { onSelect(); startMove(e); } }}
      onDoubleClick={(e) => { e.stopPropagation(); onStartEdit(); }}
    >
      <textarea
        ref={taRef}
        value={item.text ?? ''}
        readOnly={!editing}
        onChange={(e) => onChange({ text: e.target.value })}
        onBlur={(e) => { onCommit({ text: e.target.value }); onStopEdit(); }}
        placeholder={editing ? '輸入文字…' : ''}
        style={{
          width: '100%', height: '100%', boxSizing: 'border-box', resize: 'none', border: 'none',
          outline: 'none', padding: 4, margin: 0, overflow: 'hidden',
          background: extra.bg ?? 'transparent',
          color: fontColor, fontSize: extra.fontSize, lineHeight: 1.25,
          fontFamily: 'inherit', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          pointerEvents: editing ? 'auto' : 'none', cursor: editing ? 'text' : 'move',
        }}
        data-testid="anno-text-input"
      />

      {/* 問題標記（僅筆記頁傳入 onToggleQuestion / isQuestion 時顯示；開問啦畫布不傳＝不渲染）。
          選取且非編輯中時顯示「可點擊的 ❓ 切換鈕」；否則若已是問題，顯示「持續可見的 ❓ 徽章」。 */}
      {onToggleQuestion && selected && !editing ? (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onToggleQuestion(); }}
          title={isQuestion ? '移除問題標記' : '設為問題'}
          data-testid="anno-text-question-toggle"
          style={{
            position: 'absolute', left: -10, top: -10, width: 20, height: 20, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, lineHeight: 1,
            cursor: 'pointer', pointerEvents: 'auto', zIndex: 3,
            border: '1px solid var(--border-strong, #999)',
            background: isQuestion ? 'var(--action-primary-bg, #2563eb)' : 'var(--bg-surface, #fff)',
            color: isQuestion ? 'var(--action-primary-fg, #fff)' : 'var(--text-secondary, #555)',
          }}
        >
          ❓
        </button>
      ) : (
        isQuestion && (
          <span
            aria-label="已標記為問題"
            title="已標記為問題"
            style={{
              position: 'absolute', left: -8, top: -8, width: 18, height: 18, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, lineHeight: 1,
              pointerEvents: 'none', zIndex: 3,
              background: 'var(--action-primary-bg, #2563eb)', color: 'var(--action-primary-fg, #fff)',
              border: '1px solid var(--bg-surface, #fff)',
            }}
          >
            ❓
          </span>
        )
      )}

      {selected && !editing && (
        <>
          {/* 選取外框（虛線） */}
          <div style={{ position: 'absolute', inset: -1, border: '1px dashed #2684ff', pointerEvents: 'none' }} />
          {/* 旋轉握把連線 */}
          <div style={{ position: 'absolute', left: '50%', top: -18, width: 1, height: 18, background: '#2684ff', pointerEvents: 'none' }} />
          {/* 上方旋轉握把 */}
          <div
            style={{ ...handle('grab'), left: 'calc(50% - 6px)', top: -24 }}
            onPointerDown={startRotate}
            title="旋轉"
            data-testid="anno-text-rotate"
          />
          {/* 右下角縮放握把 */}
          <div
            style={{ ...handle('nwse-resize'), right: -6, bottom: -6 }}
            onPointerDown={startResize}
            title="縮放"
            data-testid="anno-text-resize"
          />
        </>
      )}
    </div>
  );
}
