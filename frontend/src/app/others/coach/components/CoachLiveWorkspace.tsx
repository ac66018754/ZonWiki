"use client";

import { useCallback, useState, type ReactElement } from "react";
import Link from "next/link";
import { useCoachConnection, type MicMode } from "../lib/useCoachConnection";
import { SubtitleStream } from "./SubtitleStream";
import { StateIndicator } from "./StateIndicator";
import { MicControls } from "./MicControls";
import { CorrectionCard } from "./CorrectionCard";
import { VocabAddedToast } from "./VocabAddedToast";
import { InSessionGuard } from "./InSessionGuard";

/**
 * 把 fatal reason 轉成友善中文。
 * @param reason 後端/前端給的原因碼。
 * @returns 顯示文字。
 */
function friendlyFatalReason(reason: string | null): string {
  if (!reason) return "對話因故中止。";
  if (/budget|quota|limit/i.test(reason)) {
    return "教練額度已用完（每日/每月上限或全站預算），請稍後或明天再試。";
  }
  if (reason === "connection_lost") return "與伺服器的連線中斷且無法恢復，請重新開始。";
  return `對話已中止（${reason}）。`;
}

/**
 * 英文教練即時對話工作區（計畫 §6/§8）——本元件由 CoachClientEntry 以 dynamic(ssr:false) 載入，
 * 因此可安全使用 window/AudioContext（音訊層在此掛載）。
 */
export function CoachLiveWorkspace(): ReactElement {
  const conn = useCoachConnection();
  const [started, setStarted] = useState(false);
  const [mode, setMode] = useState<MicMode>("handsfree");

  const isActive =
    started &&
    (conn.state === "connecting" ||
      conn.state === "listening" ||
      conn.state === "thinking" ||
      conn.state === "speaking" ||
      conn.state === "reconnecting");
  const isTerminal = conn.state === "ended" || conn.state === "fatal";
  // 只有連線就緒（可送封包）時才允許麥克風/文字互動，避免未就緒時輸入被靜默丟棄（審修 H3）。
  const canInteract =
    conn.state === "listening" || conn.state === "thinking" || conn.state === "speaking";

  const handleStart = useCallback(async () => {
    setStarted(true);
    await conn.start(mode);
  }, [conn, mode]);

  const handleRestart = useCallback(async () => {
    setStarted(true);
    await conn.start(mode);
  }, [conn, mode]);

  // 免持模式：按鈕切換麥克風開/關；PTT：由 MicControls 的按住事件驅動。
  const handleToggleMic = useCallback(() => {
    if (conn.micActive) conn.stopMic();
    else void conn.startMic();
  }, [conn]);

  // 切到背景：暫停麥克風擷取（不送 end），避免背景持續錄音上傳（審修 H7）。
  const onHidden = useCallback(() => {
    conn.pauseMic();
  }, [conn]);
  // 回前景：恢復播放；免持模式且麥克風已停時自動重開。
  const onVisible = useCallback(() => {
    void conn.resume();
    if (mode === "handsfree" && !conn.micActive) void conn.startMic();
  }, [conn, mode]);

  // ── 開始前：起始畫面 ──
  if (!started) {
    return (
      <div className="coach-page">
        <StartScreen mode={mode} onModeChange={setMode} onStart={handleStart} />
      </div>
    );
  }

  return (
    <div className="coach-page">
      <InSessionGuard active={isActive} onHidden={onHidden} onVisible={onVisible} />

      {/* 頂列：標題＋狀態徽章＋結束鈕。 */}
      <header className="coach-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-2)" }}>
          <span aria-hidden style={{ fontSize: "var(--text-lg)" }}>
            🎙️
          </span>
          <h1 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: 700 }}>英文教練</h1>
          {conn.isMock && (
            <span className="coach-badge coach-badge--info" title="e2e 假造模式（無真麥克風/連線）">
              測試模式
            </span>
          )}
          {conn.state === "reconnecting" && (
            <span className="coach-badge coach-badge--warn">
              重新連線中（第 {conn.reconnectAttempt} 次）
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: "var(--spacing-2)" }}>
          {!isTerminal && (
            <button type="button" className="coach-btn coach-btn--danger" onClick={conn.stop}>
              結束對話
            </button>
          )}
          <Link href="/others" className="coach-btn coach-btn--secondary">
            返回
          </Link>
        </div>
      </header>

      {/* 一次性提示（入站被後端拒絕等；warning 語意）。 */}
      {conn.notice && !isTerminal && (
        <div className="coach-notice" role="status">
          <span aria-hidden>⚠️</span>
          <span className="coach-notice__text">{conn.notice}</span>
          <button
            type="button"
            className="coach-icon-btn coach-notice__close"
            onClick={conn.dismissNotice}
            aria-label="關閉提示"
          >
            ✕
          </button>
        </div>
      )}

      {/* 終態覆蓋。 */}
      {isTerminal ? (
        <TerminalPanel
          kind={conn.state === "fatal" ? "fatal" : "ended"}
          reason={friendlyFatalReason(conn.fatalReason)}
          onRestart={handleRestart}
        />
      ) : (
        <div className="coach-grid">
          {/* 左：對話 + 狀態 + 麥克風。 */}
          <div className="coach-main">
            <div className="coach-stateline">
              <StateIndicator state={conn.state} micVolume={conn.micVolume} />
            </div>
            <div className="coach-subtitle-area">
              <SubtitleStream turns={conn.turns} liveAssistantText={conn.liveAssistantText} />
            </div>
            <div className="coach-controls">
              <MicControls
                mode={mode}
                onModeChange={setMode}
                micActive={conn.micActive}
                onToggleMic={handleToggleMic}
                onPttStart={conn.startMic}
                onPttEnd={conn.stopMic}
                onSendText={conn.sendText}
                disabled={!canInteract}
              />
            </div>
          </div>

          {/* 右：糾錯卡。 */}
          <aside className="coach-side" aria-label="糾錯與單字">
            <h2 className="coach-side__title">糾錯</h2>
            {conn.corrections.length === 0 ? (
              <p className="coach-side__empty">教練發現需要修正的地方時，會在這裡顯示逐字對照。</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-3)" }}>
                {conn.corrections.map((correction, index) => (
                  <CorrectionCard key={index} correction={correction} />
                ))}
              </div>
            )}
          </aside>
        </div>
      )}

      {/* 單字提示（固定右下）。 */}
      <div className="coach-toast-anchor">
        <VocabAddedToast toasts={conn.vocabToasts} onDismiss={conn.dismissVocabToast} />
      </div>
    </div>
  );
}

