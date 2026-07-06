"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AskQueueItemDto,
  AskQueueDetailDto,
  AskQueueKind,
  AskQueueStatus,
  getAskQueue,
  getAskQueueDetail,
} from "@/lib/api";
import { useCurrentUser } from "@/lib/swr";
import { formatDateTime } from "@/lib/formatters";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import { logger } from "@/lib/logger";
import { markNoteContextSwitch } from "@/lib/noteNav";

/**
 * AI 處理佇列頁面（/ai-queue）。
 *
 * - 左欄：所有 AI 工作（精煉成筆記／開問啦提問／框選提問／美化／排版），可依「類別」與「狀態」篩選。
 * - 右欄：選取項目的「完整明細」——狀態、時間、來源、完整 prompt、完整錯誤訊息、逐則串流 log。
 * - 進入方式：從 Header 的「AI 處理佇列」下拉點任一項，會帶 ?session=<id> 導到本頁並預選。
 *
 * 設計目的：dropdown 只顯示截斷摘要，失敗時看不到完整 log；本頁專供「診斷為何失敗」。
 */

/** 類別篩選選項（含「全部」）。 */
const KIND_FILTERS: { value: AskQueueKind | "all"; label: string; icon: string }[] = [
  { value: "all", label: "全部", icon: "📋" },
  { value: "refine", label: "精煉成筆記", icon: "✨" },
  { value: "node", label: "開問啦提問", icon: "🎨" },
  { value: "floatingnote", label: "框選提問", icon: "✍️" },
  { value: "beautify", label: "美化筆記", icon: "💅" },
  { value: "reformat", label: "整理排版", icon: "🧹" },
];

/** 狀態篩選選項（含「全部」）。 */
const STATUS_FILTERS: { value: AskQueueStatus | "all"; label: string }[] = [
  { value: "all", label: "全部狀態" },
  { value: "Running", label: "處理中" },
  { value: "Completed", label: "已完成" },
  { value: "Failed", label: "失敗" },
];

/** 種類顯示標籤。 */
function kindLabel(kind: string): string {
  const found = KIND_FILTERS.find((k) => k.value === kind);
  return found ? found.label : "AI 工作";
}

/** 狀態徽章（文字 + 顏色）。 */
function statusBadge(status: string): { text: string; bg: string } {
  switch (status) {
    case "Running":
      return { text: "處理中", bg: "#f59e0b" };
    case "Completed":
      return { text: "已完成", bg: "#10b981" };
    case "Failed":
      return { text: "失敗", bg: "#ef4444" };
    case "Cancelled":
      return { text: "已取消", bg: "var(--text-tertiary)" };
    default:
      return { text: status, bg: "var(--text-tertiary)" };
  }
}

