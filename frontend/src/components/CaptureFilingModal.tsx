"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CaptureLink,
  createNote,
  createTaskCard,
  listCaptureLinks,
  addCaptureLink,
  deleteCapture,
} from "@/lib/api";
import { logger } from "@/lib/logger";
import { useConfirm } from "@/components/ConfirmProvider";

/**
 * 捕捉分流彈窗：
 * - 上方 1/3：顯示這則「快速記錄」的原始內容（唯讀）。
 * - 下方 2/3：可切換「筆記 / Todo」的新增表單；並列出這則捕捉「過去衍生過的筆記/Todo」（不限筆數）。
 * 建立後即時回填到列表，且通知首頁刷新。
 */
export function CaptureFilingModal({
  capture,
  onClose,
  onChanged,
}: {
  /** 要分流的捕捉（null 時不顯示） */
  capture: { id: string; rawContent: string } | null;
  /** 關閉彈窗 */
  onClose: () => void;
  /** 內容變更（建立/刪除）後通知首頁刷新 */
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [tab, setTab] = useState<"note" | "taskcard">("note");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [links, setLinks] = useState<CaptureLink[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [busy, setBusy] = useState(false);

  const captureId = capture?.id ?? null;

  // 載入「過去衍生」清單；並把表單內容預填為捕捉原文（方便沿用、可再編輯）。
  useEffect(() => {
    if (!captureId) return;
    setTab("note");
    setTitle("");
    setContent(capture?.rawContent ?? "");
    setLoadingLinks(true);
    listCaptureLinks(captureId)
      .then(setLinks)
      .catch(() => setLinks([]))
      .finally(() => setLoadingLinks(false));
    // 僅在切換捕捉時重置表單；capture.rawContent 在彈窗開啟期間穩定，不需列入相依。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureId]);

  // Esc 關閉
  useEffect(() => {
    if (!captureId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [captureId, onClose]);

  const reloadLinks = useCallback(async () => {
    if (!captureId) return;
    try {
      setLinks(await listCaptureLinks(captureId));
    } catch (err) {
      logger.error("Failed to reload capture links:", err);
    }
  }, [captureId]);

  const handleCreate = async () => {
    if (!captureId || !title.trim() || busy) return;
    setBusy(true);
    try {
      let targetId: string | null = null;
      if (tab === "note") {
        const note = await createNote({ title: title.trim(), contentRaw: content });
        targetId = note?.id ?? null;
      } else {
        const task = await createTaskCard({ title: title.trim(), content, status: "todo" });
        targetId = task?.id ?? null;
      }
      if (targetId) {
        await addCaptureLink(captureId, tab, targetId);
        await reloadLinks();
        setTitle("");
        // 內容保留為原文，方便再建立另一筆；使用者可自行清空。
        onChanged();
      }
    } catch (err) {
      logger.error("Failed to file capture:", err);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteCapture = async () => {
    if (!captureId) return;
    if (!(await confirm({ message: "刪除這則快速記錄？（會進垃圾桶，可還原）", danger: true }))) return;
    setBusy(true);
    try {
      await deleteCapture(captureId);
      onChanged();
      onClose();
    } catch (err) {
      logger.error("Failed to delete capture:", err);
    } finally {
      setBusy(false);
    }
  };

  if (!capture) return null;

  return (
    <div
      className="cfm-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cfm-modal" role="dialog" aria-modal="true" aria-label="捕捉分流">
        {/* 標題列 */}
        <div className="cfm-head">
          <span className="cfm-title">⚡ 捕捉分流</span>
          <div style={{ display: "flex", gap: "var(--spacing-2)", alignItems: "center" }}>
            <button className="tk-btn tk-btn--danger" onClick={handleDeleteCapture} disabled={busy}>
              刪除記錄
            </button>
            <button className="tk-modal-x" onClick={onClose} aria-label="關閉" title="關閉">
              ✕
            </button>
          </div>
        </div>

        {/* 上方 1/3：原始記錄（唯讀） */}
        <div className="cfm-source">
          <div className="cfm-section-label">原始記錄</div>
          <div className="cfm-source-content">{capture.rawContent || "(空白記錄)"}</div>
        </div>

        {/* 下方 2/3：過去衍生 + 新增表單 */}
        <div className="cfm-body">
          {/* 過去衍生的筆記/Todo */}
          <div className="cfm-section-label">
            過去新增（{links.length}）
          </div>
          {loadingLinks ? (
            <p className="cfm-muted">載入中…</p>
          ) : links.length === 0 ? (
            <p className="cfm-muted">尚未從這則記錄新增任何筆記或 Todo。</p>
          ) : (
            <div className="cfm-links">
              {links.map((l) => {
                const badge = l.targetType === "note" ? "📝 筆記" : "✅ Todo";
                const inner = (
                  <>
                    <span className="cfm-link-badge">{badge}</span>
                    <span className="cfm-link-title">{l.title}</span>
                  </>
                );
                if (l.isDeleted) {
                  return (
                    <div key={l.id} className="cfm-link cfm-link--deleted">
                      {inner}
                    </div>
                  );
                }
                const href = l.targetType === "note" && l.slug ? `/notes/${l.slug}` : "/tasks";
                return (
                  <Link key={l.id} href={href} className="cfm-link" onClick={onClose}>
                    {inner}
                  </Link>
                );
              })}
            </div>
          )}

          {/* 新增筆記 / Todo 表單 */}
          <div className="cfm-form">
            <div className="cfm-tabs">
              <button
                className={`cfm-tab ${tab === "note" ? "cfm-tab--on" : ""}`}
                onClick={() => setTab("note")}
                type="button"
              >
                📝 新增筆記
              </button>
              <button
                className={`cfm-tab ${tab === "taskcard" ? "cfm-tab--on" : ""}`}
                onClick={() => setTab("taskcard")}
                type="button"
              >
                ✅ 新增 Todo
              </button>
            </div>

            <input
              className="cfm-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={tab === "note" ? "筆記標題" : "任務標題"}
            />
            <textarea
              className="cfm-input cfm-textarea"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={tab === "note" ? "筆記內容（Markdown）" : "任務內容 / 備註"}
              rows={4}
            />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                className="tk-btn tk-btn--primary"
                onClick={handleCreate}
                disabled={!title.trim() || busy}
              >
                {busy ? "建立中…" : tab === "note" ? "建立筆記" : "建立 Todo"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
