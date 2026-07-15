"use client";

import { useState } from "react";
import { type TimeEntry, updateTimeEntry } from "@/lib/api";
import { DateTimePicker } from "@/components/DateTimePicker";
import { logger } from "@/lib/logger";

/**
 * 時間記錄編輯彈窗：名稱／分類／開始／結束時間（DateTimePicker，依使用者時區顯示、UTC 進出）。
 *
 * 規則（與後端一致）：名稱必填（≤200 字）；分類可空（≤128 字、留空＝未分類）；
 * 結束時間可為空（維持計時中）但「已結束者不可清空」；結束不得早於開始。
 * 錯誤一律顯示在彈窗內（不可只丟給父層——父層的錯誤列會被本彈窗的全螢幕遮罩蓋住）。
 */
export function TimeEntryEditModal({
  entry,
  tz,
  onClose,
  onSaved,
  onDelete,
}: {
  /** 要編輯的項目。 */
  entry: TimeEntry;
  /** 使用者 IANA 時區。 */
  tz: string;
  /** 關閉（不儲存）。 */
  onClose: () => void;
  /** 儲存成功後回呼（由父層重新載入並關閉彈窗）。 */
  onSaved: () => Promise<void>;
  /**
   * 刪除（父層負責確認對話框與執行）。
   * 回傳 false＝刪除失敗（本彈窗就地顯示錯誤）；true＝成功或使用者取消（不顯示錯誤）。
   */
  onDelete: () => Promise<boolean>;
}) {
  const [title, setTitle] = useState(entry.title);
  const [category, setCategory] = useState(entry.category ?? "");
  const [startIso, setStartIso] = useState<string | null>(entry.startedDateTime);
  const [endIso, setEndIso] = useState<string | null>(entry.endedDateTime);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const wasEnded = entry.endedDateTime != null;
  const busy = saving || deleting;

  /** 客戶端驗證：回傳錯誤訊息或 null（通過）。 */
  const validate = (): string | null => {
    if (!title.trim()) return "項目名稱不可空白";
    if (!startIso) return "開始時間不可空白";
    if (wasEnded && !endIso) return "已結束的記錄不可清空結束時間";
    if (endIso && new Date(endIso).getTime() < new Date(startIso).getTime()) {
      return "結束時間不得早於開始時間";
    }
    return null;
  };

  const handleSave = async () => {
    const validationError = validate();
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setFormError(null); // 驗證通過即清掉上一輪殘留的錯誤訊息
    setSaving(true);
    try {
      const updated = await updateTimeEntry(entry.id, {
        title: title.trim(),
        category: category.trim(), // 空字串＝清為未分類（後端同款語意）
        startedDateTime: startIso!,
        ...(endIso ? { endedDateTime: endIso } : {}),
      });
      if (!updated) {
        setFormError("儲存失敗，請稍後重試。");
        return;
      }
      await onSaved();
    } catch (err) {
      logger.error("Failed to update time entry:", err);
      setFormError("儲存失敗，請稍後重試。");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setFormError(null);
    setDeleting(true);
    try {
      const ok = await onDelete();
      if (!ok) setFormError("刪除失敗，請稍後重試。");
    } finally {
      setDeleting(false);
    }
  };

  const fieldLabelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "var(--text-xs)",
    color: "var(--text-secondary)",
    marginBottom: "var(--spacing-1)",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 44,
    padding: "var(--spacing-2) var(--spacing-3)",
    border: "1px solid var(--border-default)",
    borderRadius: "var(--radius-md)",
    fontSize: "var(--text-sm)",
    background: "var(--bg-default)",
    color: "var(--text-primary)",
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="編輯時間記錄"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0, 0, 0, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--spacing-4)",
      }}
      onMouseDown={(e) => {
        // 點背景（非卡片內容）關閉。
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "var(--bg-surface)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border-default)",
          padding: "var(--spacing-5)",
          width: "min(480px, 100%)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--spacing-3)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 600 }}>
            ✎ 編輯時間記錄
          </h3>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            aria-label="關閉"
            style={{ fontSize: "var(--text-sm)", minHeight: 44, minWidth: 44 }}
          >
            ✕
          </button>
        </div>

        {formError && (
          <div
            role="alert"
            style={{
              padding: "var(--spacing-2) var(--spacing-3)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--status-danger-fg, #c0392b)",
              color: "var(--status-danger-fg, #c0392b)",
              fontSize: "var(--text-sm)",
            }}
          >
            ⚠️ {formError}
          </div>
        )}

        <div>
          <label style={fieldLabelStyle} htmlFor={`te-edit-title-${entry.id}`}>
            項目名稱
          </label>
          <input
            id={`te-edit-title-${entry.id}`}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={fieldLabelStyle} htmlFor={`te-edit-category-${entry.id}`}>
            分類（留空＝未分類）
          </label>
          <input
            id={`te-edit-category-${entry.id}`}
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            maxLength={128}
            list="time-tracking-categories"
            style={inputStyle}
          />
        </div>

        <div>
          <span style={fieldLabelStyle}>開始時間</span>
          <DateTimePicker value={startIso} onChange={setStartIso} tz={tz} ariaLabel="開始時間" />
        </div>

        <div>
          <span style={fieldLabelStyle}>
            結束時間
            {wasEnded
              ? "（已結束的記錄不可清空結束時間）"
              : "（留空＝繼續計時；填入＝事後補記結束）"}
          </span>
          <DateTimePicker value={endIso} onChange={setEndIso} tz={tz} ariaLabel="結束時間" />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "var(--spacing-2)",
            marginTop: "var(--spacing-2)",
          }}
        >
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void handleDelete()}
            disabled={busy}
            style={{
              fontSize: "var(--text-sm)",
              minHeight: 44,
              color: "var(--status-danger-fg, #c0392b)",
            }}
          >
            🗑 刪除
          </button>
          <div style={{ display: "flex", gap: "var(--spacing-2)" }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={busy}
              style={{ fontSize: "var(--text-sm)", minHeight: 44 }}
            >
              取消
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void handleSave()}
              disabled={busy}
              style={{ fontSize: "var(--text-sm)", minHeight: 44 }}
            >
              儲存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
