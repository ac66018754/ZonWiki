'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import {
  listQuestions,
  type NoteQuestionListItem,
} from '@/lib/api/notes';
import { useNoteCategories } from '@/lib/swr';
import { type NoteCategory } from '@/lib/api/categories';
import { QuestionAnswerPopup } from '@/components/questions/QuestionAnswerPopup';

/** 「(未分類)」篩選項的識別哨符（對應 categoryIds 為空的問題）。 */
const UNCATEGORIZED = '__uncategorized__';

/** 浮層型別對應的小圖示。 */
function kindIcon(kind: string): string {
  return kind === 'text' ? '🔤' : '🗒';
}

/**
 * 計算「指定分類 + 其所有子孫分類」的 id 集合（client 端遞迴，cycle-safe）。
 */
function computeCategoryScope(rootId: string, categories: NoteCategory[]): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const c of categories) {
    const parent = c.parentId ?? null;
    if (parent) {
      const list = childrenByParent.get(parent) ?? [];
      list.push(c.id);
      childrenByParent.set(parent, list);
    }
  }
  const scope = new Set<string>([rootId]);
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of childrenByParent.get(current) ?? []) {
      if (!scope.has(child)) {
        scope.add(child);
        queue.push(child);
      }
    }
  }
  return scope;
}

/**
 * 分類問題清單頁：展示某分類（含所有子孫分類）的所有問題；不帶 categoryId＝「全部」（所有筆記的問題）。
 * 提供「篩選哪些分類（限自己與子孫）」的 checkbox 群（client 端過濾），以及每題的定位與答題彈窗。
 */
