"use client";

import { useCallback, useEffect, useState } from "react";
import { useSWRConfig } from "swr";
import { useVocabulary, revalidateAllVocabulary } from "@/lib/swr";
import { SkeletonListItem } from "@/components/Skeleton";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { AddVocabularyForm } from "./AddVocabularyForm";
import { VocabularyRow } from "./VocabularyRow";
import { PAGE_SIZE, SEARCH_DEBOUNCE_MS, VOCAB_STATE_OPTIONS } from "../vocabularyUtils";

/**
 * 單字庫清單模式（設計書 §3.4 第一點）：新增區 + 搜尋/狀態篩選 + 清單 + 分頁。
 */
export function VocabularyListView() {
  const { mutate: globalMutate } = useSWRConfig();

  // 搜尋：受控輸入 + debounce 後的實際查詢字（避免每鍵重抓）。
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1); // 搜尋條件變更後回到第 1 頁。
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const {
    data,
    error,
    isLoading,
  } = useVocabulary(stateFilter || null, search || null, page, PAGE_SIZE);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 分頁收斂：刪除最後一筆使 total 變小、totalPages 縮回時，若 page 已超出範圍
  // （例如停在第 2 頁卻只剩 1 頁），抓 offset 會得空陣列而落入假空狀態、且分頁列因
  // totalPages<=1 隱藏，使用者被困無法回第 1 頁。採 React 官方「render 期調整 state」模式
  // 直接夾回合法上界（取代會觸發 set-state-in-effect 級聯渲染警告的 effect）；此賦值會收斂
  // （夾回後 page===totalPages，條件不再成立），立即重渲染即以正確 page 重抓。
  if (page > totalPages) {
    setPage(totalPages);
  }

  /** 任一異動後重抓清單與到期佇列（複習改 due、CRUD 改清單，兩者互相影響）。 */
  const revalidate = useCallback(() => {
    revalidateAllVocabulary(globalMutate);
  }, [globalMutate]);

  const hasSearchOrFilter = search !== "" || stateFilter !== "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-5)" }}>
      {/* 新增區 */}
      <AddVocabularyForm onCreated={revalidate} />

      {/* 工具列：搜尋 + 狀態篩選 */}
      <div
        style={{
          display: "flex",
          gap: "var(--spacing-3)",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <Input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="搜尋單字或釋義"
          aria-label="搜尋單字"
          style={{ flex: "1 1 200px" }}
        />
        <select
          className="input"
          value={stateFilter}
          onChange={(event) => {
            setStateFilter(event.target.value);
            setPage(1);
          }}
          aria-label="依狀態篩選"
          style={{ width: "auto" }}
        >
          {VOCAB_STATE_OPTIONS.map((option) => (
            <option key={option.value || "all"} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* 清單 / 狀態分支 */}
      {error ? (
        <div
          role="alert"
          style={{
            padding: "var(--spacing-4)",
            background: "var(--status-danger-bg)",
            color: "var(--status-danger-fg)",
            borderRadius: "var(--radius-lg)",
          }}
        >
          無法載入單字清單，請稍後重試。
        </div>
      ) : isLoading && items.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-2)" }}>
          <SkeletonListItem />
          <SkeletonListItem />
          <SkeletonListItem />
        </div>
      ) : items.length === 0 ? (
        <div
          style={{
            padding: "var(--spacing-8)",
            textAlign: "center",
            color: "var(--text-secondary)",
            background: "var(--bg-surface)",
            borderRadius: "var(--radius-lg)",
            border: "1px dashed var(--border-default)",
          }}
        >
          <span style={{ fontSize: "var(--text-2xl)", display: "block", marginBottom: "var(--spacing-2)" }}>
            📭
          </span>
          <p style={{ margin: 0, fontWeight: 500 }}>
            {hasSearchOrFilter ? "沒有符合條件的單字" : "尚無單字"}
          </p>
          <p style={{ margin: "var(--spacing-2) 0 0", fontSize: "var(--text-sm)" }}>
            {hasSearchOrFilter ? "換個關鍵字或篩選條件試試。" : "用上方「新增單字」開始建立你的單字庫。"}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-2)" }}>
          {items.map((word) => (
            <VocabularyRow key={word.id} word={word} onChanged={revalidate} />
          ))}
        </div>
      )}

      {/* 分頁控制 */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--spacing-3)",
          }}
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1}
          >
            ← 上一頁
          </Button>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
            第 {page} / {totalPages} 頁
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={page >= totalPages}
          >
            下一頁 →
          </Button>
        </div>
      )}
    </div>
  );
}
