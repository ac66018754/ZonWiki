"use client";

import { useState, type ReactElement } from "react";
import type { MicMode } from "../lib/useCoachConnection";

/**
 * 麥克風控制（計畫 §6）：hands-free（免持，預設）＋ push-to-talk（按住說話）雙模，
 * 另附無麥克風時的文字輸入後備。四態（hover/focus/active/disabled）樣式見 globals.css `.coach-btn`。
 *
 * @param mode 目前麥克風模式。
 * @param onModeChange 切換模式。
 * @param micActive 麥克風是否擷取中。
 * @param onToggleMic 免持模式下開/關麥克風。
 * @param onPttStart PTT 按下（開始擷取）。
 * @param onPttEnd PTT 放開（停止擷取並送 end）。
 * @param onSendText 送出文字回合。
 * @param disabled 是否停用（未連線/已結束/fatal）。
 */
export function MicControls({
  mode,
  onModeChange,
  micActive,
  onToggleMic,
  onPttStart,
  onPttEnd,
  onSendText,
  disabled,
}: {
  mode: MicMode;
  onModeChange: (mode: MicMode) => void;
  micActive: boolean;
  onToggleMic: () => void;
  onPttStart: () => void;
  onPttEnd: () => void;
  onSendText: (text: string) => void;
  disabled: boolean;
}): ReactElement {
  const [text, setText] = useState("");
  const [pressing, setPressing] = useState(false);

  const submitText = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSendText(trimmed);
    setText("");
  };

  const endPtt = () => {
    if (!pressing) return;
    setPressing(false);
    onPttEnd();
  };

  return (
    <div
      className="coach-mic"
      style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-3)" }}
    >
      {/* 模式切換。 */}
      <div className="coach-segment" role="tablist" aria-label="麥克風模式">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "handsfree"}
          className={`coach-segment__item ${mode === "handsfree" ? "coach-segment__item--on" : ""}`}
          onClick={() => onModeChange("handsfree")}
          disabled={disabled}
        >
          免持
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "ptt"}
          className={`coach-segment__item ${mode === "ptt" ? "coach-segment__item--on" : ""}`}
          onClick={() => onModeChange("ptt")}
          disabled={disabled}
        >
          按住說話
        </button>
      </div>

      {/* 主控鈕。 */}
      {mode === "handsfree" ? (
        <button
          type="button"
          className={`coach-btn ${micActive ? "coach-btn--danger" : "coach-btn--primary"}`}
          onClick={onToggleMic}
          disabled={disabled}
          aria-pressed={micActive}
        >
          <span aria-hidden>{micActive ? "🔴" : "🎙️"}</span>
          {micActive ? "麥克風開啟中（點擊靜音）" : "開啟麥克風"}
        </button>
      ) : (
        <button
          type="button"
          className={`coach-btn ${pressing ? "coach-btn--danger" : "coach-btn--primary"}`}
          disabled={disabled}
          aria-pressed={pressing}
          style={{ touchAction: "none", userSelect: "none" }}
          onPointerDown={(e) => {
            if (disabled) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            setPressing(true);
            onPttStart();
          }}
          onPointerUp={endPtt}
          onPointerCancel={endPtt}
          onPointerLeave={endPtt}
          onContextMenu={(e) => e.preventDefault()}
        >
          <span aria-hidden>{pressing ? "🔴" : "🎙️"}</span>
          {pressing ? "放開結束說話" : "按住說話"}
        </button>
      )}

      {/* 無麥克風後備：文字輸入。 */}
      <form
        className="coach-textform"
        onSubmit={(e) => {
          e.preventDefault();
          submitText();
        }}
        style={{ display: "flex", gap: "var(--spacing-2)" }}
      >
        <label className="coach-sr-only" htmlFor="coach-text-input">
          以文字向教練提問
        </label>
        <input
          id="coach-text-input"
          className="coach-input"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="沒有麥克風？直接打字…"
          disabled={disabled}
          autoComplete="off"
        />
        <button
          type="submit"
          className="coach-btn coach-btn--secondary"
          disabled={disabled || text.trim().length === 0}
        >
          送出
        </button>
      </form>
    </div>
  );
}
