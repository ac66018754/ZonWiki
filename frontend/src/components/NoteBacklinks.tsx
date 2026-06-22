'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { getNoteBacklinks, type Backlink } from '@/lib/api';

interface NoteBacklinksProps {
  /** 筆記 ID */
  noteId: string;
}

/**
 * 反向連結面板
 * 顯示哪些筆記指向本筆記
 */
export function NoteBacklinks({ noteId }: NoteBacklinksProps) {
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [loading, setLoading] = useState(true);

  // 載入反向連結
  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const data = await getNoteBacklinks(noteId);
        setBacklinks(data);
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
        <p style={{ margin: 0 }}>載入反向連結中...</p>
      </div>
    );
  }

  if (backlinks.length === 0) {
    return (
      <div
        style={{
          padding: 'var(--spacing-6)',
          textAlign: 'center',
          color: 'var(--text-tertiary)',
        }}
      >
        <p style={{ margin: 0, fontSize: 'var(--text-lg)' }}>🔗</p>
        <p style={{ margin: 'var(--spacing-2) 0 0 0' }}>
          目前沒有其他筆記連到此筆記
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
      <div
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--text-secondary)',
          marginBottom: 'var(--spacing-2)',
        }}
      >
        {backlinks.length} 篇筆記連到這裡
      </div>

      {backlinks.map((backlink) => (
        <BacklinkItem key={backlink.id} backlink={backlink} />
      ))}
    </div>
  );
}

/**
 * 單個反向連結項目
 */
interface BacklinkItemProps {
  backlink: Backlink;
}

function BacklinkItem({ backlink }: BacklinkItemProps) {
  return (
    <Link
      href={`/notes/${backlink.sourceNoteSlug}`}
      style={{
        display: 'block',
        padding: 'var(--spacing-3) var(--spacing-4)',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'all 0.2s ease',
      }}
      onMouseEnter={(e) => {
        const element = e.currentTarget as HTMLElement;
        element.style.borderColor = 'var(--border-strong)';
        element.style.boxShadow = 'var(--shadow-sm)';
        element.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        const element = e.currentTarget as HTMLElement;
        element.style.borderColor = 'var(--border-default)';
        element.style.boxShadow = 'none';
        element.style.transform = 'translateY(0)';
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 'var(--spacing-3)',
        }}
      >
        {/* 圖標 */}
        <span style={{ fontSize: 'var(--text-lg)', flexShrink: 0 }}>🔗</span>

        {/* 內容 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 來源筆記標題 */}
          <h4
            style={{
              margin: 0,
              fontSize: 'var(--text-base)',
              fontWeight: 600,
              color: 'var(--action-secondary-fg)',
              wordBreak: 'break-word',
            }}
          >
            {backlink.sourceNoteTitle}
          </h4>

          {/* 連結文字 (anchor text) */}
          <div
            style={{
              marginTop: 'var(--spacing-1)',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-tertiary)',
              background: 'var(--code-bg)',
              padding: '4px 8px',
              borderRadius: 'var(--radius-sm)',
              display: 'inline-block',
              fontFamily: 'var(--font-mono)',
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={`引用文字: [[${backlink.anchorText}]]`}
          >
            [[{backlink.anchorText}]]
          </div>
        </div>

        {/* 箭頭 */}
        <span
          style={{
            fontSize: 'var(--text-lg)',
            color: 'var(--text-tertiary)',
            flexShrink: 0,
          }}
        >
          →
        </span>
      </div>
    </Link>
  );
}
