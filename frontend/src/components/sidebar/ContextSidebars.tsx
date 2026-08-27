"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CurrentUser } from "@/lib/api";
import { MobileSectionNav } from "../MobileSectionNav";
import { TasksShortcutHints } from "../TasksShortcutHints";
import { TasksPinnedList } from "../TasksPinnedList";
import { TasksTodayList } from "../TasksTodayList";
import { emitNewTaskRequest } from "@/lib/taskEvents";

/**
 * 個人頁面（/profile）子頁導覽項目。各子頁各自載入自己的資料。
 */
const PROFILE_NAV: { href: string; label: string; icon: string; desc: string }[] = [
  { href: "/profile", label: "帳號資訊", icon: "👤", desc: "暱稱、時區、密碼、帳號" },
  { href: "/profile/stats", label: "統計數據", icon: "📊", desc: "筆記/任務/畫布等筆數" },
  { href: "/profile/activity", label: "活動紀錄", icon: "🕑", desc: "近 30 天操作明細" },
  { href: "/profile/tokens", label: "API 權杖", icon: "🔑", desc: "供 AI 助理存取的權杖" },
  { href: "/profile/refine", label: "精煉成筆記", icon: "✨", desc: "轉錄引擎 / Groq 金鑰" },
  { href: "/profile/shortcuts", label: "快捷鍵", icon: "⌨️", desc: "自訂鍵盤快捷鍵" },
];

/**
 * 「其他」功能群（/others）子頁導覽項目。各子頁各自載入自己的資料。
 * Phase 1 只有記帳為功能頁；單字庫（Phase 2）、英文教練（Phase 3）為佔位頁。
 */
const OTHERS_NAV: { href: string; label: string; icon: string; desc: string }[] = [
  { href: "/others/expense", label: "記帳", icon: "💰", desc: "一句話記帳＋清單分析" },
  { href: "/others/vocabulary", label: "單字庫", icon: "📚", desc: "單字 SRS 間隔複習" },
  { href: "/others/coach", label: "英文教練", icon: "🎙️", desc: "即時語音對話（Phase 3）" },
];

/** Todo 側欄的三個分頁。 */
type TasksSidebarTab = "pinned" | "today" | "shortcuts";

/**
 * 分頁按鈕的定義（顯示順序即陣列順序；←→ 方向鍵也依此順序循環）。
 *
 * 標籤刻意「不放 emoji」：側欄寬 260px、三個分頁均分後每格只有約 75px，
 * 圖示＋文字會互相疊字（2026-08-28 截圖實測）。純文字剛好放得下。
 */
const TASKS_SIDEBAR_TABS: { id: TasksSidebarTab; label: string }[] = [
  { id: "pinned", label: "置頂的任務" },
  { id: "today", label: "今日任務" },
  { id: "shortcuts", label: "快捷鍵" },
];

/**
 * 日程規劃（/tasks）的情境側欄：標題＋分頁切換（置頂的任務 / 今日任務 / 快捷鍵介紹）。
 * 由原 Sidebar 抽出（審查 finding #22 拆檔）。
 * 最上方為分頁切換鈕，**預設顯示「置頂的任務」**，點擊切換鈕才換到其他分頁。
 *
 * 「置頂的任務」分頁右上另有「＋ 新增」：按下派發事件請 Todo 頁彈出快速新增表單，
 * 並預先勾選「置頂（Todo 側欄）」——從這個分頁新增，意圖本來就是要它出現在這裡。
 *
 * @param user 目前登入者（「今日任務」需要其時區判斷「今天」是哪一天）。
 */
