"use client";

import { useEffect, useMemo, useState } from "react";
import { ProfileShell, cardStyle, sectionTitleStyle } from "../profileShared";
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_SCOPE_LABEL,
  type ShortcutOverrides,
  type ShortcutScope,
  effectiveKey,
  findConflicts,
  keyCapLabel,
  loadShortcutOverrides,
  saveShortcutOverrides,
} from "@/lib/shortcuts";

/** 動作 ID → 中文標籤（衝突訊息用）。 */
const LABEL_BY_ID: Record<string, string> = Object.fromEntries(
  SHORTCUT_ACTIONS.map((a) => [a.id, a.label])
);

/**
 * 個人頁面 — 快捷鍵設定子頁 /profile/shortcuts（#2 可自訂改鍵）。
 *
 * - 分「全域」與「Todo 頁」兩區列出所有動作目前生效的鍵位。
 * - 點「重新綁定」進入擷取模式，按下新按鍵即綁定（Esc 取消）；擷取時以 capture
 *   階段攔截並 stopImmediatePropagation，避免被全域執行器搶走。
 * - 即時偵測按鍵衝突（任兩動作同鍵），有衝突則禁止儲存。
 * - 可單項還原預設或一鍵全部還原。儲存寫入後端並廣播事件，全站即時套用。
 */