/**
 * 開始前的起始畫面（選模式＋開始鈕；「開始對話」為建立 AudioContext 的使用者手勢）。
 */
function StartScreen({
  mode,
  onModeChange,
  onStart,
}: {
  mode: MicMode;
  onModeChange: (m: MicMode) => void;
  onStart: () => void;
}): ReactElement {
  return (
    <div className="coach-start">
      <div className="coach-start__card">
        <div aria-hidden style={{ fontSize: "56px", lineHeight: 1 }}>
          🎙️
        </div>
        <h1 style={{ margin: "var(--spacing-3) 0 0", fontSize: "var(--text-xl)", fontWeight: 700 }}>
          英文教練
        </h1>
        <p
          style={{
            margin: "var(--spacing-2) 0 var(--spacing-5)",
            color: "var(--text-secondary)",
            fontSize: "var(--text-sm)",
            lineHeight: 1.8,
          }}
        >
          與 AI 教練即時語音對話，會即時顯示雙向字幕，並在你說錯時給出逐字糾錯與更道地的講法。
        </p>

        <div className="coach-segment" role="radiogroup" aria-label="麥克風模式">
          <button
            type="button"
            role="radio"
            aria-checked={mode === "handsfree"}
            className={`coach-segment__item ${mode === "handsfree" ? "coach-segment__item--on" : ""}`}
            onClick={() => onModeChange("handsfree")}
          >
            免持（自動偵測說話）
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "ptt"}
            className={`coach-segment__item ${mode === "ptt" ? "coach-segment__item--on" : ""}`}
            onClick={() => onModeChange("ptt")}
          >
            按住說話
          </button>
        </div>

        <button
          type="button"
          className="coach-btn coach-btn--primary coach-btn--lg"
          onClick={onStart}
          style={{ marginTop: "var(--spacing-5)", width: "100%" }}
        >
          <span aria-hidden>▶</span> 開始對話
        </button>
        <p
          style={{
            margin: "var(--spacing-3) 0 0",
            color: "var(--text-tertiary)",
            fontSize: "var(--text-xs)",
          }}
        >
          開始後瀏覽器會要求麥克風權限；沒有麥克風也可用文字輸入。
        </p>
      </div>
    </div>
  );
}

/**
 * 終態面板（正常結束或 fatal）。
 * @param kind 終態種類。
 * @param reason 顯示原因（fatal 時）。
 * @param onRestart 重新開始。
 */
function TerminalPanel({
  kind,
  reason,
  onRestart,
}: {
  kind: "ended" | "fatal";
  reason: string;
  onRestart: () => void;
}): ReactElement {
  const isFatal = kind === "fatal";
  return (
    <div className="coach-terminal">
      <div className="coach-terminal__card">
        <div aria-hidden style={{ fontSize: "48px", lineHeight: 1 }}>
          {isFatal ? "⚠️" : "✅"}
        </div>
        <h2 style={{ margin: "var(--spacing-3) 0 var(--spacing-2)", fontSize: "var(--text-lg)" }}>
          {isFatal ? "對話已中止" : "對話已結束"}
        </h2>
        <p
          style={{
            margin: 0,
            color: "var(--text-secondary)",
            fontSize: "var(--text-sm)",
            lineHeight: 1.8,
          }}
        >
          {isFatal ? reason : "這次教練對話已結束，逐字稿與糾錯已保存。"}
        </p>
        <div
          style={{
            display: "flex",
            gap: "var(--spacing-2)",
            marginTop: "var(--spacing-5)",
            justifyContent: "center",
          }}
        >
          <button type="button" className="coach-btn coach-btn--primary" onClick={onRestart}>
            重新開始
          </button>
          <Link href="/others" className="coach-btn coach-btn--secondary">
            返回其他功能
          </Link>
        </div>
      </div>
    </div>
  );
}
