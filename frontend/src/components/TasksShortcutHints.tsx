"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_SCOPE_LABEL,
  type ShortcutOverrides,
  type ShortcutScope,
  effectiveKey,
  keyCapLabel,
  loadShortcutOverrides,
  SHORTCUTS_UPDATED_EVENT,
} from "@/lib/shortcuts";

/**
 * Todo 頁左側欄的「鍵盤快捷鍵」清單（取代原先的純文字提示）。
 * - 依範圍（全域 / Todo 頁）分組列出每個動作目前生效的鍵位。
 * - 鍵位覆寫更新時（SHORTCUTS_UPDATED_EVENT）即時刷新。
 * - 底部提供「自訂快捷鍵」連結 → /profile/shortcuts。
 */
export function TasksShortcutHints() {
  const [overrides, setOverrides] = useState<ShortcutOverrides>({});

  useEffect(() => {
    let alive = true;
    loadShortcutOverrides().then((ov) => {
      if (alive) setOverrides(ov);
    });
    const onUpdated = () => {
      loadShortcutOverrides(true).then((ov) => setOverrides(ov));
    };
    window.addEventListener(SHORTCUTS_UPDATED_EVENT, onUpdated);
    return () => {
      alive = false;
      window.removeEventListener(SHORTCUTS_UPDATED_EVENT, onUpdated);
    };
  }, []);

  const scopes: ShortcutScope[] = ["global", "tasks"];

  return (
    <div className="ksc-wrap">
      <p className="ksc-head">鍵盤快捷鍵</p>
      {scopes.map((scope) => (
        <div key={scope} className="ksc-group">
          <p className="ksc-group-title">{SHORTCUT_SCOPE_LABEL[scope]}</p>
          <ul className="ksc-list">
            {SHORTCUT_ACTIONS.filter((a) => a.scope === scope).map((action) => (
              <li key={action.id} className="ksc-row">
                <span className="ksc-label">{action.label}</span>
                <kbd className="ksc-key">{keyCapLabel(effectiveKey(action, overrides))}</kbd>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <Link href="/profile/shortcuts" className="ksc-link">
        ⚙ 自訂快捷鍵
      </Link>

      <style jsx>{`
        .ksc-wrap {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-3);
        }
        .ksc-head {
          margin: 0;
          font-size: var(--text-xs);
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .ksc-group-title {
          margin: 0 0 var(--spacing-1) 0;
          font-size: var(--text-xs);
          font-weight: 600;
          color: var(--text-secondary);
        }
        .ksc-list {
          margin: 0;
          padding: 0;
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .ksc-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--spacing-2);
          font-size: var(--text-sm);
          color: var(--text-secondary);
        }
        .ksc-label {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ksc-key {
          flex-shrink: 0;
          min-width: 20px;
          text-align: center;
          padding: 1px 6px;
          border: 1px solid var(--border-default);
          border-bottom-width: 2px;
          border-radius: var(--radius-sm);
          background: var(--bg-default);
          color: var(--text-primary);
          font-size: var(--text-xs);
          font-family: var(--font-geist-mono, monospace);
          font-weight: 600;
        }
        .ksc-link {
          margin-top: var(--spacing-1);
          font-size: var(--text-sm);
          color: var(--action-primary-bg, var(--text-link, #2563eb));
          text-decoration: none;
        }
        .ksc-link:hover {
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