/** 內頁（使用 useSearchParams，需包在 Suspense 內）。 */
function AiQueueInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionParam = searchParams.get("session");

  // 目前登入者（僅用於時區顯示）改由共用的 SWR 快取取得，避免重複打 /api/me。
  const { data: user } = useCurrentUser();
  const [items, setItems] = useState<AskQueueItemDto[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [kindFilter, setKindFilter] = useState<AskQueueKind | "all">("all");
  const [statusFilter, setStatusFilter] = useState<AskQueueStatus | "all">("all");

  const [selectedId, setSelectedId] = useState<string | null>(sessionParam);
  const [detail, setDetail] = useState<AskQueueDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const tz = user?.timeZone || DEFAULT_TIMEZONE;

  // 取清單（依類別 / 狀態篩選）。
  const fetchList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const data = await getAskQueue({
        kind: kindFilter === "all" ? undefined : kindFilter,
        status: statusFilter === "all" ? undefined : statusFilter,
        limit: 100,
      });
      setItems(data);
    } catch (err) {
      setListError("無法載入佇列");
      logger.error("Failed to fetch ai queue list:", err);
    } finally {
      setListLoading(false);
    }
  }, [kindFilter, statusFilter]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // 取選取項目的明細。
  const fetchDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const data = await getAskQueueDetail(id);
      if (data) {
        setDetail(data);
      } else {
        setDetail(null);
        setDetailError("找不到此工作（可能已刪除或非本人）");
      }
    } catch (err) {
      setDetail(null);
      setDetailError("無法載入明細");
      logger.error("Failed to fetch ai queue detail:", err);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) {
      fetchDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, fetchDetail]);

  // 明細自動輪詢：只在「選取的工作仍在處理中」時，每 3.5 秒刷新一次明細，
  // 讓後援鏈的每一次嘗試（含前一棒逾時被砍後、接著跑的下一次/下一家）即時出現在「嘗試歷程」。
  // 工作一旦結束（完成/失敗/取消）就停止輪詢，顧及 VM 負載；清單本身仍不自動輪詢。
  useEffect(() => {
    if (!selectedId || detail?.status !== "Running") {
      return;
    }
    const timer = setInterval(() => {
      fetchDetail(selectedId);
    }, 3500);
    return () => clearInterval(timer);
  }, [selectedId, detail?.status, fetchDetail]);

  // 點清單項目：選取 + 更新網址（?session=）以利分享 / 重新整理保留。
  const handleSelect = (id: string) => {
    setSelectedId(id);
    router.replace(`/ai-queue?session=${encodeURIComponent(id)}`);
  };

  // 前往來源（畫布 / 來源筆記）。
  const goToSource = (d: AskQueueDetailDto) => {
    if (d.kind === "node") {
      router.push("/canvas");
    } else if (d.noteSlug) {
      const url = `/notes/${encodeURIComponent(d.noteSlug)}${d.markId ? `?mark=${encodeURIComponent(d.markId)}` : ""}`;
      // 從「非筆記情境」（AI 佇列）進入筆記＝新脈絡：截斷返回堆疊至該筆記，
      // 使返回走分類階層而非跳回無關舊筆記（對齊 GlobalSearch 的 markNoteContextSwitch）。
      markNoteContextSwitch(url);
      router.push(url);
    }
  };

  const runningCount = useMemo(
    () => items.filter((it) => it.status === "Running").length,
    [items],
  );

  return (
    <div style={{ padding: "var(--spacing-5)", maxWidth: 1200, margin: "0 auto" }}>
      {/* 頁首 */}
      <div style={{ marginBottom: "var(--spacing-5)" }}>
        <h1 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: 700 }}>🤖 AI 處理佇列</h1>
        <p
          style={{
            margin: "var(--spacing-2) 0 0 0",
            fontSize: "var(--text-sm)",
            color: "var(--text-secondary)",
          }}
        >
          所有 AI 工作（精煉、提問、美化、排版）的處理紀錄。點左側任一項可看完整輸入、結果與錯誤 log。
          {runningCount > 0 ? `目前處理中 ${runningCount} 筆。` : ""}
        </p>
      </div>

      <div style={{ display: "flex", gap: "var(--spacing-4)", alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* 左欄：篩選 + 清單 */}
        <div
          style={{
            flex: "1 1 320px",
            minWidth: 300,
            maxWidth: 420,
            display: "flex",
            flexDirection: "column",
            gap: "var(--spacing-3)",
          }}
        >
          {/* 類別篩選（晶片列） */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--spacing-2)" }}>
            {KIND_FILTERS.map((k) => {
              const active = kindFilter === k.value;
              return (
                <button
                  key={k.value}
                  onClick={() => setKindFilter(k.value)}
                  aria-pressed={active}
                  style={{
                    padding: "4px 10px",
                    borderRadius: "var(--radius-full, 999px)",
                    border: `1px solid ${active ? "var(--accent-primary, #6366f1)" : "var(--border-default)"}`,
                    background: active ? "var(--accent-primary, #6366f1)" : "transparent",
                    color: active ? "white" : "var(--text-secondary)",
                    fontSize: "var(--text-xs)",
                    cursor: "pointer",
                  }}
                >
                  {k.icon} {k.label}
                </button>
              );
            })}
          </div>

          {/* 狀態篩選 + 重新整理 */}
          <div style={{ display: "flex", gap: "var(--spacing-2)", alignItems: "center" }}>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AskQueueStatus | "all")}
              style={{
                flex: 1,
                padding: "6px 8px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-default)",
                background: "var(--bg-elevated)",
                color: "var(--text-primary)",
                fontSize: "var(--text-sm)",
              }}
            >
              {STATUS_FILTERS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <button
              onClick={fetchList}
              disabled={listLoading}
              title="重新整理"
              style={{
                padding: "6px 10px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-default)",
                background: "var(--bg-elevated)",
                cursor: listLoading ? "default" : "pointer",
                opacity: listLoading ? 0.5 : 1,
              }}
            >
              🔄
            </button>
          </div>

          {/* 清單 */}
          <div
            style={{
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-lg)",
              background: "var(--bg-elevated)",
              overflow: "hidden",
            }}
          >
            {listLoading && items.length === 0 ? (
              <div style={{ padding: "var(--spacing-4)", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>
                載入中…
              </div>
            ) : listError ? (
              <div style={{ padding: "var(--spacing-4)", color: "var(--status-danger-fg)", fontSize: "var(--text-sm)" }}>
                {listError}
              </div>
            ) : items.length === 0 ? (
              <div style={{ padding: "var(--spacing-4)", color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
                沒有符合條件的工作。
              </div>
            ) : (
              items.map((item) => {
                const badge = statusBadge(item.status);
                const selected = item.sessionId === selectedId;
                const label = item.questionText || item.anchorText || item.noteTitle || kindLabel(item.kind);
                return (
                  <button
                    key={item.sessionId}
                    onClick={() => handleSelect(item.sessionId)}
                    aria-current={selected ? "true" : undefined}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "var(--spacing-3)",
                      borderBottom: "1px solid var(--border-default)",
                      background: selected ? "var(--bg-hover, rgba(99,102,241,0.08))" : "transparent",
                      borderLeft: selected ? "3px solid var(--accent-primary, #6366f1)" : "3px solid transparent",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-2)", marginBottom: 4 }}>
                      <span
                        style={{
                          fontSize: "var(--text-xs)",
                          fontWeight: 600,
                          padding: "2px 6px",
                          borderRadius: "var(--radius-sm)",
                          color: "white",
                          background: badge.bg,
                        }}
                      >
                        {badge.text}
                      </span>
                      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                        {kindLabel(item.kind)}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: "var(--text-sm)",
                        fontWeight: 500,
                        color: "var(--text-primary)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {label}
                    </div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginTop: 2 }}>
                      {formatDateTime(item.createdDateTime, tz)}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* 右欄：明細 */}
        <div
          style={{
            flex: "2 1 480px",
            minWidth: 320,
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-lg)",
            background: "var(--bg-elevated)",
            padding: "var(--spacing-4)",
            minHeight: 300,
          }}
        >
          {!selectedId ? (
            <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
              ← 從左側點一筆工作以查看完整明細與 log。
            </div>
          ) : detailLoading ? (
            <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>載入明細中…</div>
          ) : detailError ? (
            <div style={{ color: "var(--status-danger-fg)", fontSize: "var(--text-sm)" }}>{detailError}</div>
          ) : detail ? (
            <DetailPanel
              detail={detail}
              tz={tz}
              detailLoading={detailLoading}
              onRefresh={() => selectedId && fetchDetail(selectedId)}
              onGoToSource={() => goToSource(detail)}
              onGoToAnswer={() => {
                if (!detail.answerNoteSlug) return;
                const url = `/notes/${encodeURIComponent(detail.answerNoteSlug)}`;
                // 從「非筆記情境」（AI 佇列）進入產生的筆記＝新脈絡：先截斷返回堆疊（對齊 GlobalSearch）。
                markNoteContextSwitch(url);
                router.push(url);
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** 右欄明細內容。 */
function DetailPanel({
  detail,
  tz,
  detailLoading,
  onRefresh,
  onGoToSource,
  onGoToAnswer,
}: {
  detail: AskQueueDetailDto;
  tz: string;
  detailLoading: boolean;
  onRefresh: () => void;
  onGoToSource: () => void;
  onGoToAnswer: () => void;
}) {
  const badge = statusBadge(detail.status);
  const hasSource = detail.kind === "node" || !!detail.noteSlug;
  const isRunning = detail.status === "Running";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-4)" }}>
      {/* 標頭：徽章 + 類別 + 時間 */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-2)", flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: "var(--text-sm)",
            fontWeight: 700,
            padding: "3px 10px",
            borderRadius: "var(--radius-sm)",
            color: "white",
            background: badge.bg,
          }}
        >
          {badge.text}
        </span>
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-primary)" }}>
          {kindLabel(detail.kind)}
        </span>
      </div>

      {/* 時間 */}
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
        建立：{formatDateTime(detail.createdDateTime, tz)}　·　更新：{formatDateTime(detail.updatedDateTime, tz)}
      </div>

      {/* AI 供應者 / 模型：看出這次是哪家提供商在處理，失敗時較好回報問題 */}
      {(detail.aiProvider || detail.aiModelId) && (
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
          🛰️ 供應者：<b>{detail.aiProvider ?? "—"}</b>
          {detail.aiModelId ? <>　·　模型：<code>{detail.aiModelId}</code></> : null}
        </div>
      )}

      {/* 導航按鈕 + 重新整理明細 */}
      <div style={{ display: "flex", gap: "var(--spacing-2)", flexWrap: "wrap", alignItems: "center" }}>
        {hasSource && (
          <button className="tk-btn" onClick={onGoToSource} title="前往來源">
            ↗ 前往來源{detail.kind === "node" ? "畫布" : "筆記"}
          </button>
        )}
        {detail.answerNoteSlug && (
          <button className="tk-btn" onClick={onGoToAnswer} title="查看產生的筆記">
            📝 查看產生的筆記
          </button>
        )}
        <button className="tk-btn" onClick={onRefresh} disabled={detailLoading} title="重新整理此工作的明細">
          🔄 重新整理明細
        </button>
        {isRunning && (
          <span style={{ fontSize: "var(--text-xs)", color: "var(--accent-primary, #6366f1)" }}>
            ● 處理中，每 3.5 秒自動更新…
          </span>
        )}
      </div>

      {/* 錯誤訊息（Failed 時最顯眼） */}
      {detail.errorText && (
        <Section title="❌ 錯誤訊息" tone="error">
          <pre style={preStyle}>{detail.errorText}</pre>
        </Section>
      )}

      {/* 提問 / 標籤 */}
      {detail.questionText && (
        <Section title="提問 / 標籤">
          <pre style={preStyle}>{detail.questionText}</pre>
        </Section>
      )}

      {/* 框選文字 */}
      {detail.anchorText && (
        <Section title="框選文字">
          <pre style={preStyle}>{detail.anchorText}</pre>
        </Section>
      )}

      {/* 後援鏈「嘗試歷程」：只取 stage 訊息，視覺化呈現換家/失敗，讓使用者看到走了哪幾家、各自錯誤。 */}
      {detail.messages.some((m) => m.role === "stage") && (
        <Section title="嘗試歷程（後援鏈：Claude → Google AI Studio → banana）">
          {/* 6 鏈路與預算說明：讓使用者理解為何會有多次嘗試、以及何時會換家/被砍。 */}
          <div
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--text-secondary)",
              background: "var(--bg-subtle, rgba(127,127,127,0.06))",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-sm)",
              padding: "var(--spacing-2) var(--spacing-3)",
              marginBottom: "var(--spacing-2)",
              lineHeight: 1.6,
            }}
          >
            共用預設的 AI 走「<b>6 次後援鏈</b>」：依序 ①Claude CLI ②Google AI Studio ③banana，
            <b>每家最多試 2 次</b>（失敗才換下一次／下一家），合計 6 次，任一次成功即停、全部失敗才算最終失敗。
            <br />
            預算：<b>背景總預算 30 分鐘</b>、<b>claude 單次上限 5 分鐘</b>。
            某次若逾時或出錯被砍，會接著跑下一次（下方逐條列出）；即使被砍，這裡仍看得到它跑過。
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-1)" }}>
            {detail.messages
              .filter((m) => m.role === "stage")
              .map((m) => {
                const failed = m.content.startsWith("✗");
                return (
                  <div
                    key={m.seqNo}
                    style={{
                      fontSize: "var(--text-sm)",
                      padding: "var(--spacing-2) var(--spacing-3)",
                      borderRadius: "var(--radius-sm)",
                      borderLeft: `3px solid ${failed ? "var(--status-error-fg, #ef4444)" : "var(--accent-primary, #6366f1)"}`,
                      background: "var(--bg-subtle, rgba(127,127,127,0.06))",
                      color: failed ? "var(--status-error-fg, #ef4444)" : "var(--text-primary)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {m.content}
                  </div>
                );
              })}
          </div>
        </Section>
      )}

      {/* 完整 prompt */}
      {detail.promptText && (
        <Section title="送給 AI 的完整 prompt">
          <pre style={preStyle}>{detail.promptText}</pre>
        </Section>
      )}

      {/* 逐則串流訊息（完整 log） */}
      {detail.messages.length > 0 && (
        <Section title={`完整 log（${detail.messages.length} 則訊息）`}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-2)" }}>
            {detail.messages.map((m) => (
              <div
                key={m.seqNo}
                style={{
                  borderLeft: "2px solid var(--border-default)",
                  paddingLeft: "var(--spacing-3)",
                }}
              >
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                  #{m.seqNo} · {m.role} · {formatDateTime(m.createdDateTime, tz)}
                </div>
                <pre style={preStyle}>{m.content}</pre>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* token 用量（非空才顯示） */}
      {detail.tokenUsageJson && detail.tokenUsageJson !== "{}" && (
        <Section title="Token 用量">
          <pre style={preStyle}>{detail.tokenUsageJson}</pre>
        </Section>
      )}
    </div>
  );
}

/** 區塊容器（標題 + 內容）。 */
function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "error";
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: "var(--text-xs)",
          fontWeight: 700,
          color: tone === "error" ? "var(--status-danger-fg)" : "var(--text-secondary)",
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

/** 等寬、可換行、可捲動的內容區塊樣式（供完整 log / prompt / 錯誤顯示）。 */
const preStyle: React.CSSProperties = {
  margin: 0,
  padding: "var(--spacing-3)",
  // 用會「隨主題變色」的變數（暗色/夜間是深底），而非固定的淺色 #f6f6f7——否則暗色模式變成
  // 淺底＋淺字、完全看不清（錯誤訊息/prompt/log 四個區塊都吃這個樣式）。加邊框增加區塊辨識度。
  background: "var(--bg-surface-secondary)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-md)",
  fontSize: "var(--text-xs)",
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 360,
  overflow: "auto",
  color: "var(--text-primary)",
};

/**
 * AI 處理佇列頁面（外殼）。useSearchParams 需包在 Suspense 內（Next App Router 要求）。
 */
export default function AiQueuePage() {
  return (
    <Suspense fallback={<div style={{ padding: "var(--spacing-5)", color: "var(--text-tertiary)" }}>載入中…</div>}>
      <AiQueueInner />
    </Suspense>
  );
}