export default function ProfileShortcutsPage() {
  // draft：每個動作目前的「生效鍵」完整對應表（編輯中狀態）。
  const [draft, setDraft] = useState<ShortcutOverrides>({});
  const [loading, setLoading] = useState(true);
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // 載入既有覆寫 → 展開成完整生效鍵對應表。
  useEffect(() => {
    let alive = true;
    loadShortcutOverrides().then((overrides) => {
      if (!alive) return;
      const full: ShortcutOverrides = {};
      for (const action of SHORTCUT_ACTIONS) {
        full[action.id] = effectiveKey(action, overrides);
      }
      setDraft(full);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 擷取按鍵：以 capture 階段攔截，阻止全域執行器觸發。
  useEffect(() => {
    if (!capturingId) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        setCapturingId(null);
        return;
      }
      const key = e.key.toLowerCase();
      if (!/^[a-z0-9]$/.test(key)) return; // 只接受英數單鍵；其它忽略、繼續等待
      setDraft((prev) => ({ ...prev, [capturingId]: key }));
      setCapturingId(null);
      setSavedMsg(null);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [capturingId]);

  const conflicts = useMemo(() => findConflicts(draft), [draft]);
  const hasConflict = Object.keys(conflicts).length > 0;

  const resetOne = (id: string) => {
    const def = SHORTCUT_ACTIONS.find((a) => a.id === id)?.defaultKey;
    if (!def) return;
    setDraft((prev) => ({ ...prev, [id]: def }));
    setSavedMsg(null);
  };

  const resetAll = () => {
    const full: ShortcutOverrides = {};
    for (const action of SHORTCUT_ACTIONS) full[action.id] = action.defaultKey;
    setDraft(full);
    setSavedMsg(null);
  };

  const save = async () => {
    if (hasConflict || saving) return;
    setSaving(true);
    const ok = await saveShortcutOverrides(draft);
    setSaving(false);
    setSavedMsg(ok ? "已儲存，立即生效。" : "儲存失敗，請稍後重試。");
  };

  const scopes: ShortcutScope[] = ["global", "tasks"];

  return (
    <ProfileShell title="快捷鍵設定" loading={loading} error={null}>
      <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", margin: "0 0 var(--spacing-4)" }}>
        點「重新綁定」後按下想要的按鍵即可改鍵（Esc 取消）；按鍵在輸入文字時不會觸發。
        全域快捷鍵於任何頁面皆生效，Todo 頁快捷鍵僅在日程規劃頁生效。
      </p>

      {scopes.map((scope) => (
        <section key={scope} style={cardStyle}>
          <h2 style={sectionTitleStyle}>{SHORTCUT_SCOPE_LABEL[scope]}</h2>
          <div className="sc-list">
            {SHORTCUT_ACTIONS.filter((a) => a.scope === scope).map((action) => {
              const key = draft[action.id] ?? action.defaultKey;
              const isCapturing = capturingId === action.id;
              const dupIds = conflicts[action.id];
              const isDefault = key === action.defaultKey;
              return (
                <div key={action.id} className={`sc-row ${dupIds ? "sc-row--conflict" : ""}`}>
                  <div className="sc-info">
                    <span className="sc-label">{action.label}</span>
                    {dupIds && (
                      <span className="sc-warn">
                        ⚠ 與「{dupIds.map((id) => LABEL_BY_ID[id]).join("、")}」重複
                      </span>
                    )}
                  </div>
                  <div className="sc-actions">
                    <kbd className={`sc-key ${isCapturing ? "sc-key--capturing" : ""}`}>
                      {isCapturing ? "按下新鍵…" : keyCapLabel(key)}
                    </kbd>
                    <button
                      type="button"
                      className="sc-btn"
                      onClick={() => {
                        setCapturingId(action.id);
                        setSavedMsg(null);
                      }}
                    >
                      重新綁定
                    </button>
                    <button
                      type="button"
                      className="sc-btn sc-btn--ghost"
                      onClick={() => resetOne(action.id)}
                      disabled={isDefault}
                      title={isDefault ? "已是預設" : `還原為預設（${keyCapLabel(action.defaultKey)}）`}
                    >
                      還原
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <div className="sc-footer">
        <button type="button" className="sc-btn sc-btn--ghost" onClick={resetAll}>
          全部還原預設
        </button>
        <div style={{ flex: 1 }} />
        {savedMsg && <span className="sc-saved">{savedMsg}</span>}
        {hasConflict && <span className="sc-warn">請先解決按鍵衝突</span>}
        <button
          type="button"
          className="sc-btn sc-btn--primary"
          onClick={save}
          disabled={hasConflict || saving}
        >
          {saving ? "儲存中…" : "儲存"}
        </button>
      </div>

      <style jsx>{`
        .sc-list {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-2);
        }
        .sc-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--spacing-3);
          padding: var(--spacing-2) var(--spacing-3);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          background: var(--bg-default);
          flex-wrap: wrap;
        }
        .sc-row--conflict {
          border-color: var(--status-danger-fg, #c0392b);
          background: var(--status-danger-bg, #fdecea);
        }
        .sc-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .sc-label {
          font-size: var(--text-sm);
          color: var(--text-primary);
        }
        .sc-warn {
          font-size: var(--text-xs);
          color: var(--status-danger-fg, #c0392b);
        }
        .sc-actions {
          display: flex;
          align-items: center;
          gap: var(--spacing-2);
        }
        .sc-key {
          min-width: 60px;
          text-align: center;
          padding: 2px 8px;
          border: 1px solid var(--border-default);
          border-bottom-width: 2px;
          border-radius: var(--radius-sm);
          background: var(--bg-surface);
          color: var(--text-primary);
          font-size: var(--text-sm);
          font-family: var(--font-geist-mono, monospace);
          font-weight: 600;
        }
        .sc-key--capturing {
          border-color: var(--action-primary-bg);
          color: var(--action-primary-bg);
          font-family: inherit;
          font-weight: 500;
        }
        .sc-btn {
          padding: var(--spacing-1) var(--spacing-3);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          background: var(--bg-surface);
          color: var(--text-primary);
          font-size: var(--text-sm);
          cursor: pointer;
        }
        .sc-btn:hover {
          background: var(--bg-surface-secondary, var(--bg-default));
        }
        .sc-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .sc-btn--ghost {
          background: transparent;
          color: var(--text-secondary);
        }
        .sc-btn--primary {
          background: var(--action-primary-bg);
          color: var(--action-primary-fg);
          border-color: var(--action-primary-bg);
          font-weight: 600;
        }
        .sc-footer {
          display: flex;
          align-items: center;
          gap: var(--spacing-3);
          margin-top: var(--spacing-2);
        }
        .sc-saved {
          font-size: var(--text-sm);
          color: var(--status-success-fg, #16a34a);
        }
      `}</style>
    </ProfileShell>
  );
}
