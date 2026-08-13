'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  getNoteRevisions,
  getNoteActivities,
  listOverlaySnapshots,
  type NoteRevision,
  type NoteActivity,
  type NoteOverlaySnapshotListItem,
} from '@/lib/api';
import { formatFullDateTime } from '@/lib/formatters';
import { DEFAULT_TIMEZONE } from '@/lib/constants';
import { groupEntriesByDay } from '@/lib/historyGrouping';

interface NoteEditHistoryProps {
  /** 筆記 ID */
  noteId: string;
  /** 用戶時區 */
  userTimeZone?: string;
}

/**
 * 合併時間軸的一個項目：
 * - revision：版本快照（大卡片、可展開內容預覽）
 * - activity：活動紀錄（細列——分類/標籤/關聯/還原等版本快照沒有的變更）
 * - snapshot：浮層手動快照（細列——右下角工具列儲存鈕的產物）
 */
type TimelineEntry =
  | { kind: 'revision'; at: string; revision: NoteRevision }
  | { kind: 'activity'; at: string; activity: NoteActivity }
  | { kind: 'snapshot'; at: string; snapshot: NoteOverlaySnapshotListItem };

/**
 * 「純標題/內容變更」明細的整串樣式：
 * 「內容」「標題「a」→「b」」或兩者以「；」相連（順序不拘）。
 * 用「整串錨定的正則」而非 split('；')——標題值本身可能含全形分號，
 * 切割法會把「標題「會議；週報」→「x」」誤判成非純內容變更而重複顯示。
 */
const PURE_CONTENT_DETAIL_PATTERN =
  /^(內容|標題「[\s\S]*」→「[\s\S]*」|標題「[\s\S]*」→「[\s\S]*」；內容|內容；標題「[\s\S]*」→「[\s\S]*」)$/;

/**
 * 判斷一筆活動是否「與版本快照重複」而應在時間軸中隱藏：
 * - created / deleted：版本快照必有對應的 create / delete 卡片，細列屬重複雜訊。
 * - updated 且明細「只有標題/內容變更」：版本卡片已完整呈現（含全文快照）。
 * 其餘（分類/標籤/關聯/草稿旗標等版本快照「不記」的變更、還原）一律保留——這正是
 * 使用者要求「歷史分頁要看得到完整相關變更」的核心。
 * ⚠️ 呼叫端只在「版本快照確實載入成功（非空）」時套用此過濾——
 * 版本來源失敗時隱藏 created/deleted 會讓時間軸看似完整卻漏事件。
 */
function isDuplicatedByRevision(activity: NoteActivity): boolean {
  if (activity.action === 'created' || activity.action === 'deleted') {
    return true;
  }
  if (activity.action !== 'updated') {
    return false; // restored 等其他動作沒有對應版本卡片，保留
  }
  if (!activity.detail) {
    return true; // 無明細的 updated（理論上不會發生）視為重複
  }
  return PURE_CONTENT_DETAIL_PATTERN.test(activity.detail);
}

/** 依活動明細挑選細列圖示（僅供辨識，資訊仍以文字為準）。 */
function activityIcon(activity: NoteActivity): string {
  if (activity.action === 'restored') return '♻️';
  const d = activity.detail ?? '';
  if (d.includes('關聯')) return '🔗';
  if (d.includes('分類')) return '📁';
  if (d.includes('標籤')) return '🏷';
  return '✳️';
}

/** 活動動作 → 顯示文字。 */
function activityActionLabel(action: string): string {
  const map: Record<string, string> = {
    created: '建立',
    updated: '編輯',
    deleted: '刪除',
    restored: '還原',
  };
  return map[action] ?? action;
}

/**
 * 編輯歷史時間軸（合併三種來源）：
 * - 版本快照（NoteRevision）：標題＋內容的完整快照，可展開預覽。
 * - 活動紀錄（ActivityLog）：分類/標籤/關聯/還原等「版本快照沒有」的變更明細。
 * - 浮層快照（NoteOverlaySnapshot）：便利貼/文字框/塗鴉/畫記的手動存檔紀錄。
 */
