'use client';

import React, { useEffect, useState } from 'react';
import { getNoteRevisions, type NoteRevision } from '@/lib/api';
import { formatFullDateTime } from '@/lib/formatters';
import { DEFAULT_TIMEZONE } from '@/lib/constants';

interface NoteEditHistoryProps {
  /** 筆記 ID */
  noteId: string;
  /** 用戶時區 */
  userTimeZone?: string;
}

/**
 * 編輯歷史時間軸
 * 顯示筆記版本列表、建立者、時間戳、變更類型
 */
export function NoteEditHistory({ noteId, userTimeZone = DEFAULT_TIMEZONE }: NoteEditHistoryProps) {
  const [revisions, setRevisions] = useState<NoteRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRevision, setExpandedRevision] = useState<string | null>(null);

  // 載入版本列表
  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const data = await getNoteRevisions(noteId);
        setRevisions(data);
      } catch {
        // 錯誤時顯示空列表
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [noteId]);

  if (loading) {
    return (
      <div
        style={{
          padding: 'var(--spacing-6)',
          textAlign: 'center',
          color: 'var(--text-secondary)',
        }}
      >
        <p style={{ margin: 0 }}>載入歷史中...</p>
      </div>
    );
  }

  if (revisions.length === 0) {
    return (
      <div
        style={{
          padding: 'var(--spacing-6)',
          textAlign: 'center',
          color: 'var(--text-tertiary)',
        }}
      >
        <p style={{ margin: 0 }}>暫無版本歷史</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
      {revisions.map((revision, index) => (
        <RevisionItem
          key={revision.id}
          revision={revision}
          isNewest={index === 0}
          isOldest={index === revisions.length - 1}
          isExpanded={expandedRevision === revision.id}
          onToggleExpand={() =>
            setExpandedRevision(
              expandedRevision === revision.id ? null : revision.id
            )
          }
          userTimeZone={userTimeZone}
        />
      ))}
    </div>
  );
}

/**
 * 單個版本項目
 */
interface RevisionItemProps {
  revision: NoteRevision;
  isNewest: boolean;
  isOldest: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  userTimeZone: string;
}

function RevisionItem({
  revision,
  isNewest,
  isOldest,
  isExpanded,
  onToggleExpand,
  userTimeZone,
}: RevisionItemProps) {
  const formatTime = (dateStr: string) =>
    formatFullDateTime(dateStr, userTimeZone);

  // 變更類型標籤
  const getChangeKindLabel = (kind: string): { label: string; icon: string } => {
    const kindMap: Record<string, { label: string; icon: string }> = {
      create: { label: '建立', icon: '✨' },
      update: { label: '編輯', icon: '✏️' },
      reformat: { label: '排版調整', icon: '⚙️' },
      beautify: { label: '內容美化', icon: '✨' },
    };
    return kindMap[kind] || { label: kind, icon: '📝' };
  };

  const changeKind = getChangeKindLabel(revision.changeKind);

  return (
    <div
      style={{
        padding: 'var(--spacing-4)',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor =
          'var(--border-strong)';
        (e.currentTarget as HTMLElement).style.boxShadow =
          'var(--shadow-sm)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor =
          'var(--border-default)';
        (e.currentTarget as HTMLElement).style.boxShadow = 'none';
      }}
    >
      {/* 版本標題列 */}
      <div
        onClick={onToggleExpand}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--spacing-3)',
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--spacing-2)',
              marginBottom: 'var(--spacing-2)',
            }}
          >
            <span style={{ fontSize: 'var(--text-lg)' }}>
              {changeKind.icon}
            </span>
            <span
              style={{
                fontWeight: 600,
                color: 'var(--text-primary)',
                fontSize: 'var(--text-base)',
              }}
            >
              版本 {revision.revisionNo}
              {isNewest && (
                <span
                  style={{
                    marginLeft: 'var(--spacing-2)',
                    padding: '2px 8px',
                    background: 'var(--status-success-bg)',
                    color: 'var(--status-success-fg)',
                    borderRadius: 'var(--radius-full)',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 500,
                  }}
                >
                  最新
                </span>
              )}
            </span>
            <span
              style={{
                padding: '2px 8px',
                background: 'var(--bg-primary)',
                color: 'var(--text-secondary)',
                borderRadius: 'var(--radius-full)',
                fontSize: 'var(--text-xs)',
              }}
            >
              {changeKind.label}
            </span>
          </div>
          <div
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--text-secondary)',
              display: 'flex',
              gap: 'var(--spacing-3)',
            }}
          >
            <span>⏱️ {formatTime(revision.createdDateTime)}</span>
            <span>👤 {revision.createdUser}</span>
          </div>
        </div>

        <div
          style={{
            width: '20px',
            height: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-tertiary)',
            transition: 'transform 0.2s ease',
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)',
          }}
        >
          ▼
        </div>
      </div>

      {/* 展開的內容預覽 */}
      {isExpanded && (
        <div
          style={{
            marginTop: 'var(--spacing-3)',
            paddingTop: 'var(--spacing-3)',
            borderTop: '1px solid var(--border-default)',
          }}
        >
          <div
            style={{
              marginBottom: 'var(--spacing-2)',
            }}
          >
            <h4
              style={{
                margin: '0 0 var(--spacing-2) 0',
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                color: 'var(--text-secondary)',
              }}
            >
              標題
            </h4>
            <div
              style={{
                padding: 'var(--spacing-2) var(--spacing-3)',
                background: 'var(--code-bg)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
                wordBreak: 'break-word',
              }}
            >
              {revision.title}
            </div>
          </div>

          <div>
            <h4
              style={{
                margin: '0 0 var(--spacing-2) 0',
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                color: 'var(--text-secondary)',
              }}
            >
              內容預覽（前 300 字）
            </h4>
            <div
              style={{
                padding: 'var(--spacing-2) var(--spacing-3)',
                background: 'var(--code-bg)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                maxHeight: '200px',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {revision.contentRaw.slice(0, 300)}
              {revision.contentRaw.length > 300 && '...'}
            </div>
          </div>

          <div
            style={{
              marginTop: 'var(--spacing-3)',
              paddingTop: 'var(--spacing-3)',
              borderTop: '1px solid var(--border-default)',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-tertiary)',
            }}
          >
            {isOldest ? (
              <span>📌 這是最早的版本</span>
            ) : (
              <span>💡 點擊可查看此版本與上一版本的完整差異</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
