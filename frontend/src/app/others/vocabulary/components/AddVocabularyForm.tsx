"use client";

import { useState } from "react";
import { createVocabulary } from "@/lib/api";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { showToast } from "@/lib/toast";

/**
 * 手動新增單字表單（精簡版）。
 *
 * 欄位：單字（必填、trim）＋選填中文釋義／例句。其餘進階欄位（音標、詞性、英文釋義）
 * 交給列內編輯，避免表單過長。後端對重複字走「復活軟刪列 upsert」，新增既有字會回既有卡，
 * 前端只需照常 revalidate。
 */
export interface AddVocabularyFormProps {
  /** 建立成功後通知父層重抓清單與到期佇列。 */
  onCreated: () => void;
}

/**
 * 手動新增單字表單元件。
 * @param props onCreated 回呼。
 */
export function AddVocabularyForm({ onCreated }: AddVocabularyFormProps) {
  const [word, setWord] = useState("");
  const [definitionZh, setDefinitionZh] = useState("");
  const [exampleSentence, setExampleSentence] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const trimmedWord = word.trim();

  /** 重置表單。 */
  const resetForm = () => {
    setWord("");
    setDefinitionZh("");
    setExampleSentence("");
  };

  /** 送出新增。 */
  const handleSubmit = async () => {
    if (!trimmedWord || submitting) return;
    setSubmitting(true);
    try {
      const created = await createVocabulary({
        word: trimmedWord,
        definitionZh: definitionZh.trim() || null,
        exampleSentence: exampleSentence.trim() || null,
      });
      if (!created) {
        showToast("新增失敗，請稍後重試", { type: "error" });
        return;
      }
      showToast("已加入單字庫", { type: "success" });
      resetForm();
      onCreated();
    } catch {
      // fetchJson 於 5xx 會 throw；補上回饋避免無聲失敗與 unhandled rejection。
      showToast("新增失敗，請重試", { type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "var(--text-sm)",
    fontWeight: 600,
    color: "var(--text-primary)",
    marginBottom: "var(--spacing-1)",
  };

  return (
    <section
      aria-label="新增單字"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--spacing-4)",
      }}
    >
      <h2
        style={{
          margin: "0 0 var(--spacing-3)",
          fontSize: "var(--text-base)",
          fontWeight: 700,
          color: "var(--text-primary)",
        }}
      >
        新增單字
      </h2>
      <div style={{ display: "grid", gap: "var(--spacing-3)" }}>
        <div>
          <label htmlFor="vocab-word" style={labelStyle}>
            單字 <span style={{ color: "var(--status-danger-fg)" }}>*</span>
          </label>
          <Input
            id="vocab-word"
            value={word}
            onChange={(event) => setWord(event.target.value)}
            placeholder="resilient"
            aria-label="單字"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSubmit();
              }
            }}
          />
        </div>
        <div>
          <label htmlFor="vocab-definition-zh" style={labelStyle}>
            中文釋義
          </label>
          <Input
            id="vocab-definition-zh"
            value={definitionZh}
            onChange={(event) => setDefinitionZh(event.target.value)}
            placeholder="有韌性的、能快速恢復的"
            aria-label="中文釋義"
          />
        </div>
        <div>
          <label htmlFor="vocab-example" style={labelStyle}>
            例句
          </label>
          <Input
            id="vocab-example"
            value={exampleSentence}
            onChange={(event) => setExampleSentence(event.target.value)}
            placeholder="She is resilient under pressure."
            aria-label="例句"
          />
        </div>
        <div>
          <Button
            variant="primary"
            onClick={handleSubmit}
            isLoading={submitting}
            disabled={!trimmedWord}
          >
            加入單字庫
          </Button>
        </div>
      </div>
    </section>
  );
}
