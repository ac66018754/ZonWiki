'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { setNoteCategories, updateNoteTags } from '@/lib/api';
import { showToast } from '@/lib/toast';
import { SearchableMultiSelect, type MultiSelectOption } from './SearchableMultiSelect';

/**
 * 閱讀模式「就地調整分類/標籤」的彈出面板（2026-08-13 使用者裁示：
 * 改分類不必再進編輯頁）。
 *
 * 寫入走兩支獨立端點（PUT /api/notes/{id}/categories、/tags）——
 * 不動 contentRaw、不產生版本快照（NoteRevision）、無 baseVersion/409 問題；
 * 絕不可改走 PUT /api/notes/{id} 整包更新（會產生幽靈版本＋撞併發）。
 */
interface NoteMetaQuickEditProps {
  /** 目標筆記 id。 */
  noteId: string;
  /** 分類選項（已由呼叫端以 buildCategoryOptions 組路徑＋排序）。 */
  categoryOptions: MultiSelectOption[];
  /** 標籤選項。 */
  tagOptions: MultiSelectOption[];
  /** 目前的分類 id。 */
  initialCategoryIds: string[];
  /** 目前的標籤 id。 */
  initialTagIds: string[];
  /** 就地新增分類（沿用編輯頁的建立回呼；未提供＝不可新增）。 */
  onCreateCategory?: (name: string) => Promise<MultiSelectOption | null>;
  /** 就地新增標籤。 */
  onCreateTag?: (name: string) => Promise<MultiSelectOption | null>;
  /** 儲存成功後回呼（帶最終選取，供呼叫端更新本地筆記狀態與快取）。 */
  onSaved: (categoryIds: string[], tagIds: string[]) => void;
  /** 關閉面板（取消或儲存成功後）。 */
  onClose: () => void;
}

export function NoteMetaQuickEdit({
  noteId,
  categoryOptions,
  tagOptions,
  initialCategoryIds,
  initialTagIds,
  onCreateCategory,
  onCreateTag,
  onSaved,
  onClose,
}: NoteMetaQuickEditProps) {
  const [categoryIds, setCategoryIds] = useState<string[]>(initialCategoryIds);
  const [tagIds, setTagIds] = useState<string[]>(initialTagIds);
  const [saving, setSaving] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Esc 關閉（儲存中不關，避免結果不明）。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    // 兩支端點各自冪等但非同一交易——分類先寫。若分類成功、標籤失敗，
    // 伺服器端分類「已經改了」：必須把此部分成功回報給父層（onSaved 帶「分類=新、
    // 標籤=原值」），否則畫面停留在舊分類、與伺服器不同步（二輪復審 M）。
    // 面板保持開啟讓使用者重試標籤（冪等，重試會收斂）。
    let categoriesSaved = false;
    try {
      categoriesSaved = await setNoteCategories(noteId, categoryIds);
      if (!categoriesSaved) {
        showToast('儲存分類失敗，請稍後再試', { type: 'error' });
        return;
      }
      const tagsOk = await updateNoteTags(noteId, tagIds);
      if (!tagsOk) {
        onSaved(categoryIds, initialTagIds);
        showToast('分類已更新，但標籤儲存失敗——請再按一次儲存重試標籤', { type: 'error' });
        return;
      }
      onSaved(categoryIds, tagIds);
      onClose();
    } catch {
      if (categoriesSaved) onSaved(categoryIds, initialTagIds);
      showToast('儲存分類/標籤失敗，請稍後再試', { type: 'error' });
    } finally {
      setSaving(false);
    }
  }, [saving, noteId, categoryIds, tagIds, initialTagIds, onSaved, onClose]);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="調整分類與標籤"
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        left: 0,
        zIndex: 60,
        width: 'min(520px, calc(100vw - 32px))',
        padding: 'var(--spacing-4)',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
        display: 'grid',
        gap: 'var(--spacing-3)',
      }}
    >
      <div>
        <label
          style={{
            display: 'block',
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            marginBottom: 'var(--spacing-1)',
          }}
        >
          分類
        </label>
        <SearchableMultiSelect
          options={categoryOptions}
          selectedIds={categoryIds}
          onChange={setCategoryIds}
          onCreate={onCreateCategory}
          placeholder="搜尋或新增分類…"
        />
      </div>
      <div>
        <label
          style={{
            display: 'block',
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            marginBottom: 'var(--spacing-1)',
          }}
        >
          標籤
        </label>
        <SearchableMultiSelect
          options={tagOptions}
          selectedIds={tagIds}
          onChange={setTagIds}
          onCreate={onCreateTag}
          prefix="#"
          placeholder="搜尋或新增標籤…"
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-2)' }}>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onClose}
          disabled={saving}
          style={{ padding: '4px 14px' }}
        >
          取消
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={handleSave}
          disabled={saving}
          style={{ padding: '4px 14px' }}
        >
          {saving ? '儲存中…' : '儲存'}
        </button>
      </div>
    </div>
  );
}
