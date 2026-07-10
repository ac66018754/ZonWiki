'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { searchAdvanced, type SearchResult } from '@/lib/api/search';
import { useNoteCategories, useNoteTags } from '@/lib/swr';
import { type NoteCategory } from '@/lib/api/categories';

/** 結果數量：初始上限與「載入更多」每次遞增量（後端硬上限 500）。 */
const PAGE_SIZE = 50;
const MAX_LIMIT = 500;

/** 型別篩選 chips（label＝顯示、key＝後端 types 值）。 */
const TYPE_FILTERS: readonly { label: string; key: string }[] = [
  { label: '筆記標題', key: 'note-title' },
  { label: '筆記內文', key: 'note-content' },
  { label: '任務', key: 'task' },
  { label: '開問啦節點', key: 'node' },
  { label: '畫布', key: 'canvas' },
  { label: '標籤', key: 'tag' },
  { label: '分類', key: 'category' },
  { label: '快速捕捉', key: 'capture' },
  { label: 'T 文字', key: 'overlay-text' },
  { label: '便利貼', key: 'overlay-sticky' },
];

/** metadata chip 樣式（分類/標籤；亮暗主題皆達 AA：次要文字色 + 表面底 + 邊框）。 */
const META_CHIP_STYLE: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--text-secondary)',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 6px',
  maxWidth: '280px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

/** 結果型別 → emoji ＋ 中文標籤。 */
function typeMeta(type: string): { emoji: string; label: string } {
  switch (type) {
    case 'note': return { emoji: '📝', label: '筆記' };
    case 'task': return { emoji: '✓', label: '任務' };
    case 'canvas': return { emoji: '🎨', label: '畫布' };
    case 'node': return { emoji: '◇', label: '節點' };
    case 'tag': return { emoji: '🏷️', label: '標籤' };
    case 'category': return { emoji: '📁', label: '分類' };
    case 'capture': return { emoji: '📥', label: '快速捕捉' };
    case 'overlay-text': return { emoji: '🔤', label: 'T 文字' };
    case 'overlay-sticky': return { emoji: '🗒️', label: '便利貼' };
    default: return { emoji: '◆', label: type };
  }
}

/**
 * 把分類清單依階層攤平成「有縮排深度」的順序清單（供下拉樹狀顯示；cycle-safe）。
 */
