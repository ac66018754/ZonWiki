"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { searchAll, SearchResult } from "@/lib/api";
import { logger } from "@/lib/logger";
import { confirmNavigation } from "@/lib/navigationGuard";

/**
 * 搜尋結果項目（在後端內容結果之外，再加上前端的「功能/頁面」項目）。
 * 後端 SearchResult.type 為嚴格聯集，這裡額外允許 "function"。
 */
type SearchItem = Omit<SearchResult, "type"> & {
  type: SearchResult["type"] | "function";
};

/**
 * 可被全域搜尋找到的「功能/頁面」項目（涵蓋主要功能入口與個人頁各子頁）。
 * 純前端靜態索引：不需後端改動，輸入關鍵字即可在搜尋框中直接跳轉到對應功能。
 */
interface FeatureEntry {
  /** 顯示標題。 */
  title: string;
  /** 跳轉網址。 */
  url: string;
  /** 額外比對關鍵字（中英別名）。 */
  keywords: string[];
}

const FEATURE_INDEX: readonly FeatureEntry[] = [
  { title: "首頁（儀表板）", url: "/", keywords: ["home", "dashboard", "首頁", "主頁"] },
  { title: "日程規劃 / 任務 / 行事曆", url: "/tasks", keywords: ["task", "todo", "calendar", "任務", "日程", "行事曆", "看板", "清單"] },
  { title: "開問啦（AI 畫布）", url: "/canvas", keywords: ["canvas", "kaiwen", "畫布", "節點", "ai", "開問啦"] },
  { title: "筆記", url: "/notes", keywords: ["note", "筆記", "知識"] },
  { title: "知識圖譜", url: "/notes/graph", keywords: ["graph", "圖譜", "知識圖譜"] },
  { title: "垃圾桶", url: "/trash", keywords: ["trash", "垃圾桶", "回收", "刪除", "還原"] },
  { title: "個人頁面 / 帳號資訊", url: "/profile", keywords: ["profile", "account", "帳號", "個人", "暱稱"] },
  { title: "修改密碼", url: "/profile", keywords: ["password", "密碼", "修改密碼", "改密碼"] },
  { title: "顯示時區設定", url: "/profile", keywords: ["timezone", "時區"] },
  { title: "統計數據", url: "/profile/stats", keywords: ["stats", "統計", "數據"] },
  { title: "活動紀錄", url: "/profile/activity", keywords: ["activity", "活動", "紀錄", "歷史"] },
  { title: "快捷鍵設定", url: "/profile/shortcuts", keywords: ["shortcut", "快捷鍵", "鍵盤", "綁定"] },
];

/**
 * 在功能索引中比對查詢字串，回傳符合的功能項目（type=function）。
 * @param query 使用者輸入。
 * @returns 符合的功能項目陣列（空查詢回空陣列）。
 */
function searchFeatures(query: string): SearchItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return FEATURE_INDEX.filter(
    (feature) =>
      feature.title.toLowerCase().includes(q) ||
      feature.keywords.some((keyword) => keyword.toLowerCase().includes(q))
  ).map((feature) => ({
    type: "function" as const,
    id: `fn:${feature.url}:${feature.title}`,
    title: feature.title,
    url: feature.url,
  }));
}

/**
 * 全域搜尋下拉組件
 * - 支援 Cmd/Ctrl+K 快捷鍵
 * - 搜尋筆記、任務、畫布、節點，以及個人頁/主功能等「功能項目」
 * - 鍵盤上下選取 + Enter 跳轉
 */