export function TasksSidebar({ user }: { user: CurrentUser | null }): React.ReactElement {
  // 側欄分頁："pinned"＝置頂的任務（預設）｜"today"＝今日任務｜"shortcuts"＝快捷鍵介紹。
  const [tab, setTab] = useState<TasksSidebarTab>("pinned");

  /** ←→ 方向鍵在分頁間循環（WAI-ARIA Tabs 模式）。 */
  const moveTab = (step: 1 | -1) => {
    setTab((prev) => {
      const index = TASKS_SIDEBAR_TABS.findIndex((t) => t.id === prev);
      const next = (index + step + TASKS_SIDEBAR_TABS.length) % TASKS_SIDEBAR_TABS.length;
      return TASKS_SIDEBAR_TABS[next].id;
    });
  };

  return (
    <aside id="app-sidebar" className="sidebar" role="complementary">
      <MobileSectionNav />
      <div className="ctx-head">
        <h2 className="ctx-title">日程規劃 (Todo &amp; Planning)</h2>
      </div>

      {/* 分頁切換：置頂的任務（預設） / 今日任務 / 快捷鍵介紹。
          依 WAI-ARIA Tabs 模式：tab 以 aria-controls 連到 tabpanel、支援 ←→ 方向鍵切換。 */}
      <div
        className="ctx-tabs"
        role="tablist"
        aria-label="側欄分頁"
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            moveTab(e.key === "ArrowRight" ? 1 : -1);
          }
        }}
      >
        {TASKS_SIDEBAR_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tasks-sidebar-tab-${item.id}`}
            aria-controls="tasks-sidebar-panel"
            aria-selected={tab === item.id}
            className={`ctx-tab ${tab === item.id ? "ctx-tab--on" : ""}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        id="tasks-sidebar-panel"
        role="tabpanel"
        aria-labelledby={`tasks-sidebar-tab-${tab}`}
      >
        {tab === "pinned" && (
          <TasksPinnedList
            // 「＋ 新增」放在清單的標題列右側（而非另起一行）：側欄垂直空間寶貴，
            // 分頁列＋標題列＋按鈕列三層會把清單擠到很下面。
            headerAction={
              <button
                type="button"
                className="ctx-action"
                onClick={() => emitNewTaskRequest({ pinnedToTodo: true })}
                title="新增一張任務，並預先勾選「置頂（Todo 側欄）」"
                data-testid="tasks-sidebar-new-pinned"
              >
                ＋ 新增
              </button>
            }
          />
        )}
        {tab === "today" && <TasksTodayList user={user} />}
        {tab === "shortcuts" && <TasksShortcutHints />}
      </div>

      <style jsx>{`
        .ctx-head {
          margin-bottom: var(--spacing-3);
          padding-bottom: var(--spacing-3);
          border-bottom: 1px solid var(--border-default);
        }
        .ctx-title {
          margin: 0;
          font-size: var(--text-sm);
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .ctx-tabs {
          display: flex;
          gap: var(--spacing-1);
          margin-bottom: var(--spacing-3);
          padding: 3px;
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          background: var(--bg-default);
        }
        .ctx-tab {
          flex: 1;
          min-width: 0;
          padding: var(--spacing-1) 4px;
          border: none;
          border-radius: var(--radius-sm);
          background: transparent;
          color: var(--text-secondary);
          font-family: var(--font-body);
          /* 三個分頁擠在 260px 側欄裡：字級降一階才不會被硬換行切成兩行。 */
          font-size: var(--text-xs);
          white-space: nowrap;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease;
        }
        .ctx-tab:hover {
          color: var(--text-primary);
        }
        .ctx-tab:focus-visible {
          outline: 2px solid var(--action-secondary-fg);
          outline-offset: 1px;
        }
        .ctx-tab--on {
          background: var(--action-secondary-bg);
          color: var(--action-secondary-fg);
          font-weight: 600;
        }
        .ctx-action {
          display: inline-flex;
          align-items: center;
          flex-shrink: 0;
          min-height: 26px;
          padding: 2px var(--spacing-2);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          background: var(--action-secondary-bg);
          color: var(--action-secondary-fg);
          font-family: var(--font-body);
          font-size: var(--text-xs);
          font-weight: 600;
          white-space: nowrap;
          cursor: pointer;
          transition: background 0.15s ease;
        }
        .ctx-action:hover {
          background: var(--action-secondary-hover);
        }
        .ctx-action:focus-visible {
          outline: 2px solid var(--action-secondary-fg);
          outline-offset: 1px;
        }
      `}</style>
    </aside>
  );
}

