"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Category } from "@/lib/api";
import { StackIcon } from "./Icons";

interface CategoryPanelProps {
  categories: Category[];
  total: number;
}

export function CategoryPanel({ categories, total }: CategoryPanelProps) {
  const activeCat = useSearchParams().get("cat");

  return (
    <nav aria-label="筆記分類" style={{ padding: 6 }}>
      <Link
        href="/"
        className={`tree-item${!activeCat ? " tree-item--active" : ""}`}
      >
        <StackIcon size={14} />
        <span className="tree-item__name">所有筆記</span>
        <span className="tree-item__count">{total}</span>
      </Link>

      {categories.length === 0 && (
        <p
          style={{
            padding: "10px 9px",
            fontSize: 12.5,
            color: "var(--ink-faint)",
            fontStyle: "italic",
          }}
        >
          尚無分類
        </p>
      )}

      {categories.map((c) => {
        const depth = Math.max(0, (c.folderPath ?? "").split("/").length - 1);
        return (
          <Link
            key={c.id}
            href={`/?cat=${encodeURIComponent(c.id)}`}
            className={`tree-item${activeCat === c.id ? " tree-item--active" : ""}`}
            style={{ paddingLeft: 9 + depth * 13 }}
            title={c.folderPath ?? ""}
          >
            {depth > 0 && <span className="tree-rail" />}
            <span className="tree-item__name">{c.name}</span>
            <span className="tree-item__count">{c.articleCount}</span>
          </Link>
        );
      })}
    </nav>
  );
}
