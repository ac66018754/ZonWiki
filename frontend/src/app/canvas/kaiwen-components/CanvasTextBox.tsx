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
 * 開問啦畫布上的「純文字框」（Snipaste 風格）：可自由打字、設定背景（含透明）、字級、字色，
 * 並可拖曳移動、右下角縮放、上方握把旋轉。座標皆為畫布座標 (flow coordinates)。
 *
 * 互動：
 * - 未選取：只顯示文字（與背景）。點一下選取。
 * - 已選取（非編輯）：顯示虛線外框＋縮放/旋轉握把；拖曳框身＝移動；雙擊＝進入編輯。
 * - 編輯中：文字框可打字；點框外結束編輯。
 *
 * 旋轉以「中心」為樞紐；縮放以「對角（左上）固定」計算，皆考慮目前旋轉角度。
 */
export function CanvasTextBox({
  item, zoomRef, toFlow, selected, editing,
  onSelect, onStartEdit, onStopEdit, onChange, onCommit,
}: {
  item: TextItem;
  /** 目前畫布縮放（用 ref 取最新值，供拖曳換算）。 */
  zoomRef: React.RefObject<number>;
  /** 螢幕座標 → 畫布座標。 */
  toFlow: (clientX: number, clientY: number) => { x: number; y: number };
  selected: boolean;
  editing: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  /** 即時更新本地狀態（不持久化）。 */
  onChange: (patch: Partial<TextItem>) => void;
  /** 持久化（拖曳/縮放/旋轉結束、文字失焦時）。 */
  onCommit: (patch: Partial<TextItem>) => void;
}) {
  const extra = parseTextExtra(item.dataJson);
  const fontColor = item.color || '#ef4444';
  const taRef = useRef<HTMLTextAreaElement>(null);

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

  // ── 拖曳移動（螢幕位移 ÷ zoom = 畫布位移）──
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
    // 左上角（縮放時固定）的 flow 座標：中心 + R(deg)·(-w/2,-h/2)
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
      onChange({ dataJson: JSON.stringify({ ...extra, rotation: nextDeg }) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onCommit({ dataJson: JSON.stringify({ ...extra, rotation: nextDeg }) });
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
      style={{
        position: 'absolute', left: item.x, top: item.y, width: item.width, height: item.height,
        zIndex: item.zIndex, transform: `rotate(${deg}deg)`, transformOrigin: 'center center',
        pointerEvents: 'auto',
      }}
      data-testid="canvas-anno-text"
      onPointerDown={(e) => { if (!editing) { onSelect(); startMove(e); } }}
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
        data-testid="canvas-anno-text-input"
      />

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
            data-testid="canvas-anno-text-rotate"
          />
          {/* 右下角縮放握把 */}
          <div
            style={{ ...handle('nwse-resize'), right: -6, bottom: -6 }}
            onPointerDown={startResize}
            title="縮放"
            data-testid="canvas-anno-text-resize"
          />
        </>
      )}
    </div>
  );
}
