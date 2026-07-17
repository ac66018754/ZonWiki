"use client";

import { formatDuration } from "@/lib/timeTracking/period";

/**
 * /time 儀表板的純 SVG 圖表元件（不引入圖表函式庫，保持頁面輕量與可自訂）。
 *
 * 色彩：吃 globals.css 的 `.time-dash-viz` CSS 變數（--viz-1..4、--viz-other），
 * 亮（warmpaper/light）與暗（dark/night）兩組色值皆通過 dataviz 驗證器
 * （4 槽全對 CVD/對比檢查；亮主題第 3/4 槽低於 3:1 對比 → 以「依分類」清單
 * 作為圖例兼表格視圖、甜甜圈段間留縫，滿足 relief 規則）。
 * 文字一律用站方文字 token（--text-secondary），不用序列色上字。
 */

/** SVG 邏輯畫布寬（實際以 width:100% 等比縮放）。 */
const CHART_W = 360;

/** 序列 1（單一序列圖表：長條／折線）的顏色。 */
const SERIES_1 = "var(--viz-1)";

/**
 * 長條圖：一段期間的時間分布（日檢視＝每小時、週檢視＝每日）。
 * 單一序列（同一種度量），依規範不配圖例；最大格直接標值。
 */
export function VizBarChart({
  bins,
  tickLabels,
  binTitle,
}: {
  /** 每格的秒數。 */
  bins: number[];
  /** 座標刻度（index＝格位置；週檢視每格一標、日檢視每 6 小時一標）。 */
  tickLabels: { index: number; text: string }[];
  /** 每格的 hover 提示文字（原生 title tooltip）。 */
  binTitle: (index: number) => string;
}) {
  const H = 120;
  const plotH = 92; // 下方留座標刻度區
  // 防禦：空陣列會讓 barW 除以 0 變 NaN（呼叫端雖有 gate，元件自身也要安全）
  if (bins.length === 0) return null;
  const max = Math.max(1, ...bins);
  const maxIndex = bins.indexOf(Math.max(...bins));
  const gap = 2; // 規範：相鄰長條之間 2px 表面縫
  const barW = (CHART_W - gap * (bins.length - 1)) / bins.length;

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${H}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      role="img"
      aria-label="時間分布長條圖"
    >
      {/* 基線（recessive 的細線） */}
      <line
        x1={0}
        y1={plotH + 0.5}
        x2={CHART_W}
        y2={plotH + 0.5}
        style={{ stroke: "var(--border-default)" }}
        strokeWidth={1}
      />
      {bins.map((seconds, i) => {
        const h = seconds <= 0 ? 0 : Math.max(2, (seconds / max) * (plotH - 18));
        const x = i * (barW + gap);
        return (
          <g key={i}>
            {/* 命中區放大到整欄（hover 目標大於視覺標記） */}
            <rect x={x} y={0} width={barW + gap} height={plotH} fill="transparent">
              <title>{binTitle(i)}</title>
            </rect>
            {h > 0 && (
              <rect
                x={x}
                y={plotH - h}
                width={barW}
                height={h}
                rx={Math.min(3, barW / 2)}
                style={{ fill: SERIES_1 }}
                pointerEvents="none"
              />
            )}
            {/* 最大格直接標值（選擇性直接標籤；文字用文字 token） */}
            {i === maxIndex && seconds > 0 && (
              <text
                x={x + barW / 2}
                y={plotH - h - 5}
                textAnchor="middle"
                fontSize={11}
                style={{ fill: "var(--text-secondary)" }}
                pointerEvents="none"
              >
                {formatDuration(seconds)}
              </text>
            )}
          </g>
        );
      })}
      {tickLabels.map(({ index, text }) => (
        <text
          key={`${index}-${text}`}
          x={index * (barW + gap) + barW / 2}
          y={H - 4}
          textAnchor="middle"
          fontSize={11}
          style={{ fill: "var(--text-secondary)" }}
        >
          {text}
        </text>
      ))}
    </svg>
  );
}

/**
 * 折線圖：累積時數走勢（看投入節奏；終點＝期間總時長）。
 * 單一序列、2px 線寬、終點 4px 圓點＋直接標值。
 */
