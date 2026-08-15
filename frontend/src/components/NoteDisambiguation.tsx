'use client';

import { useRouter } from 'next/navigation';
import { noteHref } from '@/lib/noteHref';
import type { SlugCandidate } from '@/lib/api';

/**
 * 消歧異頁：某個 slug 可能指向多篇筆記時（名字被取用過、產生歧義），就地列出候選讓使用者選。
 *
 * 為什麼點卡走 id：點候選卡以 <code>noteHref(候選.id)</code>（GUID 直達）導航——後端的 slug 解析支援
 * 把 GUID 當 slug 的錨點路徑，且 GUID 直達永不再歧義，故能穩定開啟使用者指定的那一篇。
 *
 * 由 [...slug] 筆記頁在「note 為 null 且 candidates 有值」時就地渲染（不另開路由）。
 */
export function NoteDisambiguation({
  requestedSlug,
  candidates,
}: {
  /** 使用者輸入、產生歧義的 slug。 */
  requestedSlug: string;
  /** 候選清單（後端已排序：現用者優先、再依更新時間新→舊）。 */
  candidates: SlugCandidate[];
}) {
  const router = useRouter();

  return (
    <div className="note-detail-page">
      <div className="note-detail__container">
        <div style={{ padding: 'var(--spacing-6) 0' }}>
          <h1
            style={{
              fontSize: 'var(--text-xl)',
              fontWeight: 700,
              margin: 0,
              marginBottom: 'var(--spacing-2)',
              color: 'var(--text-primary)',
              wordBreak: 'break-word',
            }}
          >
            「{requestedSlug}」可能指向多篇筆記
          </h1>
          <p
            style={{
              margin: 0,
              marginBottom: 'var(--spacing-5)',
              color: 'var(--text-secondary)',
              fontSize: 'var(--text-sm)',
              lineHeight: 1.7,
            }}
          >
            這個網址曾被多篇筆記使用過。請選擇你要開啟的那一篇：
          </p>

          <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
            {candidates.map((candidate) => (
              <button
                key={candidate.id}
                onClick={() => router.push(noteHref(candidate.id))}
                title={`開啟《${candidate.title}》`}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  minHeight: 44,
                  padding: 'var(--spacing-4)',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-lg)',
                  cursor: 'pointer',
                  color: 'var(--text-primary)',
                  transition: 'border-color 0.15s ease, background 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-strong)';
                  e.currentTarget.style.background = 'var(--bg-surface-secondary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-default)';
                  e.currentTarget.style.background = 'var(--bg-surface)';
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--spacing-2)',
                    flexWrap: 'wrap',
                    marginBottom: 'var(--spacing-1)',
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 'var(--text-base)', wordBreak: 'break-word' }}>
                    {candidate.title}
                  </span>
                  {/* 徽章：現用此名（success 底色，非只靠顏色——同時有文字）／曾用此名（弱化底）。
                      曾用者顯示 originalTitle（讓出此名當下的標題，該欄位存在的唯一目的）＋現名對照，
                      幫使用者辨識「這篇當年就是我要找的那個名字」。originalTitle 缺值時退回無引號文案。 */}
                  <span
                    style={{
                      flexShrink: 0,
                      fontSize: 'var(--text-xs)',
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-sm)',
                      background: candidate.isCurrentHolder
                        ? 'var(--status-success-bg)'
                        : 'var(--bg-surface-secondary)',
                      color: candidate.isCurrentHolder
                        ? 'var(--status-success-fg)'
                        : 'var(--text-secondary)',
                      border: '1px solid var(--border-default)',
                    }}
                  >
                    {candidate.isCurrentHolder
                      ? '現用此名'
                      : candidate.originalTitle
                        ? `曾用此名「${candidate.originalTitle}」（現名《${candidate.title}》）`
                        : `曾用此名（現名《${candidate.title}》）`}
                  </span>
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  更新：{new Date(candidate.updatedAt).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