export function NoteEditHistory({ noteId, userTimeZone = DEFAULT_TIMEZONE }: NoteEditHistoryProps) {
  const [revisions, setRevisions] = useState<NoteRevision[]>([]);
  const [activities, setActivities] = useState<NoteActivity[]>([]);
  const [snapshots, setSnapshots] = useState<NoteOverlaySnapshotListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRevision, setExpandedRevision] = useState<string | null>(null);
  // 按天分組的摺疊狀態：null＝未手動操作過（預設「最新一天展開、其餘摺疊」）；
  // 之後以使用者的手動 toggle 為準。換筆記時由載入 effect 重設。
  const [collapsedDaysOverride, setCollapsedDaysOverride] = useState<Set<string> | null>(null);

  // 載入三種來源（互不阻塞；任一失敗顯示其餘）。
  useEffect(() => {
    // 換筆記時重設手動摺疊狀態（二輪復審 M：day 鍵是日曆日期字串，跨筆記共用同一天，
    // 沿用前一篇的手動摺疊會讓新筆記的「今天」被錯誤摺起）。
    setCollapsedDaysOverride(null);
    const load = async () => {
      setLoading(true);
      const [revisionResult, activityResult, snapshotResult] = await Promise.allSettled([
        getNoteRevisions(noteId),
        getNoteActivities(noteId),
        listOverlaySnapshots(noteId),
      ]);
      setRevisions(revisionResult.status === 'fulfilled' ? revisionResult.value : []);
      setActivities(activityResult.status === 'fulfilled' ? activityResult.value : []);
      setSnapshots(snapshotResult.status === 'fulfilled' ? snapshotResult.value : []);
      setLoading(false);
    };

    load();
  }, [noteId]);

  // 合併三種來源、依時間倒序。
  const entries = useMemo<TimelineEntry[]>(() => {
    // 版本來源載入失敗（或異常為空——正常筆記至少有 create 一版）時不套重複過濾：
    // 否則 created/deleted 活動被隱藏、版本卡片又不存在，時間軸會看似完整卻漏事件。
    const applyDuplicateFilter = revisions.length > 0;
    const merged: TimelineEntry[] = [
      ...revisions.map((revision): TimelineEntry => ({
        kind: 'revision',
        // 排序/分組鍵一律用 updatedDateTime：時間窗合併會讓 createdDateTime 停在
        // 鏈首、內容卻是鏈尾（復審 H4）；舊快取資料無此欄時退回 createdDateTime。
        at: revision.updatedDateTime || revision.createdDateTime,
        revision,
      })),
      ...activities
        .filter((activity) => !applyDuplicateFilter || !isDuplicatedByRevision(activity))
        .map((activity): TimelineEntry => ({
          kind: 'activity',
          at: activity.at,
          activity,
        })),
      ...snapshots.map((snapshot): TimelineEntry => ({
        kind: 'snapshot',
        at: snapshot.createdDateTime,
        snapshot,
      })),
    ];
    return merged.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }, [revisions, activities, snapshots]);

  const formatTime = (dateStr: string) => formatFullDateTime(dateStr, userTimeZone);
  const newestRevisionId = revisions.length > 0 ? revisions[revisions.length - 1].id : null;
  const oldestRevisionId = revisions.length > 0 ? revisions[0].id : null;

  // 按天分組（分組時區＝顯示時區，避免組頭日期與組內時間對不上——復審 M4）。
  const dayGroups = useMemo(
    () => groupEntriesByDay(entries, userTimeZone),
    [entries, userTimeZone],
  );

  const collapsedDays = useMemo(() => {
    if (collapsedDaysOverride) return collapsedDaysOverride;
    return new Set(dayGroups.slice(1).map((group) => group.day));
  }, [collapsedDaysOverride, dayGroups]);

  /** 切換某一天的摺疊狀態（首次手動操作時把預設狀態實體化）。 */
  const toggleDay = (day: string) => {
    const next = new Set(collapsedDays);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    setCollapsedDaysOverride(next);
  };

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

  if (entries.length === 0) {
    return (
      <div
        style={{
          padding: 'var(--spacing-6)',
          textAlign: 'center',
          color: 'var(--text-tertiary)',
        }}
      >
        <p style={{ margin: 0 }}>暫無歷史紀錄</p>
      </div>
    );
  }

  /** 渲染單一時間軸項目（版本卡片／浮層快照細列／活動細列）。 */
  const renderEntry = (entry: TimelineEntry): React.ReactElement => {
    {
      if (entry.kind === 'revision') {
          return (
            <RevisionItem
              key={`rev-${entry.revision.id}`}
              revision={entry.revision}
              isNewest={entry.revision.id === newestRevisionId}
              isOldest={entry.revision.id === oldestRevisionId}
              isExpanded={expandedRevision === entry.revision.id}
              onToggleExpand={() =>
                setExpandedRevision(
                  expandedRevision === entry.revision.id ? null : entry.revision.id
                )
              }
              userTimeZone={userTimeZone}
            />
          );
        }

        if (entry.kind === 'snapshot') {
          return (
            <div key={`snap-${entry.snapshot.id}`} style={slimRowStyle}>
              <span style={{ flexShrink: 0 }}>🧷</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                浮層快照 #{entry.snapshot.snapshotNo}
              </span>
              <span style={{ color: 'var(--text-secondary)' }}>{entry.snapshot.summary}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--text-tertiary)', flexShrink: 0 }}>
                {formatTime(entry.snapshot.createdDateTime)}
              </span>
            </div>
          );
        }

        const { activity } = entry;
        return (
          <div key={`act-${activity.id}`} style={slimRowStyle}>
            <span style={{ flexShrink: 0 }}>{activityIcon(activity)}</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 500, flexShrink: 0 }}>
              {activityActionLabel(activity.action)}
            </span>
            {activity.detail && (
              <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-word' }}>
                {activity.detail}
              </span>
            )}
            {activity.source !== 'web' && (
              <span
                title={`透過 API 權杖「${activity.source}」操作`}
                style={{
                  padding: '1px 6px',
                  background: 'var(--bg-primary)',
                  borderRadius: 'var(--radius-full)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-tertiary)',
                  flexShrink: 0,
                }}
              >
                🤖 {activity.source}
              </span>
            )}
            <span style={{ marginLeft: 'auto', color: 'var(--text-tertiary)', flexShrink: 0 }}>
              {formatTime(activity.at)}
            </span>
          </div>
        );
    }
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
      {dayGroups.map((group) => {
        const isCollapsed = collapsedDays.has(group.day);
        return (
          <div key={group.day} style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
            {/* 組頭：日期＋筆數，點擊摺疊/展開（預設只展開最新一天——歷史筆數體感優化） */}
            <button
              type="button"
              onClick={() => toggleDay(group.day)}
              aria-expanded={!isCollapsed}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-2)',
                padding: 'var(--spacing-2) var(--spacing-3)',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-secondary)',
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-block',
                  transition: 'transform 0.15s ease',
                  transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                }}
              >
                ▸
              </span>
              📅 {group.day}
              <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>
                （{group.entries.length} 筆）
              </span>
            </button>
            {!isCollapsed && group.entries.map(renderEntry)}
          </div>
        );
      })}
    </div>
  );
}

/** 細列（活動／浮層快照）的共用樣式。 */
const slimRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  flexWrap: 'wrap',
  gap: 'var(--spacing-2)',
  padding: 'var(--spacing-2) var(--spacing-4)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--text-sm)',
};

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
      delete: { label: '刪除', icon: '🗑️' },
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
            {/* 主時間＝最後變更時間（時間窗合併會前進它）；合併鏈（≠鏈首）時補標起點。 */}
            <span>⏱️ {formatTime(revision.updatedDateTime || revision.createdDateTime)}</span>
            {revision.updatedDateTime && revision.updatedDateTime !== revision.createdDateTime && (
              <span
                title="此版本由時間窗內的多次連續編輯合併而成"
                style={{ color: 'var(--text-tertiary)' }}
              >
                （{formatTime(revision.createdDateTime)} 起的連續編輯）
              </span>
            )}
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
              <span>💡 展開可查看此版本的標題與內容快照</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
