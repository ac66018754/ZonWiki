"use client";

import { useEffect, useRef, useState } from "react";
import type { CurrentUser } from "@/lib/api";
import { parseExpense } from "@/lib/api";
import { Textarea } from "@/components/Input";
import { Button } from "@/components/Button";
import { showToast } from "@/lib/toast";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import type {
  SpeechRecognitionEvent,
  SpeechRecognitionInstance,
  WindowWithSpeechRecognition,
} from "@/lib/speech";

/**
 * AI「一句話記帳」輸入區。
 *
 * 內含：文字輸入、AI 記帳按鈕（三態回應）、桌機麥克風鈕（Web Speech，實驗性、≤768px 隱藏）。
 * 冪等鍵與來源記錄的正確性見下方對應註解（審查 MEDIUM #1、§5.2 R7）。
 */
export interface AiCaptureBoxProps {
  /** 目前登入者（取時區）。 */
  user: CurrentUser | null;
  /** 成功入庫/暫存後通知父層重抓清單與統計。 */
  onChanged: () => void;
}

/**
 * AI 記帳輸入區元件。
 * @param props user 與 onChanged 回呼。
 */
export function AiCaptureBox({ user, onChanged }: AiCaptureBoxProps) {
  const [aiText, setAiText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // ── 冪等鍵（審查 MEDIUM #1）─────────────────────────────────────────────
  // clientRequestId 必須對「同一筆邏輯提交」穩定：在 ref 產生一次、跨重試沿用；
  // 只有在「輸入文字改變」「成功入庫」時才重新產生。嚴禁在按鈕 onClick 內每次 crypto.randomUUID()。
  // null＝下次提交需產新 id；非 null＝沿用（涵蓋「請求已送達但回應遺失、使用者再送一次」的離線去重情境）。
  const clientRequestIdRef = useRef<string | null>(null);

  // ── 來源記錄（設計書 §5.2 點名瑕疵、R7）───────────────────────────────
  // 必在「辨識結果事件當下」記 source="voice"、打字 onChange 當下記 source="text"；
  // 嚴禁用 isRecording 在送出時判 source（送出時辨識早已結束，會恆判為 text）。
  const sourceRef = useRef<string>("text");

  /** 產生/取用本次邏輯提交的穩定冪等鍵。 */
  const takeStableRequestId = (): string => {
    if (!clientRequestIdRef.current) {
      clientRequestIdRef.current = crypto.randomUUID();
    }
    return clientRequestIdRef.current;
  };

  /** 使用者打字：更新文字、記來源為 text、令冪等鍵失效（內容變＝新邏輯提交）。 */
  const handleTextChange = (value: string) => {
    setAiText(value);
    sourceRef.current = "text";
    clientRequestIdRef.current = null;
  };

  // 初始化 Web Speech（照 app/page.tsx 樣板；型別改用 @/lib/speech，不從 page.tsx import）。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const win = window as WindowWithSpeechRecognition;
    const SpeechRecognitionApi = win.webkitSpeechRecognition || win.SpeechRecognition;
    if (!SpeechRecognitionApi) return;

    const recognition = new SpeechRecognitionApi();
    recognition.lang = "zh-Hant-TW";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => setMicActive(true);
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      // 來源在「辨識結果當下」記為 voice；內容變＝新邏輯提交，冪等鍵失效。
      sourceRef.current = "voice";
      clientRequestIdRef.current = null;
      setAiText(transcript);
    };
    recognition.onerror = () => setMicActive(false);
    recognition.onend = () => setMicActive(false);
    recognitionRef.current = recognition;
    setMicSupported(true);
  }, []);

  /** 切換麥克風錄音（實驗性）。 */
  const handleToggleMic = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (micActive) {
      recognition.stop();
    } else {
      recognition.start();
    }
  };

  /** 送出 AI 記帳（三態回應處理）。 */
  const handleParse = async () => {
    const text = aiText.trim();
    if (!text || parsing) return;
    setParsing(true);
    try {
      const result = await parseExpense({
        text,
        source: sourceRef.current,
        clientRequestId: takeStableRequestId(),
        deviceNowIso: new Date().toISOString(),
        timeZone: user?.timeZone || DEFAULT_TIMEZONE,
      });

      // 連線層失敗（回 null）：保留文字與冪等鍵，讓使用者重試時後端可去重（同一邏輯提交）。
      if (!result) {
        showToast("記帳失敗，請稍後重試", { type: "error" });
        return;
      }

      // 三態由後端 stored／deferred／expense.needsConfirmation 推導（見 expense.ts 契約）。
      if (result.deferred) {
        // AI 不可用／逾時→降級存入快速捕捉（設計書 §5.3 保底語意）。
        showToast("AI 暫時不可用，已存入快速捕捉", { type: "info" });
      } else if (result.stored && result.expense?.needsConfirmation) {
        showToast("已記帳，請於待確認區核對", { type: "success" });
      } else {
        showToast("已記帳", { type: "success" });
      }

      // 定義性回應（三態皆已妥善處理）：清空輸入、令下次提交產新冪等鍵、來源重置、通知父層重抓。
      setAiText("");
      clientRequestIdRef.current = null;
      sourceRef.current = "text";
      onChanged();
    } finally {
      setParsing(false);
    }
  };

  return (
    <section
      aria-label="AI 記帳"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--spacing-4)",
      }}
    >
      <label
        htmlFor="ai-expense-text"
        style={{
          display: "block",
          fontSize: "var(--text-sm)",
          fontWeight: 600,
          color: "var(--text-primary)",
          marginBottom: "var(--spacing-2)",
        }}
      >
        一句話記帳
      </label>
      <Textarea
        id="ai-expense-text"
        value={aiText}
        onChange={(e) => handleTextChange(e.target.value)}
        placeholder="例如：剛剛花 300 塊在 7-11 買了一本書和茶葉蛋"
        style={{ minHeight: "80px" }}
        aria-label="一句話記帳輸入"
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--spacing-3)",
          marginTop: "var(--spacing-3)",
          flexWrap: "wrap",
        }}
      >
        <Button
          variant="primary"
          onClick={handleParse}
          isLoading={parsing}
          disabled={!aiText.trim()}
        >
          AI 記帳
        </Button>

        {/* 桌機麥克風鈕（實驗性）：btn-secondary + hide-below-768（≤768px 隱藏，符合 §5.5）；
            不可用 .hide-mobile（那是 ≤640px 斷點，Header 垃圾桶圖示在用，不可改）。
            不設 inline display，讓 .hide-below-768 的 display:none 能在 ≤768px 生效。 */}
        {micSupported && (
          <button
            type="button"
            className="btn-secondary hide-below-768"
            onClick={handleToggleMic}
            aria-pressed={micActive}
            title="以語音輸入（實驗性，僅桌機）"
          >
            <span aria-hidden>{micActive ? "🎙️ 聆聽中…" : "🎙️ 語音輸入"}</span>
            <span
              style={{
                marginLeft: "var(--spacing-2)",
                fontSize: "var(--text-xs)",
                color: "var(--text-tertiary)",
              }}
            >
              實驗性
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