export function VizLineChart({
  cumulative,
  endLabel,
}: {
  /** 累積秒數序列（含起點 0，長度＝格數＋1）。 */
  cumulative: number[];
  /** 終點標籤（通常＝總時長）。 */
  endLabel: string;
}) {
  const H = 96;
  const plotH = 80;
  const padTop = 14;
  const max = Math.max(1, cumulative[cumulative.length - 1]);
  const stepX = CHART_W / (cumulative.length - 1);
  const pointY = (v: number) => plotH - (v / max) * (plotH - padTop);
  const points = cumulative.map((v, i) => `${i * stepX},${pointY(v)}`);
  const endX = (cumulative.length - 1) * stepX;
  const endY = pointY(cumulative[cumulative.length - 1]);

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${H}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      role="img"
      aria-label="累積時數折線圖"
    >
      <line
        x1={0}
        y1={plotH + 0.5}
        x2={CHART_W}
        y2={plotH + 0.5}
        style={{ stroke: "var(--border-default)" }}
        strokeWidth={1}
      />
      <polyline
        points={points.join(" ")}
        fill="none"
        style={{ stroke: SERIES_1 }}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {/* 終點：4px 圓點＋2px 表面環（規範：重疊標記加表面環）＋直接標值 */}
      <circle cx={endX} cy={endY} r={5} style={{ fill: "var(--bg-surface)" }} />
      <circle cx={endX} cy={endY} r={4} style={{ fill: SERIES_1 }} />
      <text
        x={endX - 8}
        y={Math.max(11, endY - 8)}
        textAnchor="end"
        fontSize={11}
        style={{ fill: "var(--text-secondary)" }}
      >
        {endLabel}
      </text>
    </svg>
  );
}

/** 甜甜圈的一段資料。 */
export interface DonutSlice {
  /** 圖例名稱（分類名或「其他」）。 */
  label: string;
  /** 秒數。 */
  seconds: number;
  /** 填色（CSS 變數字串）。 */
  color: string;
}

/** 極座標 → 直角座標（角度 0＝12 點鐘方向、順時針）。 */
function polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/**
 * 甜甜圈圖：分類占比（前 4 大＋其他）。
 * 段與段之間留角度縫（≈2px 表面縫，CVD 次要編碼之一）；中心顯示總時長。
 * 圖例＝頁面上緊鄰的「依分類」清單（含色點與數值，兼表格視圖）。
 */
export function VizDonut({ slices, centerLabel }: { slices: DonutSlice[]; centerLabel: string }) {
  const SIZE = 140;
  const c = SIZE / 2;
  const r = 54;
  const ring = 18; // 環厚
  const total = slices.reduce((sum, s) => sum + s.seconds, 0);

  // 全部為零：畫空環
  if (total <= 0) {
    return null;
  }

  const GAP_DEG = 2.5; // 段間縫（角度；於 r=54 約 2.4px）
  const visible = slices.filter((s) => s.seconds > 0);
  // 單一段＝滿圈，不留縫（縫是「段間」概念）
  const stepGap = visible.length > 1 ? GAP_DEG : 0;
  const usable = 360 - stepGap * visible.length;

  // 各段掃過的角度與起點（純函數式累加，避免 render 期間重賦值）
  const sweeps = visible.map((s) => (s.seconds / total) * usable);
  const segments = visible.map((s, i) => {
    const start =
      sweeps.slice(0, i).reduce((sum, v) => sum + v, 0) + i * stepGap;
    return { ...s, start, end: start + sweeps[i] };
  });

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      style={{ width: SIZE, height: SIZE, flexShrink: 0 }}
      role="img"
      aria-label="分類占比圓餅圖"
    >
      {segments.map((seg, segIndex) => {
        if (seg.end - seg.start >= 359.9) {
          // 滿圈：用 circle（arc path 無法畫 360°）
          return (
            <circle
              key={`${seg.label}-${segIndex}`}
              cx={c}
              cy={c}
              r={r}
              fill="none"
              style={{ stroke: seg.color }}
              strokeWidth={ring}
            >
              <title>{`${seg.label}：${formatDuration(seg.seconds)}`}</title>
            </circle>
          );
        }
        const [x1, y1] = polar(c, c, r, seg.start);
        const [x2, y2] = polar(c, c, r, seg.end);
        const largeArc = seg.end - seg.start > 180 ? 1 : 0;
        return (
          <path
            // key 含 index：使用者可能真的把某分類命名為「其他」，與折疊聚合段撞名
            key={`${seg.label}-${segIndex}`}
            d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`}
            fill="none"
            style={{ stroke: seg.color }}
            strokeWidth={ring}
            strokeLinecap="butt"
          >
            <title>{`${seg.label}：${formatDuration(seg.seconds)}（${Math.round((seg.seconds / total) * 100)}%）`}</title>
          </path>
        );
      })}
      {/* 中心：總時長（文字 token，非序列色） */}
      <text
        x={c}
        y={c - 2}
        textAnchor="middle"
        fontSize={15}
        fontWeight={700}
        style={{ fill: "var(--text-primary)" }}
      >
        {centerLabel}
      </text>
      <text x={c} y={c + 14} textAnchor="middle" fontSize={10} style={{ fill: "var(--text-secondary)" }}>
        總計
      </text>
    </svg>
  );
}
