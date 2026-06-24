import type { Shape } from './shapes';

/** 依給定描邊屬性渲染單一形狀（free/line→polyline、rect→rect、ellipse→ellipse）。 */
export function renderShapeWith(
  s: Shape,
  props: React.SVGProps<SVGPolylineElement & SVGRectElement & SVGEllipseElement>
): React.ReactElement | null {
  if (s.type === 'free' || s.type === 'line') {
    return <polyline points={s.points.map((p) => `${p[0]},${p[1]}`).join(' ')} {...props} />;
  }
  const [a, b] = s.points;
  if (!a || !b) return null;
  if (s.type === 'rect') {
    return <rect x={Math.min(a[0], b[0])} y={Math.min(a[1], b[1])} width={Math.abs(b[0] - a[0])} height={Math.abs(b[1] - a[1])} {...props} />;
  }
  return <ellipse cx={(a[0] + b[0]) / 2} cy={(a[1] + b[1]) / 2} rx={Math.abs(b[0] - a[0]) / 2} ry={Math.abs(b[1] - a[1]) / 2} {...props} />;
}

/**
 * 渲染單一形狀（不畫任何外框/光暈——避免被誤判成線條粗度）。
 * erasable＝true 時描邊本身可接收點擊（供筆記版「整筆刪除」直接點形狀）；
 * 畫布版的整筆刪除改走擷取面 + hitTestShape，故傳 erasable=false 即可。
 */
export function ShapeEl({
  s, erasable, onErase,
}: {
  s: Shape;
  erasable: boolean;
  onErase: () => void;
}) {
  const common = {
    fill: 'none' as const,
    stroke: s.color,
    strokeWidth: s.width,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeDasharray: s.dash ? '6 4' : undefined,
    style: { pointerEvents: (erasable ? 'stroke' : 'none') as React.CSSProperties['pointerEvents'], cursor: erasable ? 'cell' : 'default' },
    onPointerDown: erasable ? onErase : undefined,
  };
  return renderShapeWith(s, common);
}