/**
 * 個人頁側欄（帳號 / 統計 / 活動 / 快捷鍵 子頁導覽）。
 * 由原 Sidebar 抽出（審查 finding #22 拆檔），行為與樣式一致。
 * @param user 目前登入者（顯示暱稱與頭像字首）。
 */
export function ProfileSidebar({ user }: { user: CurrentUser | null }): React.ReactElement {
  const pathname = usePathname();
  return (
    <aside id="app-sidebar" className="sidebar" role="complementary">
      <MobileSectionNav />
      <div className="pf-head">
        <div className="pf-avatar">{user?.displayName?.charAt(0).toUpperCase() ?? "?"}</div>
        <div className="pf-head-text">
          <div className="pf-head-name">{user?.displayName ?? "個人頁面"}</div>
          <div className="pf-head-sub">個人頁面</div>
        </div>
      </div>
      <nav className="pf-nav">
        {PROFILE_NAV.map((item) => {
          const active =
            item.href === "/profile"
              ? pathname === "/profile"
              : pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`pf-link ${active ? "pf-link--active" : ""}`}
            >
              <span className="pf-icon" aria-hidden>
                {item.icon}
              </span>
              <span className="pf-link-text">
                <span className="pf-link-label">{item.label}</span>
                <span className="pf-link-desc">{item.desc}</span>
              </span>
            </Link>
          );
        })}
      </nav>
      <style jsx>{`
        .pf-head {
          display: flex;
          align-items: center;
          gap: var(--spacing-3);
          margin-bottom: var(--spacing-4);
          padding-bottom: var(--spacing-4);
          border-bottom: 1px solid var(--border-default);
        }
        .pf-avatar {
          flex-shrink: 0;
          width: 40px;
          height: 40px;
          border-radius: var(--radius-full);
          background: var(--action-secondary-bg);
          color: var(--action-secondary-fg);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: var(--text-lg);
        }
        .pf-head-text {
          min-width: 0;
        }
        .pf-head-name {
          font-size: var(--text-base);
          font-weight: 700;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pf-head-sub {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .pf-nav {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-1);
        }
        .pf-link {
          position: relative;
          display: flex;
          align-items: center;
          gap: var(--spacing-3);
          padding: var(--spacing-2) var(--spacing-3);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          text-decoration: none;
          border: 1px solid transparent;
          transition: background 0.15s ease, border-color 0.15s ease;
        }
        .pf-link:hover {
          background: var(--bg-surface-secondary, var(--bg-default));
          border-color: var(--border-default);
        }
        .pf-link--active {
          background: var(--action-secondary-bg);
          border-color: var(--action-secondary-fg);
        }
        .pf-link--active::before {
          content: "";
          position: absolute;
          left: 0;
          top: 6px;
          bottom: 6px;
          width: 3px;
          border-radius: 0 3px 3px 0;
          background: var(--action-secondary-fg);
        }
        .pf-icon {
          flex-shrink: 0;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius-sm);
          background: var(--bg-surface-secondary, var(--bg-default));
          font-size: var(--text-base);
        }
        .pf-link--active .pf-icon {
          background: var(--bg-surface);
        }
        .pf-link-text {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .pf-link-label {
          font-size: var(--text-sm);
          font-weight: 600;
          color: var(--text-primary);
        }
        .pf-link--active .pf-link-label {
          color: var(--action-secondary-fg);
        }
        .pf-link-desc {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `}</style>
    </aside>
  );
}