function NoteQuestionsPageInner() {
  const searchParams = useSearchParams();
  const categoryId = searchParams.get('categoryId');

  // 資料以 SWR 取得（避免手寫 fetch effect）；答案的本地覆寫另存，套在 SWR 資料之上。
  const {
    data: questionsData,
    isLoading: loading,
    error: fetchError,
  } = useSWR<NoteQuestionListItem[]>(`note-questions:${categoryId ?? ''}`, () => listQuestions(categoryId));
  const { data: categoriesData } = useNoteCategories();
  const categories = useMemo(() => categoriesData ?? [], [categoriesData]);
  const error = fetchError ? '載入問題清單失敗，請稍後再試。' : null;

  // 儲存回答後的本地覆寫（itemId → 最新回答），套用在 SWR 資料上（免同步 effect）。
  const [answerOverrides, setAnswerOverrides] = useState<Record<string, string>>({});

  // 目前開著的答題彈窗（item id 清單；可多開）。
  const [openAnswerItemIds, setOpenAnswerItemIds] = useState<string[]>([]);

  // 篩選：勾選中的分類 id 集合（含「(未分類)」哨符）。
  // null＝「全部勾選」（預設態，免在 effect 內 setState）；一旦使用者調整就變成具體集合。
  const [selectedFilter, setSelectedFilter] = useState<Set<string> | null>(null);

  // 套用本地答案覆寫後的問題清單。
  const questions = useMemo(() => {
    const base = questionsData ?? [];
    return base.map((q) => {
      const override = answerOverrides[q.itemId];
      // hasAnswer 與後端 !string.IsNullOrEmpty 一致：非空字串即為已答（不 trim）。
      return override === undefined
        ? q
        : { ...q, questionAnswer: override, hasAnswer: override !== '' };
    });
  }, [questionsData, answerOverrides]);

  // 分類名稱查表。
  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.id, c.name);
    return map;
  }, [categories]);

  // 標題列顯示的分類名稱。
  const scopeName = categoryId ? (categoryNameById.get(categoryId) ?? '未知分類') : '全部';

  // 篩選器要列出的分類 id（分類頁＝自己＋子孫；全部頁＝所有分類）。
  const filterCategoryIds = useMemo(() => {
    if (!categoryId) return categories.map((c) => c.id);
    return Array.from(computeCategoryScope(categoryId, categories));
  }, [categoryId, categories]);

  // 是否提供「(未分類)」篩選（只有「全部」頁可能出現無分類的問題）。
  const showUncategorized = !categoryId;

  // 「全部勾選」時的完整集合（供從 null 態切換與「全選」使用）。
  const fullFilterSet = useMemo(() => {
    const all = new Set<string>(filterCategoryIds);
    if (showUncategorized) all.add(UNCATEGORIZED);
    return all;
  }, [filterCategoryIds, showUncategorized]);

  /** 某篩選項目前是否勾選（null＝全部勾選）。 */
  const isFilterChecked = (id: string) => (selectedFilter === null ? true : selectedFilter.has(id));

  // 套用 client 端分類篩選（null＝全部勾選＝不過濾）。
  const visibleQuestions = useMemo(() => {
    if (selectedFilter === null) return questions;
    return questions.filter((q) => {
      if (q.categoryIds.length === 0) return selectedFilter.has(UNCATEGORIZED);
      return q.categoryIds.some((id) => selectedFilter.has(id));
    });
  }, [questions, selectedFilter]);

  /** 切換某個篩選分類的勾選狀態（從 null「全選」態切換時，以完整集合為基準再拿掉該項）。 */
  const toggleFilter = (id: string) => {
    setSelectedFilter((prev) => {
      const next = new Set(prev ?? fullFilterSet);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 全選 / 全不選。 */
  const setAllFilters = (checked: boolean) => {
    setSelectedFilter(checked ? new Set(fullFilterSet) : new Set());
  };

  /** 開啟 / 關閉答題彈窗。 */
  const openAnswer = (itemId: string) =>
    setOpenAnswerItemIds((prev) => (prev.includes(itemId) ? prev : [...prev, itemId]));
  const closeAnswer = (itemId: string) =>
    setOpenAnswerItemIds((prev) => prev.filter((id) => id !== itemId));

  /** 儲存回答後更新本地覆寫（同步「已答」徽章與彈窗初值）。 */
  const onAnswerSaved = (itemId: string, answer: string) => {
    setAnswerOverrides((prev) => ({ ...prev, [itemId]: answer }));
  };

  const backHref = categoryId ? `/notes?categoryId=${encodeURIComponent(categoryId)}` : '/notes';

  return (
    <div className="notes-page">
      <div className="notes-page__container" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', padding: 'var(--spacing-4)' }}>
        {/* 標題列 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
          <Link href={backHref} className="btn-secondary" style={{ flexShrink: 0 }}>
            ← 返回
          </Link>
          <h1 style={{ margin: 0, fontSize: 'var(--text-2xl)', fontWeight: 700 }}>
            ❓ 問題清單 —（{scopeName}）
          </h1>
        </div>

        {/* 分類篩選器 */}
        {!loading && filterCategoryIds.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 'var(--spacing-2)',
              padding: 'var(--spacing-3)',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginRight: 'var(--spacing-1)' }}>篩選分類：</span>
            <button type="button" className="btn-secondary" style={{ fontSize: 'var(--text-xs)', padding: '2px 8px', minHeight: 0 }} onClick={() => setAllFilters(true)}>全選</button>
            <button type="button" className="btn-secondary" style={{ fontSize: 'var(--text-xs)', padding: '2px 8px', minHeight: 0 }} onClick={() => setAllFilters(false)}>全不選</button>
            {filterCategoryIds.map((id) => (
              <label key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-sm)', color: 'var(--text-primary)', cursor: 'pointer' }}>
                <input type="checkbox" checked={isFilterChecked(id)} onChange={() => toggleFilter(id)} />
                {categoryNameById.get(id) ?? '未知分類'}
              </label>
            ))}
            {showUncategorized && (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input type="checkbox" checked={isFilterChecked(UNCATEGORIZED)} onChange={() => toggleFilter(UNCATEGORIZED)} />
                (未分類)
              </label>
            )}
          </div>
        )}

        {/* 內容：載入中 / 錯誤 / 空狀態 / 清單 */}
        {loading ? (
          <div style={{ padding: 'var(--spacing-6)', textAlign: 'center', color: 'var(--text-tertiary)' }}>載入中…</div>
        ) : error ? (
          <div role="alert" style={{ padding: 'var(--spacing-6)', textAlign: 'center', color: 'var(--action-danger-fg, var(--color-danger, #dc2626))' }}>{error}</div>
        ) : visibleQuestions.length === 0 ? (
          <div style={{ padding: 'var(--spacing-6)', textAlign: 'center', color: 'var(--text-tertiary)', lineHeight: 1.8 }}>
            此範圍尚無問題。<br />
            到筆記內把便利貼或 T 文字框標記為問題（❓）後，會出現在這裡。
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
            {visibleQuestions.map((q) => (
              <div
                key={q.itemId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--spacing-2)',
                  padding: 'var(--spacing-3)',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                {/* 列身：導航到該筆記並定位到此問題 */}
                <Link
                  href={`/notes/${encodeURIComponent(q.noteSlug)}?overlay=${encodeURIComponent(q.itemId)}`}
                  title="開啟所屬筆記並定位到此問題"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--spacing-2)',
                    textDecoration: 'none',
                    color: 'var(--text-primary)',
                  }}
                >
                  <span aria-hidden style={{ flexShrink: 0 }}>{kindIcon(q.kind)}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {q.questionTitle}
                    </span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {q.noteTitle}
                    </span>
                  </span>
                  {q.hasAnswer && (
                    <span
                      title="已作答"
                      style={{
                        flexShrink: 0,
                        fontSize: 'var(--text-xs)',
                        color: 'var(--action-success-fg, var(--color-success, #16a34a))',
                        border: '1px solid currentColor',
                        borderRadius: 'var(--radius-sm)',
                        padding: '0 6px',
                      }}
                    >
                      ✓ 已答
                    </span>
                  )}
                </Link>
                {/* 答鈕 */}
                <button
                  type="button"
                  onClick={() => openAnswer(q.itemId)}
                  className="btn-secondary"
                  style={{ flexShrink: 0, fontSize: 'var(--text-xs)', padding: '4px 12px', minHeight: 0 }}
                  title="開啟答題彈窗"
                >
                  答
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 答題彈窗（可多開） */}
      {openAnswerItemIds.map((itemId, index) => {
        const q = questions.find((x) => x.itemId === itemId);
        if (!q) return null;
        return (
          <QuestionAnswerPopup
            key={itemId}
            itemId={q.itemId}
            noteId={q.noteId}
            kind={q.kind}
            questionTitle={q.questionTitle}
            questionText={q.questionText}
            initialAnswer={q.questionAnswer ?? ''}
            offsetIndex={index}
            onClose={() => closeAnswer(itemId)}
            onSaved={(answer) => onAnswerSaved(itemId, answer)}
          />
        );
      })}
    </div>
  );
}

/**
 * 分類問題清單頁（外殼）。useSearchParams 需包在 Suspense 內（Next App Router 要求，比照 /ai-queue）。
 */
export default function NoteQuestionsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 'var(--spacing-6)', textAlign: 'center', color: 'var(--text-tertiary)' }}>載入中…</div>}>
      <NoteQuestionsPageInner />
    </Suspense>
  );
}
