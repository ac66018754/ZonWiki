"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CurrentUser } from "@/lib/api";
import { MobileSectionNav } from "../MobileSectionNav";
import { TasksShortcutHints } from "../TasksShortcutHints";
import { TasksPinnedList } from "../TasksPinnedList";

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
 * 日程規劃（/tasks）的情境側欄：標題＋分頁切換（置頂的任務 / 快捷鍵介紹）。
 * 由原 Sidebar 抽出（審查 finding #22 拆檔）。
 * 最上方為兩個平行分頁的切換鈕，**預設顯示「置頂的任務」**，點擊切換鈕才換到「快捷鍵介紹」。
 */
export function TasksSidebar(): React.ReactElement {
  // 側欄分頁："pinned"＝置頂的任務（預設）｜"shortcuts"＝快捷鍵介紹。
  const [tab, setTab] = useState<"pinned" | "shortcuts">("pinned");

  return (
    <aside id="app-sidebar" className="sidebar" role="complementary">
      <MobileSectionNav />
      <div className="ctx-head">
        <h2 className="ctx-title">日程規劃 (Todo &amp; Planning)</h2>
      </div>

      {/* 分頁切換：置頂的任務（預設） / 快捷鍵介紹。
          依 WAI-ARIA Tabs 模式：tab 以 aria-controls 連到 tabpanel、支援 ←→ 方向鍵切換。 */}
      <div
        className="ctx-tabs"
        role="tablist"
        aria-label="側欄分頁"
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            setTab((prev) => (prev === "pinned" ? "shortcuts" : "pinned"));
          }
        }}
      >
        <button
          type="button"
          role="tab"
          id="tasks-sidebar-tab-pinned"
          aria-controls="tasks-sidebar-panel"
          aria-selected={tab === "pinned"}
          className={`ctx-tab ${tab === "pinned" ? "ctx-tab--on" : ""}`}
          onClick={() => setTab("pinned")}
        >
          📍 置頂的任務
        </button>
        <button
          type="button"
          role="tab"
          id="tasks-sidebar-tab-shortcuts"
          aria-controls="tasks-sidebar-panel"
          aria-selected={tab === "shortcuts"}
          className={`ctx-tab ${tab === "shortcuts" ? "ctx-tab--on" : ""}`}
          onClick={() => setTab("shortcuts")}
        >
          ⌨️ 快捷鍵介紹
        </button>
      </div>

      <div
        id="tasks-sidebar-panel"
        role="tabpanel"
        aria-labelledby={tab === "pinned" ? "tasks-sidebar-tab-pinned" : "tasks-sidebar-tab-shortcuts"}
      >
        {tab === "pinned" ? <TasksPinnedList /> : <TasksShortcutHints />}
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
          margin-bottom: var(--spacing-4);
          padding: 3px;
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          background: var(--bg-default);
        }
        .ctx-tab {
          flex: 1;
          min-width: 0;
          padding: var(--spacing-1) var(--spacing-2);
          border: none;
          border-radius: var(--radius-sm);
          background: transparent;
          color: var(--text-secondary);
          font-size: var(--text-sm);
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
