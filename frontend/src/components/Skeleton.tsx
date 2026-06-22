/**
 * 載入骨架元件
 *
 * 提供各種尺寸的骨架屏，用於首頁載入時的佔位符。
 */

interface SkeletonProps {
  /** 寬度 (CSS 值) */
  width?: string;
  /** 高度 (CSS 值) */
  height?: string;
  /** 是否圓角 */
  rounded?: boolean;
  /** 自訂 className */
  className?: string;
}

/**
 * 基礎骨架元素
 */
export function Skeleton({
  width = "100%",
  height = "20px",
  rounded = false,
  className,
}: SkeletonProps) {
  return (
    <div
      className={className}
      style={{
        width,
        height,
        background: "var(--skeleton-bg)",
        borderRadius: rounded ? "var(--radius-full)" : "var(--radius-sm)",
        animation: "skeleton-pulse 2s ease-in-out infinite",
      }}
      role="status"
      aria-hidden="true"
    />
  );
}

/**
 * 卡片骨架（用於首頁卡片)
 */
export function SkeletonCard({
  height = "auto",
  width = "100%",
}: {
  height?: string;
  width?: string;
} = {}) {
  // 若明確指定尺寸，則為簡單的矩形骨架
  if (height !== "auto") {
    return (
      <div
        style={{
          width,
          height,
          background: "var(--bg-surface)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border-default)",
          animation: "skeleton-pulse 2s ease-in-out infinite",
        }}
      />
    );
  }

  // 預設卡片布局
  return (
    <div
      style={{
        padding: "var(--spacing-4)",
        background: "var(--bg-surface)",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border-default)",
      }}
    >
      <div style={{ marginBottom: "var(--spacing-3)" }}>
        <Skeleton height="24px" width="60%" />
      </div>
      <div style={{ marginBottom: "var(--spacing-2)" }}>
        <Skeleton height="16px" width="100%" />
      </div>
      <Skeleton height="16px" width="80%" />
    </div>
  );
}

/**
 * 列表項骨架
 */
export function SkeletonListItem() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--spacing-3)",
        padding: "var(--spacing-3)",
        marginBottom: "var(--spacing-2)",
      }}
    >
      <Skeleton width="40px" height="40px" rounded={true} />
      <div style={{ flex: 1 }}>
        <div style={{ marginBottom: "var(--spacing-2)" }}>
          <Skeleton height="16px" width="70%" />
        </div>
        <Skeleton height="12px" width="50%" />
      </div>
    </div>
  );
}
