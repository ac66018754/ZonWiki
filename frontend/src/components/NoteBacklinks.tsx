'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { getNoteBacklinks, type Backlink } from '@/lib/api';
import { backlinkHref } from '@/lib/backlinkHref';

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
        {backlinks.length} 則連結指向這裡
      </div>

      {backlinks.map((backlink) => (
        <BacklinkItem key={backlink.id} backlink={backlink} />
      ))}
    </div>
  );
}

/**
 * 各來源型別對應的圖標（顏色不是唯一資訊載體：圖示＋下方文字說明並存，色盲友善）。
 * wiki＝內文 [[X]]；mark＝框選段落關聯；entity＝整篇關聯。
 */
const KIND_ICON: Record<string, string> = {
  wiki: '🔗',
  mark: '✂️',
  entity: '🧩',
};

/**
 * 單個反向連結項目
 */
interface BacklinkItemProps {
  backlink: Backlink;
}

function BacklinkItem({ backlink }: BacklinkItemProps) {
  // 舊資料（kind 缺失）一律當 wiki 顯示，維持既有行為。
  const kind = backlink.kind ?? 'wiki';

  return (
    <Link
      href={backlinkHref(backlink)}
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
        {/* 圖標（依來源型別切換） */}
        <span style={{ fontSize: 'var(--text-lg)', flexShrink: 0 }}>
          {KIND_ICON[kind] ?? KIND_ICON.wiki}
        </span>

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

          <BacklinkBody kind={kind} anchorText={backlink.anchorText} />
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

/**
 * 依來源型別呈現不同的內容區塊：
 * - wiki  ：程式碼樣式的 [[錨文字]]（既有呈現）。
 * - mark  ：框選段落文字用「引用樣式」（左邊框＋斜體）＋小字說明可跳回來源段落。
 * - entity：整篇關聯，不顯示錨文字區塊，只給一行小字說明。
 * 全部使用語意化 CSS 變數（--text-*／--code-bg／--border-*），亮暗主題皆由變數保證對比。
 */
function BacklinkBody({
  kind,
  anchorText,
}: {
  kind: string;
  anchorText: string;
}) {
  if (kind === 'mark') {
    return (
      <div style={{ marginTop: 'var(--spacing-1)' }}>
        {/* 框選段落：引用樣式（左邊框＋斜體），不用 [[ ]]（那是 wiki 的語彙） */}
        <blockquote
          style={{
            margin: 0,
            paddingLeft: 'var(--spacing-2)',
            borderLeft: '3px solid var(--border-strong)',
            fontStyle: 'italic',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-secondary)',
            wordBreak: 'break-word',
          }}
          title={anchorText}
        >
          {anchorText}
        </blockquote>
        <div
          style={{
            marginTop: 'var(--spacing-1)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text-tertiary)',
          }}
        >
          段落關聯・點擊跳至來源段落
        </div>
      </div>
    );
  }

  if (kind === 'entity') {
    // 整篇關聯：無錨文字，只提示這是整篇層級的關聯。
    return (
      <div
        style={{
          marginTop: 'var(--spacing-1)',
          fontSize: 'var(--text-xs)',
          color: 'var(--text-tertiary)',
        }}
      >
        整篇關聯
      </div>
    );
  }

  // wiki（預設）：程式碼樣式的 [[錨文字]]，維持既有呈現。
  return (
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
      title={`引用文字: [[${anchorText}]]`}
    >
      [[{anchorText}]]
    </div>
  );
}