export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * 執行搜尋（帶 debounce）
   */
  const handleSearch = useCallback((q: string) => {
    setQuery(q);
    setActiveIndex(0);

    // 清除前一次的超時
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!q.trim()) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    setLoading(true);

    // 200ms debounce
    searchTimeoutRef.current = setTimeout(() => {
      (async () => {
        // 前端功能索引：即使後端失敗也先放上功能項目，確保「搜尋頁面功能」永遠可用。
        const features = searchFeatures(q);
        try {
          // 使用後端搜尋 API 同時搜尋筆記、任務、畫布、節點
          const serverResults = await searchAll(q);
          // 功能項目置前（使用者意圖找功能時優先），再接內容結果
          setResults([...features, ...serverResults]);
          setIsOpen(true);
        } catch (err) {
          logger.error("Search failed:", err);
          setResults(features);
          setIsOpen(features.length > 0);
        } finally {
          setLoading(false);
        }
      })();
    }, 200);
  }, []);

  /**
   * 導航到選中結果。
   *
   * 導頁前先過全站導頁守門 confirmNavigation()（如筆記編輯中有未儲存變更會先確認）——
   * 修 W7 對抗式復審 finding #2：搜尋結果列是 <div onClick>（非 <a>）、Enter 更無 click，
   * 舊的「只攔 <a>」防護攔不到，會靜默丟失未儲存修改。被取消就留在原地、保留下拉。
   */
  const navigateToResult = async (result: SearchItem) => {
    if (!(await confirmNavigation())) return;
    router.push(result.url);
    setIsOpen(false);
    setQuery("");
    setResults([]);
  };

  /**
   * 鍵盤導航
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % (results.length || 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + (results.length || 1)) % (results.length || 1));
        break;
      case "Enter":
        e.preventDefault();
        if (results[activeIndex]) {
          void navigateToResult(results[activeIndex]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        setQuery("");
        break;
      default:
        break;
    }
  };

  /**
   * 全域快捷鍵：Cmd/Ctrl+K
   */
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Cmd+K (macOS) 或 Ctrl+K (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  /**
   * 保持選中項目可見
   */
  useEffect(() => {
    const activeItem = resultsRef.current?.querySelector(
      `[data-index="${activeIndex}"]`
    ) as HTMLElement | null;
    activeItem?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  /**
   * 取得結果類型的標籤和圖示
   */
  function getTypeLabel(type: string): { label: string; emoji: string } {
    switch (type) {
      case "note":
        return { label: "筆記", emoji: "📝" };
      case "task":
        return { label: "任務", emoji: "✓" };
      case "canvas":
        return { label: "畫布", emoji: "🎨" };
      case "node":
        return { label: "節點", emoji: "◇" };
      case "quicklink":
        return { label: "連結", emoji: "🔗" };
      case "function":
        return { label: "功能", emoji: "⚙️" };
      default:
        return { label: type, emoji: "◆" };
    }
  }

  return (
    <div style={{ position: "relative", flex: 1, maxWidth: "400px" }}>
      <input
        ref={inputRef}
        type="text"
        placeholder="搜尋筆記、任務、畫布、功能… (Cmd+K)"
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (query.trim()) {
            setIsOpen(results.length > 0);
          }
        }}
        style={{
          width: "100%",
          padding: "var(--spacing-2) var(--spacing-3)",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border-default)",
          background: "var(--bg-surface)",
          color: "var(--text-primary)",
          fontSize: "var(--text-sm)",
          transition: "all 0.2s ease",
        }}
        aria-label="全域搜尋"
        aria-autocomplete="list"
        aria-expanded={isOpen}
      />

      {/* 搜尋結果下拉 */}
      {isOpen && (
        <div
          ref={resultsRef}
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: "var(--spacing-2)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-default)",
            background: "var(--bg-elevated)",
            boxShadow: "var(--shadow-lg)",
            zIndex: 1000,
            maxHeight: "400px",
            overflow: "auto",
          }}
          role="listbox"
        >
          {loading ? (
            <div
              style={{
                padding: "var(--spacing-4)",
                textAlign: "center",
                color: "var(--text-secondary)",
                fontSize: "var(--text-sm)",
              }}
            >
              搜尋中...
            </div>
          ) : results.length === 0 && query.trim() ? (
            <div
              style={{
                padding: "var(--spacing-4)",
                textAlign: "center",
                color: "var(--text-secondary)",
                fontSize: "var(--text-sm)",
              }}
            >
              找不到結果
            </div>
          ) : (
            results.map((result, index) => {
              const { label, emoji } = getTypeLabel(result.type);
              return (
                <div
                  key={result.id}
                  data-index={index}
                  onClick={() => navigateToResult(result)}
                  style={{
                    padding: "var(--spacing-3)",
                    borderBottom:
                      index < results.length - 1 ? "1px solid var(--border-default)" : "none",
                    background:
                      index === activeIndex
                        ? "var(--action-secondary-bg)"
                        : "transparent",
                    cursor: "pointer",
                    transition: "background 0.15s ease",
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  role="option"
                  aria-selected={index === activeIndex}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "var(--spacing-3)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "var(--text-lg)",
                        minWidth: "24px",
                      }}
                    >
                      {emoji}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          color: "var(--text-primary)",
                          fontSize: "var(--text-sm)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          marginBottom: "var(--spacing-1)",
                        }}
                        title={result.title}
                      >
                        {result.title}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          fontSize: "var(--text-xs)",
                        }}
                      >
                        <span
                          style={{
                            color: "var(--action-secondary-fg)",
                            fontWeight: 500,
                          }}
                        >
                          {label}
                        </span>
                        {result.snippet && (
                          <span
                            style={{
                              color: "var(--text-tertiary)",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              maxWidth: "200px",
                              marginLeft: "var(--spacing-2)",
                            }}
                            title={result.snippet}
                          >
                            {result.snippet}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 點擊背景關閉 */}
      {isOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999,
          }}
          onClick={() => {
            setIsOpen(false);
            setQuery("");
          }}
          role="presentation"
        />
      )}
    </div>
  );
}
