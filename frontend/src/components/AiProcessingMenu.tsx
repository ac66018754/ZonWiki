'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AskQueueItemDto } from '@/lib/api';
import { getAskQueue } from '@/lib/api';
import { AI_QUEUE_CHANGED_EVENT } from '@/lib/aiQueue';

/** 輪詢間隔（毫秒）：定時更新「進行中」數字（事件驅動為主，輪詢為保險，例如畫布提問）。 */
const POLL_INTERVAL_MS = 6000;

/**
 * Header 上的「AI 處理中」下拉選單。
 *
 * - 觸發鈕顯示「AI處理中(n)」，n = 目前進行中（Running，尚未結束）的工作數。
 * - 點開「不跳頁」，而是就地展開清單（仿全域搜尋框的預覽下拉）。
 * - 清單列出使用者的 AI 提問佇列（已答／等待中／失敗，最新在上），
 *   點項目跳到來源筆記的框選處（?mark=）或畫布。
 */
export function AiProcessingMenu() {
  const router = useRouter();
  const [items, setItems] = useState<AskQueueItemDto[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 取佇列：用 useCallback 穩定參考，供「輪詢」與「開啟時刷新」共用，
  // 避免 effect 因相依不穩定而反覆重訂閱（見全域鐵則：參考不穩定→迴圈）。
  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAskQueue({ limit: 50 });
      setItems(data);
    } catch (err) {
      setError('無法載入');
      console.error('Failed to fetch ai queue:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初次載入 + 定時輪詢 + 監聽「AI 佇列變動」事件（觸發/完成 AI 動作時即時重抓）。
  useEffect(() => {
    fetchQueue();
    const timer = setInterval(fetchQueue, POLL_INTERVAL_MS);
    // 事件驅動即時更新：AI 動作觸發/完成時會派發 AI_QUEUE_CHANGED_EVENT。
    // 觸發瞬間伺服器端的 Running 紀錄可能還沒建好，故「立刻 + 稍後」各補抓一次。
    const onChanged = () => {
      fetchQueue();
      window.setTimeout(fetchQueue, 700);
    };
    window.addEventListener(AI_QUEUE_CHANGED_EVENT, onChanged);
    return () => {
      clearInterval(timer);
      window.removeEventListener(AI_QUEUE_CHANGED_EVENT, onChanged);
    };
  }, [fetchQueue]);

  // 進行中（尚未結束）的數量 = Running。
  const runningCount = useMemo(
    () => items.filter((it) => it.status === 'Running').length,
    [items],
  );

  // 切換開關；開啟時順手抓最新。
  const toggleOpen = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        fetchQueue();
      }
      return next;
    });
  };

  // 時間格式化（DB 存 UTC → 依裝置本地時區顯示）。
  const formatTime = (iso: string): string => {
    try {
      const date = new Date(iso);
      const diffMs = Date.now() - date.getTime();
      const mins = Math.floor(diffMs / 60000);
      const hours = Math.floor(diffMs / 3600000);
      const days = Math.floor(diffMs / 86400000);
      if (mins < 1) return '剛剛';
      if (mins < 60) return `${mins} 分鐘前`;
      if (hours < 24) return `${hours} 小時前`;
      if (days < 7) return `${days} 天前`;
      return date.toLocaleDateString('zh-TW', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  // 狀態徽章（文字 + 顏色）。
  const statusBadge = (status: string): { text: string; bg: string } => {
    switch (status) {
      case 'Running':
        return { text: '等待中', bg: '#f59e0b' };
      case 'Completed':
        return { text: '已答', bg: '#10b981' };
      case 'Failed':
        return { text: '失敗', bg: '#ef4444' };
      case 'Cancelled':
        return { text: '已取消', bg: 'var(--text-tertiary)' };
      default:
        return { text: status, bg: 'var(--text-tertiary)' };
    }
  };

  // 種類顯示標籤（佇列項目的後援文字／來源）。
  const kindLabel = (kind: string): string => {
    switch (kind) {
      case 'node':
        return '開問啦提問';
      case 'beautify':
        return '美化筆記';
      case 'reformat':
        return '整理排版';
      case 'refine':
        return '精煉成筆記';
      case 'floatingnote':
        return '框選提問';
      default:
        return 'AI 工作';
    }
  };

  // 點項目導航：一律導到「AI 處理佇列」頁面並預選該筆，可在那裡看完整 log（含失敗原因）、
  // 再由明細頁的「前往來源」跳到畫布／來源筆記。
  const handleItemClick = (item: AskQueueItemDto) => {
    router.push(`/ai-queue?session=${encodeURIComponent(item.sessionId)}`);
    setOpen(false);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {/* 觸發鈕：AI處理中(n) */}
      <button
        className="nav-item"
        onClick={toggleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="AI 處理中的工作"
        style={{
          // 只重置 <button> 的預設外觀，其餘交給 .nav-item（與其他導覽項一致，不特立獨行）。
          background: 'transparent',
          border: 'none',
          font: 'inherit',
          cursor: 'pointer',
        }}
      >
        AI處理中
        <span className="nav-hint" aria-label={`進行中 ${runningCount} 筆`}>
          ({runningCount})
        </span>
      </button>

      {open && (
        <>
          {/* 點背景關閉（仿全域搜尋） */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 999 }}
            onClick={() => setOpen(false)}
            role="presentation"
          />

          {/* 展開的清單 */}
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 'var(--spacing-2)',
              width: 340,
              maxHeight: 420,
              overflowY: 'auto',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              background: 'var(--bg-elevated)',
              boxShadow: 'var(--shadow-lg)',
              zIndex: 1000,
            }}
            role="listbox"
          >
            {/* 標題列 + 重新整理（吸頂） */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--spacing-2) var(--spacing-3)',
                borderBottom: '1px solid var(--border-default)',
                position: 'sticky',
                top: 0,
                background: 'var(--bg-elevated)',
              }}
            >
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                AI 處理佇列{runningCount > 0 ? `（進行中 ${runningCount}）` : ''}
              </span>
              <button
                onClick={fetchQueue}
                disabled={loading}
                title="重新整理"
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: loading ? 'default' : 'pointer',
                  fontSize: 'var(--text-sm)',
                  opacity: loading ? 0.5 : 1,
                }}
              >
                🔄
              </button>
            </div>

            {/* 內容：載入 / 錯誤 / 空 / 清單 */}
            {loading && items.length === 0 ? (
              <div style={{ padding: 'var(--spacing-4)', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
                載入中…
              </div>
            ) : error ? (
              <div style={{ padding: 'var(--spacing-4)', textAlign: 'center', color: 'var(--status-error-fg)', fontSize: 'var(--text-sm)' }}>
                {error}
              </div>
            ) : items.length === 0 ? (
              <div style={{ padding: 'var(--spacing-4)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
                暫無提問
              </div>
            ) : (
              items.map((item) => {
                const badge = statusBadge(item.status);
                // 一律可點：導到「AI 處理佇列」明細頁（不再依來源是否存在而禁用）。
                const clickable = true;
                const sourceTitle =
                  item.noteTitle ?? item.noteSlug ?? (item.kind === 'node' ? '開問啦畫布' : '(未知筆記)');
                const question = item.questionText || item.anchorText || kindLabel(item.kind);

                return (
                  <div
                    key={item.sessionId}
                    onClick={() => clickable && handleItemClick(item)}
                    role="option"
                    aria-selected={false}
                    title={clickable ? '' : '來源已刪除'}
                    style={{
                      padding: 'var(--spacing-3)',
                      borderBottom: '1px solid var(--border-default)',
                      cursor: clickable ? 'pointer' : 'not-allowed',
                      opacity: clickable ? 1 : 0.6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', marginBottom: 4 }}>
                      <span
                        style={{
                          fontSize: 'var(--text-xs)',
                          fontWeight: 600,
                          padding: '2px 6px',
                          borderRadius: 'var(--radius-sm)',
                          color: 'white',
                          background: badge.bg,
                        }}
                      >
                        {badge.text}
                      </span>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                        {formatTime(item.createdDateTime)}
                      </span>
                    </div>
                    <div
                      title={question}
                      style={{
                        fontSize: 'var(--text-sm)',
                        fontWeight: 500,
                        color: 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {question}
                    </div>
                    <div
                      title={sourceTitle}
                      style={{
                        fontSize: 'var(--text-xs)',
                        color: 'var(--text-secondary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      📝 {sourceTitle}
                    </div>
                    {item.status === 'Failed' && item.errorText && (
                      <div style={{ marginTop: 4, fontSize: 'var(--text-xs)', color: 'var(--status-error-fg)' }} title={item.errorText}>
                        {item.errorText}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {/* footer：開啟完整「AI 處理佇列」頁（可按類別篩選、看完整 log） */}
            <button
              onClick={() => {
                router.push('/ai-queue');
                setOpen(false);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'center',
                padding: 'var(--spacing-3)',
                background: 'transparent',
                border: 'none',
                borderTop: '1px solid var(--border-default)',
                color: 'var(--accent-primary, #6366f1)',
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                cursor: 'pointer',
                position: 'sticky',
                bottom: 0,
              }}
            >
              開啟 AI 處理佇列 →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
