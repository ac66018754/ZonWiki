/**
 * 共用手繪幾何模組（與座標系無關的純函式）。
 *
 * 由筆記浮層 NoteOverlay 抽出，讓「筆記頁浮層」與「開問啦畫布標註」共用同一套
 * 形狀模型與擦除/命中邏輯，避免兩份實作走樣。所有點座標皆為呼叫端自訂的座標系：
 * 筆記版用「相對內文容器的像素」，畫布版用「畫布座標 (flow coordinates)」。
 */

/**
 * 繪圖工具。null＝不繪圖（一般互動：可選文字、拖便利貼）。
 * erase-stroke＝整筆刪除（點一筆即刪整筆）；erase-area＝局部擦除（擦到哪、那裏消失）；
 * erase-box＝框選擦除（框到哪、那裏消失，同一形狀不連帶整個刪除）。
 */
export type DrawTool =
  | 'pen'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'erase-stroke'
  | 'erase-area'
  | 'erase-box'
  | null;

/** 一個繪圖形狀。free＝多點折線；line/rect/ellipse＝起訖兩點。 */
export interface Shape {
  type: 'free' | 'line' | 'rect' | 'ellipse';
  color: string;
  width: number;
  dash?: boolean;
  points: [number, number][];
}

/** 把（可能是舊版只有 points 的）資料正規化成 Shape（缺 type 視為 free）。 */
export function normalizeShapes(raw: unknown[]): Shape[] {
  return (raw || [])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({
      type: (['free', 'line', 'rect', 'ellipse'].includes(s.type as string) ? s.type : 'free') as Shape['type'],
      color: typeof s.color === 'string' ? s.color : '#ef4444',
      width: typeof s.width === 'number' ? s.width : 3,
      dash: !!s.dash,
      points: Array.isArray(s.points) ? (s.points as [number, number][]) : [],
    }));
}

/** 兩點是否幾乎相同（用於判斷形狀是否有實際拖出大小）。 */
export function samePoint(a?: [number, number], b?: [number, number]): boolean {
  if (!a || !b) return true;
  return Math.abs(a[0] - b[0]) < 2 && Math.abs(a[1] - b[1]) < 2;
}

/** 平方距離（避免開根號）。 */
export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

/** 把折線各段以約 2px 間距加密取樣，讓局部橡皮擦能可靠命中描邊。 */
export function densifyPolyline(corners: [number, number][], stepPx = 2): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[i + 1];
    const segLen = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(segLen / stepPx));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
  }
  if (corners.length > 0) out.push(corners[corners.length - 1]);
  return out;
}

/**
 * 把幾何形狀（line/rect/ellipse）攤平成密集點折線，供局部橡皮擦做「部分擦除」與命中測試。
 * 自由筆（free）已是點折線，直接回傳其點。
 */
export function shapeToPoints(s: Shape): [number, number][] {
  if (s.type === 'free') return s.points;
  const [a, b] = s.points;
  if (!a || !b) return [];
  if (s.type === 'line') {
    return densifyPolyline([a, b]);
  }
  if (s.type === 'rect') {
    const x0 = Math.min(a[0], b[0]);
    const y0 = Math.min(a[1], b[1]);
    const x1 = Math.max(a[0], b[0]);
    const y1 = Math.max(a[1], b[1]);
    return densifyPolyline([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]);
  }
  // ellipse：以參數式取樣（Ramanujan 周長近似決定取樣點數）
  const cx = (a[0] + b[0]) / 2;
  const cy = (a[1] + b[1]) / 2;
  const rx = Math.abs(b[0] - a[0]) / 2;
  const ry = Math.abs(b[1] - a[1]) / 2;
  const circumference = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  const n = Math.max(24, Math.ceil(circumference / 2));
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return pts;
}

/** 對一條點折線，移除「符合 shouldRemove 的點」並斷開成多段，把結果（型別一律 free）推入 out。 */
function erodeFreePoints(
  template: Shape,
  points: [number, number][],
  shouldRemove: (p: [number, number]) => boolean,
  out: Shape[]
): void {
  let seg: [number, number][] = [];
  for (const p of points) {
    if (shouldRemove(p)) {
      if (seg.length > 1) out.push({ ...template, type: 'free', points: seg });
      seg = [];
    } else {
      seg.push(p);
    }
  }
  if (seg.length > 1) out.push({ ...template, type: 'free', points: seg });
}

/**
 * 以「點判定函式」擦除：把符合 shouldRemove 的點移除、斷開成多段（真正「擦到哪、那裏消失」）。
 * - free：直接逐點處理。
 * - line / rect / ellipse：先看是否真的碰到描邊；沒碰到 → 保留原向量圖形（不退化）；
 *   碰到 → 攤平成密集點折線再套用同一套移除＋斷開邏輯（於是橢圓/矩形/直線也能被擦出缺口、其餘部分保留）。
 */
export function eraseByPredicate(list: Shape[], shouldRemove: (p: [number, number]) => boolean): Shape[] {
  const out: Shape[] = [];
  for (const s of list) {
    if (s.type === 'free') {
      erodeFreePoints(s, s.points, shouldRemove, out);
      continue;
    }
    const points = shapeToPoints(s);
    if (!points.some(shouldRemove)) {
      out.push(s); // 沒碰到 → 保留原向量圖形
      continue;
    }
    erodeFreePoints(s, points, shouldRemove, out);
  }
  return out;
}

/** 局部擦除：在 (x,y) 半徑 r 內移除內容。 */
export function eraseAt(list: Shape[], x: number, y: number, r: number): Shape[] {
  const r2 = r * r;
  return eraseByPredicate(list, (p) => dist2(p[0], p[1], x, y) <= r2);
}

/** 框選擦除：移除落在矩形 [minX,maxX]×[minY,maxY] 內的內容（只擦框到的部分，不連帶刪整個形狀）。 */
export function eraseInBox(
  list: Shape[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): Shape[] {
  return eraseByPredicate(
    list,
    (p) => p[0] >= minX && p[0] <= maxX && p[1] >= minY && p[1] <= maxY
  );
}

/**
 * 整筆命中測試：找出描邊通過 (x,y) 半徑 r 內的「最上層」形狀索引（由後往前找，後畫的在上層）。
 * 找不到回 -1。供畫布版「整筆刪除」橡皮擦改走擷取面（不依賴 SVG 子元素在縮放下的命中）。
 */
export function hitTestShape(list: Shape[], x: number, y: number, r: number): number {
  const r2 = r * r;
  for (let i = list.length - 1; i >= 0; i--) {
    const pts = shapeToPoints(list[i]);
    if (pts.some((p) => dist2(p[0], p[1], x, y) <= r2)) return i;
  }
  return -1;
}

/** 安全解析 JSON，失敗回退預設值。 */
export function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