function flattenCategories(categories: NoteCategory[]): { id: string; name: string; depth: number }[] {
  const childrenByParent = new Map<string | null, NoteCategory[]>();
  for (const c of categories) {
    const parent = c.parentId ?? null;
    const list = childrenByParent.get(parent) ?? [];
    list.push(c);
    childrenByParent.set(parent, list);
  }
  const result: { id: string; name: string; depth: number }[] = [];
  const visited = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const c of childrenByParent.get(parent) ?? []) {
      if (visited.has(c.id)) continue; // 防環
      visited.add(c.id);
      result.push({ id: c.id, name: c.name, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return result;
}

/**
 * 將文字中命中的關鍵字以 <mark> 高亮（大小寫不敏感）。前景/背景皆明示，確保亮暗主題皆達 WCAG AA。
 */
function highlight(text: string, keyword: string) {
  const trimmed = keyword.trim();
  if (!trimmed) return text;
  const lowerText = text.toLowerCase();
  const lowerKey = trimmed.toLowerCase();
  const parts: React.ReactNode[] = [];
  let from = 0;
  let idx = lowerText.indexOf(lowerKey, from);
  let key = 0;
  while (idx >= 0) {
    if (idx > from) parts.push(text.slice(from, idx));
    parts.push(
      <mark
        key={key++}
        style={{ background: '#fde68a', color: '#1a1a1a', borderRadius: 2, padding: '0 1px' }}
      >
        {text.slice(idx, idx + trimmed.length)}
      </mark>,
    );
    from = idx + trimmed.length;
    idx = lowerText.indexOf(lowerKey, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

/**
 * 進階搜尋頁：大搜尋框 ＋ 型別/分類（含子孫）/標籤/排序等進階篩選，結果附分類路徑、標籤、更新時間。
 * 所有條件皆同步進 URL（可分享、可重整還原）；空關鍵字＋分類/標籤＝瀏覽該範圍全部筆記。
 */
function SearchPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // URL 為單一真相：讀出目前條件。
  const urlQ = searchParams.get('q') ?? '';
  const urlTypes = (searchParams.get('types') ?? '').split(',').filter(Boolean);
  const urlCategoryId = searchParams.get('categoryId') ?? '';
  const urlTagIds = (searchParams.get('tags') ?? '').split(',').filter(Boolean);
  const urlSort = (searchParams.get('sort') === 'updated' ? 'updated' : 'relevance') as
    | 'relevance'
    | 'updated';

  // 搜尋框文字用本地 state（即時輸入），debounce 後才寫回 URL，避免每次按鍵重載頁面失焦。
  const [qInput, setQInput] = useState(urlQ);
  const [limit, setLimit] = useState(PAGE_SIZE);

  // 篩選選項來源。
  const { data: categoriesData } = useNoteCategories();
  const { data: tagsData } = useNoteTags();
  const categories = useMemo(() => categoriesData ?? [], [categoriesData]);
  const tags = useMemo(() => tagsData ?? [], [tagsData]);
  const flatCategories = useMemo(() => flattenCategories(categories), [categories]);

  // 分類/標籤篩選出現時，後端只回筆記——用於在 UI 上提示並淡化其他型別 chip。
  const hasScopeFilter = !!urlCategoryId || urlTagIds.length > 0;

  /** 以目前 URL 為基準套用局部變更、寫回網址，並把數量上限重置回第一頁。 */
  const applyParams = (patch: Record<string, string | string[] | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [rawKey, value] of Object.entries(patch)) {
      const csv = Array.isArray(value) ? value.join(',') : value;
      if (!csv) params.delete(rawKey);
      else params.set(rawKey, csv);
    }
    setLimit(PAGE_SIZE);
    const qs = params.toString();
    router.replace(qs ? `/search?${qs}` : '/search');
  };

  // 搜尋框 debounce（300ms）→ 寫回 URL 的 q。輸入與 URL 不同步時才更新。
  useEffect(() => {
    const timer = setTimeout(() => {
      if (qInput.trim() !== urlQ.trim()) applyParams({ q: qInput.trim() || null });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  // URL 的 q 若被外部（返回鍵/分享連結）改動，同步回輸入框。
  useEffect(() => {
    setQInput(urlQ);
  }, [urlQ]);

  // 依所有條件取結果（SWR 快取，key 含 limit 以支援「載入更多」）。
  const swrKey = useMemo(
    () => ['search-advanced', urlQ, urlTypes.join(','), urlCategoryId, urlTagIds.join(','), urlSort, limit] as const,
    [urlQ, urlTypes, urlCategoryId, urlTagIds, urlSort, limit],
  );
  const { data, isLoading } = useSWR<SearchResult[]>(swrKey, () =>
    searchAdvanced({
      q: urlQ,
      types: urlTypes,
      categoryId: urlCategoryId || undefined,
      tagIds: urlTagIds,
      sort: urlSort,
      limit,
    }),
  );
  const results = useMemo(() => data ?? [], [data]);
  const canLoadMore = results.length >= limit && limit < MAX_LIMIT;

  /** 切換型別 chip（多選）。 */
  const toggleType = (key: string) => {
    const next = urlTypes.includes(key)
      ? urlTypes.filter((t) => t !== key)
      : [...urlTypes, key];
    applyParams({ types: next });
  };

  /** 切換標籤（多選）。 */
  const toggleTag = (id: string) => {
    const next = urlTagIds.includes(id)
      ? urlTagIds.filter((t) => t !== id)
      : [...urlTagIds, id];
    applyParams({ tags: next });
  };

  const fmtDate = (iso?: string) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString();
    } catch {
      return '';
    }
  };

  const showEmptyPrompt = !urlQ.trim() && !hasScopeFilter;

  return (
    <div className="notes-page">
      <div
        className="notes-page__container"
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', padding: 'var(--spacing-4)' }}
      >
        {/* 標題列 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
          <Link href="/notes" className="btn-secondary" style={{ flexShrink: 0 }}>
            ← 返回
          </Link>
          <h1 style={{ margin: 0, fontSize: 'var(--text-2xl)', fontWeight: 700 }}>🔎 進階搜尋</h1>
        </div>

        {/* 大搜尋框 */}
        <input
          type="text"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="輸入關鍵字搜尋筆記、任務、畫布、節點…（可只用下方篩選瀏覽）"
          autoFocus
          aria-label="搜尋關鍵字"
          style={{
            width: '100%',
            padding: 'var(--spacing-3) var(--spacing-4)',
            fontSize: 'var(--text-lg)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-default)',
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
          }}
        />

        {/* 進階篩選面板 */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--spacing-3)',
            padding: 'var(--spacing-3)',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          {/* 型別 chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--spacing-1)' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginRight: 'var(--spacing-1)' }}>
              型別：
            </span>
            {TYPE_FILTERS.map((f) => {
              const on = urlTypes.includes(f.key);
              const isNoteType = f.key === 'note-title' || f.key === 'note-content';
              const dimmed = hasScopeFilter && !isNoteType; // 範圍篩選時只搜筆記，其他型別淡化
              return (
                <button
                  key={f.key}
                  type="button"
                  className={`tk-filter-chip${on ? ' tk-filter-chip--on' : ''}`}
                  style={{ cursor: 'pointer', opacity: dimmed ? 0.45 : 1 }}
                  onClick={() => toggleType(f.key)}
                  aria-pressed={on}
                  title={dimmed ? '已套用分類/標籤篩選時只搜尋筆記' : undefined}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {/* 分類（含子孫）＋ 排序 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--spacing-3)' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--spacing-2)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              分類：
              <select
                value={urlCategoryId}
                onChange={(e) => applyParams({ categoryId: e.target.value || null })}
                style={{
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-default)',
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                  fontSize: 'var(--text-sm)',
                  maxWidth: '260px',
                }}
              >
                <option value="">全部分類</option>
                {flatCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {'　'.repeat(c.depth)}
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--spacing-1)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              排序：
              <button
                type="button"
                className={`tk-filter-chip${urlSort === 'relevance' ? ' tk-filter-chip--on' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => applyParams({ sort: 'relevance' })}
                aria-pressed={urlSort === 'relevance'}
              >
                相關性
              </button>
              <button
                type="button"
                className={`tk-filter-chip${urlSort === 'updated' ? ' tk-filter-chip--on' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => applyParams({ sort: 'updated' })}
                aria-pressed={urlSort === 'updated'}
              >
                最近更新
              </button>
            </div>
          </div>

          {/* 標籤多選（僅在有標籤時顯示） */}
          {tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--spacing-1)' }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginRight: 'var(--spacing-1)' }}>
                標籤：
              </span>
              {tags.map((t) => {
                const on = urlTagIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`tk-filter-chip${on ? ' tk-filter-chip--on' : ''}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => toggleTag(t.id)}
                    aria-pressed={on}
                  >
                    🏷 {t.name}
                  </button>
                );
              })}
            </div>
          )}

          {hasScopeFilter && (
            <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              ℹ️ 已套用分類／標籤篩選，僅搜尋「筆記」；清空關鍵字即可瀏覽該範圍全部筆記。
            </p>
          )}
        </div>

        {/* 結果區 */}
        {showEmptyPrompt ? (
          <div style={{ padding: 'var(--spacing-6)', textAlign: 'center', color: 'var(--text-tertiary)', lineHeight: 1.8 }}>
            輸入關鍵字，或用上方的分類／標籤篩選來瀏覽。
          </div>
        ) : isLoading && results.length === 0 ? (
          <div style={{ padding: 'var(--spacing-6)', textAlign: 'center', color: 'var(--text-tertiary)' }}>搜尋中…</div>
        ) : results.length === 0 ? (
          <div style={{ padding: 'var(--spacing-6)', textAlign: 'center', color: 'var(--text-tertiary)' }}>找不到符合的結果。</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              共 {results.length} 筆{canLoadMore ? '（可載入更多）' : ''}
            </div>
            {results.map((r) => {
              const meta = typeMeta(r.type);
              return (
                <Link
                  key={`${r.type}:${r.id}`}
                  href={r.url}
                  style={{
                    display: 'flex',
                    gap: 'var(--spacing-3)',
                    padding: 'var(--spacing-3)',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)',
                    textDecoration: 'none',
                    color: 'var(--text-primary)',
                  }}
                >
                  <span style={{ fontSize: 'var(--text-lg)', flexShrink: 0, minWidth: 24 }} aria-hidden>
                    {meta.emoji}
                  </span>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--spacing-2)' }}>
                      <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {highlight(r.title, urlQ)}
                      </span>
                      <span style={{ flexShrink: 0, fontSize: 'var(--text-xs)', color: 'var(--action-secondary-fg)', fontWeight: 500 }}>
                        {meta.label}
                      </span>
                      {r.updatedAt && (
                        <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                          {fmtDate(r.updatedAt)}
                        </span>
                      )}
                    </div>

                    {/* 浮層：所屬筆記 */}
                    {r.parentTitle && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>於《{r.parentTitle}》</div>
                    )}

                    {/* 摘要（高亮關鍵字） */}
                    {r.snippet && (
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {highlight(r.snippet, urlQ)}
                      </div>
                    )}

                    {/* 分類路徑 ＋ 標籤（筆記） */}
                    {((r.categories?.length ?? 0) > 0 || (r.tags?.length ?? 0) > 0) && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-1)' }}>
                        {(r.categories ?? []).map((c) => (
                          <span key={`c:${c}`} style={META_CHIP_STYLE} title={c}>📁 {c}</span>
                        ))}
                        {(r.tags ?? []).map((t) => (
                          <span key={`t:${t}`} style={META_CHIP_STYLE} title={t}>🏷 {t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}

            {canLoadMore && (
              <button
                type="button"
                className="btn-secondary"
                style={{ alignSelf: 'center', marginTop: 'var(--spacing-2)' }}
                onClick={() => setLimit((n) => Math.min(n + PAGE_SIZE, MAX_LIMIT))}
                disabled={isLoading}
              >
                {isLoading ? '載入中…' : '載入更多'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 進階搜尋頁（外殼）。useSearchParams 需包在 Suspense 內（Next App Router 要求，比照 /notes/questions）。
 */
export default function SearchPage() {
  return (
    <Suspense
      fallback={<div style={{ padding: 'var(--spacing-6)', textAlign: 'center', color: 'var(--text-tertiary)' }}>載入中…</div>}
    >
      <SearchPageInner />
    </Suspense>
  );
}
