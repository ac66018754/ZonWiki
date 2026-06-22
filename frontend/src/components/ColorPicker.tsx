'use client';

import { useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { PRESET_COLORS, resolveColor } from '@/lib/highlightColor';

// 轉出供既有 import 路徑沿用。
export { PRESET_COLORS, resolveColor };

/**
 * 內嵌色彩選擇器：常用色快捷 + 完整色盤（react-colorful，無斷點）。
 *
 * 「選完就選完」：點快捷色立即套用；用色盤拖曳調色，放開指標（pointerup）即套用，
 * 不需再按任何「套用」按鈕。下方僅顯示目前色預覽（唯讀）。
 *
 * @param onPick 選定顏色後的回呼（回傳 hex）。
 * @param onChange 調色過程的即時回呼（可選；例如畫筆要即時預覽當前色）。
 * @param initial 初始色（色盤起始值）。
 */
export function ColorPickerInline({
  onPick,
  onChange,
  initial = '#fef08a',
}: {
  onPick: (hex: string) => void;
  onChange?: (hex: string) => void;
  initial?: string;
}) {
  const [c, setC] = useState(initial);
  // 以 ref 持有最新色，避免 pointerup 時讀到尚未重繪的舊值。
  const cRef = useRef(c);

  const handleChange = (hex: string) => {
    cRef.current = hex;
    setC(hex);
    onChange?.(hex);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="color-picker">
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {PRESET_COLORS.map((p) => (
          <button
            key={p}
            title={p}
            onClick={() => onPick(p)}
            data-testid={`preset-${p}`}
            style={{
              width: 18, height: 18, borderRadius: '50%', background: p,
              border: '1px solid var(--border-strong, #999)', cursor: 'pointer',
            }}
          />
        ))}
      </div>
      {/* 拖曳調色 → 放開指標即套用 */}
      <div onPointerUp={() => onPick(cRef.current)}>
        <HexColorPicker color={c} onChange={handleChange} style={{ width: '100%', height: 120 }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 16, height: 16, borderRadius: 4, background: c, border: '1px solid var(--border-default)' }} />
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{c}</span>
      </div>
    </div>
  );
}
