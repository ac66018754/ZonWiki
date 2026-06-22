"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ArticleSummary, Category } from "@/lib/api";
import { FileIcon, FolderIcon, StackIcon, EnterIcon } from "./Icons";

interface CommandPaletteProps {
  onClose: () => void;
  categories: Category[];
  articles: ArticleSummary[];
}

type Group = "page" | "category" | "article";

interface Item {
  key: string;
  group: Group;
  label: string;
  meta: string;
  href: string;
}

const GROUP_LABEL: Record<Group, string> = {
  page: "前往",
  category: "分類",
  article: "筆記",
};

function GroupGlyph({ group }: { group: Group }) {
  if (group === "page") return <StackIcon size={15} />;
  if (group === "category") return <FolderIcon size={15} />;
  return <FileIcon size={15} />;
}

/** Index of the query within the text, or Infinity when it does not match. */
function matchScore(haystack: string, needle: string): number {
  const idx = haystack.toLowerCase().indexOf(needle.toLowerCase());
  return idx < 0 ? Infinity : idx;
}

/**
 * Command palette for jumping between notes, categories and pages.
 * Mounted only while open, so query/selection state is naturally fresh.
 */
export function CommandPalette({
  onClose,
  categories,
  articles,
}: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const baseItems = useMemo<Item[]>(() => {
    const pages: Item[] = [
      { key: "page:home", group: "page", label: "所有筆記", meta: "/", href: "/" },
    ];
    const cats: Item[] = categories.map((c) => ({
      key: `cat:${c.id}`,
      group: "category",
      label: c.name,
      meta: `${c.articleCount ?? c.noteCount} 篇 · ${c.folderPath ?? ""}`,
      href: `/?cat=${encodeURIComponent(c.id)}`,
    }));
    const arts: Item[] = articles.map((a) => ({
      key: `art:${a.id}`,
      group: "article",
      label: a.title,
      meta: a.filePath ?? "",
      href: `/a/${a.slug}`,
    }));
    return [...pages, ...cats, ...arts];
  }, [categories, articles]);

  const results = useMemo<Item[]>(() => {
    const q = query.trim();
    if (!q) return baseItems;
    return baseItems
      .map((item) => ({
        item,
        score: Math.min(matchScore(item.label, q), matchScore(item.meta, q)),
      }))
      .filter((r) => r.score !== Infinity)
      .sort((a, b) => a.score - b.score)
      .map((r) => r.item);
  }, [baseItems, query]);

  // Focus the search field once, after the open animation begins.
  useEffect(() => {
    const raf = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(raf);
  }, []);

  // Keep the highlighted row visible.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active, query]);

  function go(item: Item | undefined) {
    if (!item) return;
    onClose();
    router.push(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) =>
        results.length ? (i - 1 + results.length) % results.length : 0,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  const groups: Group[] = ["page", "category", "article"];
  let flatIndex = -1;

  return (
    <div className="cmdk-scrim" onClick={onClose} role="presentation">
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="跳轉與搜尋"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cmdk__input-row">
          <span
            style={{
              color: "var(--ink-faint)",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
            }}
          >
            ⌘K
          </span>
          <input
            ref={inputRef}
            className="cmdk__input"
            placeholder="跳到筆記、分類或頁面…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            aria-label="搜尋"
          />
        </div>

        <div className="cmdk__list scroll-thin" ref={listRef}>
          {results.length === 0 && (
            <div className="cmdk__empty">找不到「{query}」相關的內容</div>
          )}
          {groups.map((group) => {
            const rows = results.filter((r) => r.group === group);
            if (rows.length === 0) return null;
            return (
              <div key={group}>
                <div className="cmdk__group">{GROUP_LABEL[group]}</div>
                {rows.map((item) => {
                  flatIndex += 1;
                  const index = flatIndex;
                  return (
                    <div
                      key={item.key}
                      className="cmdk__item"
                      data-active={index === active}
                      onMouseMove={() => setActive(index)}
                      onClick={() => go(item)}
                    >
                      <span className="cmdk__glyph">
                        <GroupGlyph group={item.group} />
                      </span>
                      <span className="cmdk__label">{item.label}</span>
                      <span className="cmdk__meta">{item.meta}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="cmdk__foot">
          <span>
            <span className="kbd">↑</span>
            <span className="kbd">↓</span> 選擇
          </span>
          <span>
            <span className="kbd">
              <EnterIcon size={11} />
            </span>{" "}
            開啟
          </span>
          <span>
            <span className="kbd">esc</span> 關閉
          </span>
        </div>
      </div>
    </div>
  );
}