/**
 * 「其他」功能群側欄（/others*）：記帳 / 單字庫 / 英文教練 子頁導覽。
 *
 * 骨架照 {@link ProfileSidebar}：頂端 `<MobileSectionNav />`、`usePathname()` 判 active。
 * styled-jsx 會把 `pf-*` 類別作用域到本元件（與 ProfileSidebar 各自獨立、不互相污染），
 * 故沿用同名 `pf-*` 類別可得到與個人頁一致的視覺；需連同整段 `<style jsx>` 一起帶。
 * @param user 目前登入者（顯示頭像字首——此處固定用工具箱圖示 🧰，故僅型別相容、不必顯示）。
 */
export function OthersSidebar({ user }: { user: CurrentUser | null }): React.ReactElement {
  // user 目前不顯示於標頭（標頭固定為「其他 / 工具與功能」），保留參數以與 ProfileSidebar 同構、
  // 供日後（如記帳頁在側欄顯示本月總額）擴充；標一次以避免未使用參數 lint 警告。
  void user;
  const pathname = usePathname();
  return (
    <aside id="app-sidebar" className="sidebar" role="complementary">
      <MobileSectionNav />
      <div className="pf-head">
        <div className="pf-avatar" aria-hidden>
          🧰
        </div>
        <div className="pf-head-text">
          <div className="pf-head-name">其他</div>
          <div className="pf-head-sub">工具與功能</div>
        </div>
      </div>
      <nav className="pf-nav">
        {OTHERS_NAV.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`pf-link ${active ? "pf-link--active" : ""}`}
            >
              <span className="pf-icon" aria-hidden>
                {item.icon}
              </span>
              <span className="pf-link-text">
                <span className="pf-link-label">{item.label}</span>
                <span className="pf-link-desc">{item.desc}</span>
              </span>
            </Link>
          );
        })}
      </nav>
      <style jsx>{`
        .pf-head {
          display: flex;
          align-items: center;
          gap: var(--spacing-3);
          margin-bottom: var(--spacing-4);
          padding-bottom: var(--spacing-4);
          border-bottom: 1px solid var(--border-default);
        }
        .pf-avatar {
          flex-shrink: 0;
          width: 40px;
          height: 40px;
          border-radius: var(--radius-full);
          background: var(--action-secondary-bg);
          color: var(--action-secondary-fg);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: var(--text-lg);
        }
        .pf-head-text {
          min-width: 0;
        }
        .pf-head-name {
          font-size: var(--text-base);
          font-weight: 700;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pf-head-sub {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .pf-nav {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-1);
        }
        .pf-link {
          position: relative;
          display: flex;
          align-items: center;
          gap: var(--spacing-3);
          padding: var(--spacing-2) var(--spacing-3);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          text-decoration: none;
          border: 1px solid transparent;
          transition: background 0.15s ease, border-color 0.15s ease;
        }
        .pf-link:hover {
          background: var(--bg-surface-secondary, var(--bg-default));
          border-color: var(--border-default);
        }
        .pf-link--active {
          background: var(--action-secondary-bg);
          border-color: var(--action-secondary-fg);
        }
        .pf-link--active::before {
          content: "";
          position: absolute;
          left: 0;
          top: 6px;
          bottom: 6px;
          width: 3px;
          border-radius: 0 3px 3px 0;
          background: var(--action-secondary-fg);
        }
        .pf-icon {
          flex-shrink: 0;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius-sm);
          background: var(--bg-surface-secondary, var(--bg-default));
          font-size: var(--text-base);
        }
        .pf-link--active .pf-icon {
          background: var(--bg-surface);
        }
        .pf-link-text {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .pf-link-label {
          font-size: var(--text-sm);
          font-weight: 600;
          color: var(--text-primary);
        }
        .pf-link--active .pf-link-label {
          color: var(--action-secondary-fg);
        }
        .pf-link-desc {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `}</style>
    </aside>
  );
}
