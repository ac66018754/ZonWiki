"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { searchAll, SearchResult } from "@/lib/api";
import { logger } from "@/lib/logger";

/**
 * 全域搜尋下拉組件
 * - 支援 Cmd/Ctrl+K 快捷鍵
 * - 搜尋筆記、任務
 * - 鍵盤上下選取 + Enter 跳轉
 */
export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
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
        try {
          // 使用後端搜尋 API 同時搜尋筆記、任務、畫布、節點
          const results = await searchAll(q);
          setResults(results);
          setIsOpen(true);
        } catch (err) {
          logger.error("Search failed:", err);
          setResults([]);
        } finally {
          setLoading(false);
        }
      })();
    }, 200);
  }, []);

  /**
   * 導航到選中結果
   */
  const navigateToResult = (result: SearchResult) => {
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
          navigateToResult(results[activeIndex]);
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
      default:
        return { label: type, emoji: "◆" };
    }
  }

  return (
    <div style={{ position: "relative", flex: 1, maxWidth: "400px" }}>
      <input
        ref={inputRef}
        type="text"
        placeholder="搜尋筆記、任務、畫布、節點… (Cmd+K)"
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
