/**
 * 可刪除連線 — React Flow 邊元件
 *
 * 功能：
 * - 聚光效果（點擊邊時的視覺強調）
 * - 懸浮時顯示刪除鈕
 * - 支援邊的重新連接
 */

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'

/**
 * 邊上携帶的資料
 */
interface EdgeData {
  /** 是否被聚光（點擊選中） */
  spotlight?: boolean
  /** 刪除邊的回調 */
  onDelete?: (id: string) => void
}

/**
 * 可刪除連線元件
 *
 * 視覺效果：
 * - 正常：灰色細線
 * - 選中：主題色 accent、帶陰影與內光
 * - 聚光：三層疊加（漸層背景 + 主線 + 內光流動）
 *
 * 互動：
 * - 懸浮或選中時出現刪除鈕（× 按鈕）
 * - 點擊鈕即刪除該邊
 */
export function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  selected,
  data,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const d = (data ?? {}) as EdgeData
  const spotlight = !!d.spotlight
  const emphasised = spotlight || selected

  return (
    <>
      {spotlight ? (
        // 聚光：三層視覺效果
        <>
          {/* 最底層：寬廣的半透明漸層背景 */}
          <path
            d={path}
            fill="none"
            style={{
              stroke: 'color-mix(in srgb, var(--kw-accent) 22%, transparent)',
              strokeWidth: 9,
              strokeLinecap: 'round',
              pointerEvents: 'none',
            }}
          />
          {/* 中層：主色實線 + 陰影 */}
          <BaseEdge
            id={id}
            path={path}
            markerEnd={markerEnd}
            style={{
              stroke: 'var(--kw-accent)',
              strokeWidth: 2.6,
              filter: 'drop-shadow(0 0 4px color-mix(in srgb, var(--kw-accent) 75%, transparent))',
            }}
          />
          {/* 頂層：內光流動（可選視覺強調） */}
          <path
            d={path}
            className="edge-spotlight-flow"
            style={{
              stroke: 'color-mix(in srgb, var(--kw-accent) 55%, white)',
              strokeWidth: 2.6,
              pointerEvents: 'none',
            }}
          />
        </>
      ) : (
        // 正常或選中：簡單實線
        <BaseEdge
          id={id}
          path={path}
          markerEnd={markerEnd}
          style={{
            stroke: selected ? 'var(--kw-primary)' : 'var(--kw-edge)',
            strokeWidth: selected ? 2 : 1.5,
          }}
        />
      )}

      {/* 刪除鈕：浮層標籤位置 */}
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan group absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation()
              d.onDelete?.(id)
            }}
            title="移除連線"
            className={`grid h-4 w-4 place-items-center rounded-full border border-[var(--kw-border-strong)] bg-[var(--kw-surface)] text-[10px] leading-none text-[var(--kw-muted)] shadow-sm hover:border-[var(--kw-danger)] hover:text-[var(--kw-danger)] ${
              emphasised ? 'flex' : 'hidden group-hover:flex'
            }`}
            data-testid="delete-edge"
          >
            ×
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

/**
 * React Flow 邊類型注冊表
 */
export const edgeTypes = { deletable: DeletableEdge }
