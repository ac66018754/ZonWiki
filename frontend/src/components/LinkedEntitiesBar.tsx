"use client";

import { useCallback, useEffect, useState } from "react";
import { listLinks, type LinkEntityType, type LinkedEntity } from "@/lib/api";
import { EntityLinkPopover } from "@/components/EntityLinkPopover";

const icon = (t: string) =>
  t === "note" ? "📝" : t === "node" ? "🎨" : t === "subtask" ? "☑️" : "🎯";

/**
 * 關聯列：顯示某實體（筆記/節點/任務）目前關聯的其他項目，並提供「＋關聯」按鈕
 * 開啟浮動視窗來「搜尋既有項目關聯」或解除關聯。
 * 每個關聯項可點擊前往（例如點任務 → 回到該任務當天的行事曆週視圖）。
 */
export function LinkedEntitiesBar({
  type,
  id,
  sourceTitle = "",
  label = "🔗 關聯",
}: {
  type: LinkEntityType;
  id: string;
  /** 來源標題（顯示於浮動視窗標題；建立新項時帶入） */
  sourceTitle?: string;
  label?: string;
}) {
  const [links, setLinks] = useState<LinkedEntity[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [popoverRect, setPopoverRect] = useState<DOMRect | null>(null);

  const reload = useCallback(() => {
    let alive = true;
    listLinks(type, id).then((l) => {
      if (alive) {
        setLinks(l);
        setLoaded(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [type, id]);

  useEffect(() => {
    const cancel = reload();
    return cancel;
  }, [reload]);

  if (!loaded) return null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--spacing-2)",
        padding: "var(--spacing-2) var(--spacing-3)",
        background: "var(--bg-surface-secondary, var(--bg-surface))",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", flexShrink: 0 }}>{label}</span>

      {links.map((l) => (
        <button
          key={l.linkId}
          onClick={() => {
            window.location.href = l.url;
          }}
          title={l.subText ? `${l.title}（${l.subText}）` : l.title}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            maxWidth: "240px",
            padding: "2px var(--spacing-2)",
            background: "var(--bg-default)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-full, 999px)",
            cursor: "pointer",
            color: "var(--text-primary)",
            fontSize: "var(--text-xs)",
          }}
        >
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {icon(l.type)} {l.title}
          </span>
        </button>
      ))}

      {links.length === 0 && (
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>尚無關聯</span>
      )}

      {/* ＋關聯：開啟浮動視窗搜尋既有項目來關聯 */}
      <button
        onClick={(e) => setPopoverRect(e.currentTarget.getBoundingClientRect())}
        title="搜尋既有項目來關聯"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "2px var(--spacing-2)",
          background: "var(--bg-default)",
          border: "1px dashed var(--border-strong, var(--border-default))",
          borderRadius: "var(--radius-full, 999px)",
          cursor: "pointer",
          color: "var(--action-primary-bg)",
          fontSize: "var(--text-xs)",
          fontWeight: 600,
        }}
      >
        ＋ 關聯
      </button>

      {popoverRect && (
        <EntityLinkPopover
          sourceType={type}
          sourceId={id}
          sourceTitle={sourceTitle}
          rect={{
            top: popoverRect.top,
            bottom: popoverRect.bottom,
            left: popoverRect.left,
            right: popoverRect.right,
          }}
          onClose={() => setPopoverRect(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}
