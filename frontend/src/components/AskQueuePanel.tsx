'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AskQueueItemDto } from '@/lib/api';
import { getAskQueue } from '@/lib/api';
import { FloatingPanel } from './FloatingPanel';

/**
 * 提問佇列浮動面板
 *
 * 功能：
 * - 取得當前使用者的提問佇列（AiSession 記錄）
 * - 列出最新優先，顯示狀態徽章、提問文字、來源筆記標題、建立時間
 * - 點擊項目跳轉到來源筆記的框選位置 / 答案筆記
 * - 手動重新整理按鈕
 */
export function AskQueuePanel() {
  const router = useRouter();

  // 佇列項目及載入狀態
  const [items, setItems] = useState<AskQueueItemDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 預設位置：右上角（避開頂端置頂工具列）
  const defaultPos = useMemo(
    () => ({
      x: typeof window !== 'undefined' ? Math.max(8, window.innerWidth - 286) : 1000,
      y: 84,
    }),
    [],
  );

  // 取得佇列
  const fetchQueue = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAskQueue({ limit: 50 });
      setItems(data);
    } catch (err) {
      setError('無法載入提問佇列');
      console.error('Failed to fetch ask queue:', err);
    } finally {
      setLoading(false);
    }
  };

  // 初始載入
  useEffect(() => {
    fetchQueue();
  }, []);

  // 點擊項目：導航到來源筆記或答案筆記
  const handleItemClick = (item: AskQueueItemDto) => {
    if (item.kind === 'floatingnote') {
      // floatingnote：導航到來源筆記的框選位置
      if (!item.noteSlug) {
        // 來源筆記已被刪除
        return;
      }
      const url = `/notes/${encodeURIComponent(item.noteSlug)}${item.markId ? `?mark=${encodeURIComponent(item.markId)}` : ''}`;
      router.push(url);
    } else if (item.kind === 'node') {
      // node（畫布提問）：本 app 的畫布不支援以 URL 深連結到特定畫布/節點，
      // 沿用既有做法（NoteMarksLayer / ShortcutRuntime）導向畫布主頁。
      router.push('/canvas');
    }
  };

  // 狀態徽章文字與顏色
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Running':
        return { text: '等待中', class: 'status-badge--running' };
      case 'Completed':
        return { text: '已答', class: 'status-badge--completed' };
      case 'Failed':
        return { text: '失敗', class: 'status-badge--failed' };
      default:
        return { text: status, class: '' };
    }
  };

  // 格式化時間（UTC → 設備本地時區）
  const formatTime = (isoString: string): string => {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();

      // 相對時間
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return '剛剛';
      if (diffMins < 60) return `${diffMins} 分鐘前`;
      if (diffHours < 24) return `${diffHours} 小時前`;
      if (diffDays < 7) return `${diffDays} 天前`;

      // 絕對時間（超過 7 天）
      return date.toLocaleDateString('zh-TW', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  // 內容區樣式
  const renderContent = () => {
    if (loading && items.length === 0) {
      return (
        <div style={{ padding: 'var(--spacing-3)', textAlign: 'center', color: 'var(--text-secondary)' }}>
          載入中...
        </div>
      );
    }

    if (error) {
      return (
        <div style={{ padding: 'var(--spacing-3)', textAlign: 'center', color: 'var(--status-error-fg)' }}>
          {error}
        </div>
      );
    }

    if (items.length === 0) {
      return (
        <div style={{ padding: 'var(--spacing-3)', textAlign: 'center', color: 'var(--text-tertiary)' }}>
          暫無提問
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {items.map((item) => {
          const statusBadge = getStatusBadge(item.status);
          // floatingnote 需有來源筆記 slug 才可跳轉；node 一律可導向畫布主頁。
          const isClickable = item.kind === 'floatingnote' ? !!item.noteSlug : true;
          const sourceTitle = item.noteTitle ?? item.noteSlug ?? '(未知筆記)';
          const question = item.questionText || item.anchorText || '(無內容)';

          return (
            <div
              key={item.sessionId}
              onClick={() => isClickable && handleItemClick(item)}
              style={{
                padding: 'var(--spacing-3)',
                borderBottom: '1px solid var(--border-default)',
                cursor: isClickable ? 'pointer' : 'not-allowed',
                opacity: isClickable ? 1 : 0.6,
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => {
                if (isClickable) {
                  (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--bg-surface-secondary)';
                }
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent';
              }}
              title={isClickable ? '' : '來源已刪除'}
            >
              {/* 狀態徽章 + 時間 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', marginBottom: 'var(--spacing-2)' }}>
                <span
                  style={{
                    display: 'inline-block',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 600,
                    padding: '2px 6px',
                    borderRadius: 'var(--radius-sm)',
                    color: 'white',
                    backgroundColor:
                      item.status === 'Running'
                        ? '#f59e0b'
                        : item.status === 'Completed'
                          ? '#10b981'
                          : '#ef4444',
                  }}
                >
                  {statusBadge.text}
                </span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  {formatTime(item.createdDateTime)}
                </span>
              </div>

              {/* 提問文字 */}
              <p
                style={{
                  margin: 0,
                  marginBottom: 'var(--spacing-1)',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-primary)',
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={question}
              >
                {question}
              </p>

              {/* 來源筆記標題 */}
              <p
                style={{
                  margin: 0,
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={sourceTitle}
              >
                📝 {sourceTitle}
              </p>

              {/* Failed 時顯示錯誤訊息 */}
              {item.status === 'Failed' && item.errorText && (
                <p
                  style={{
                    margin: 'var(--spacing-2) 0 0 0',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--status-error-fg)',
                    lineHeight: 1.3,
                  }}
                  title={item.errorText}
                >
                  {item.errorText}
                </p>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <FloatingPanel
      id="ask-queue"
      title="提問佇列"
      defaultPos={defaultPos}
      width={300}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* 重新整理按鈕 */}
        <div style={{ padding: 'var(--spacing-2)', borderBottom: '1px solid var(--border-default)' }}>
          <button
            onClick={fetchQueue}
            disabled={loading}
            style={{
              width: '100%',
              padding: 'var(--spacing-2)',
              fontSize: 'var(--text-sm)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-surface)',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              transition: 'background-color 0.2s',
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--bg-surface-secondary)';
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--bg-surface)';
            }}
          >
            {loading ? '載入中...' : '🔄 重新整理'}
          </button>
        </div>

        {/* 項目列表 */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {renderContent()}
        </div>
      </div>
    </FloatingPanel>
  );
}
