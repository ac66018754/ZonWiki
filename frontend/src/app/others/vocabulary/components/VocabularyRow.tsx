"use client";

import { useState } from "react";
import Link from "next/link";
import type { VocabularyWord } from "@/lib/api";
import { updateVocabulary, deleteVocabulary } from "@/lib/api";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { useConfirm } from "@/components/ConfirmProvider";
import { showToast } from "@/lib/toast";
import { SpeakButton } from "./SpeakButton";
import { formatDueRelative, stateLabel, stateBadgeColors } from "../vocabularyUtils";

/**
 * 單字清單單列：收合顯示單字/釋義/下次到期；點列展開詳情（例句、來源筆記連結），可就地編輯或軟刪除。
 */
export interface VocabularyRowProps {
  /** 單字卡。 */
  word: VocabularyWord;
  /** 異動後通知父層重抓（清單＋到期佇列）。 */
  onChanged: () => void;
}

/**
 * 狀態徽章（文字＋語意色，色非唯一載體）。
 */
function StateBadge({ state }: { state: string }) {
  const colors = stateBadgeColors(state);
  return (
    <span
      style={{
        flexShrink: 0,
        fontSize: "var(--text-xs)",
        fontWeight: 600,
        padding: "2px var(--spacing-2)",
        borderRadius: "var(--radius-full)",
        color: colors.fg,
        background: colors.bg,
      }}
    >
      {stateLabel(state)}
    </span>
  );
}

/**
 * 來源筆記連結。
 *
 * notes 路由為 slug 制（`/notes/[...slug]`），故僅在有 `sourceNoteSlug` 時做可點連結；
 * 只有 `sourceNoteId`（Guid）時以非連結文字降級——不用 id 硬組 `/notes/{id}`（slug 路由不保證吃 id）。
 * ⚠️對齊（審查 LOW）：若後端 VocabularyWordDto 補上 sourceNoteSlug/sourceNoteTitle，此處自動升級為連結。
 */
function SourceNoteLink({ word }: { word: VocabularyWord }) {
  if (!word.sourceNoteId) return null;
  const labelStyle: React.CSSProperties = {
    fontSize: "var(--text-xs)",
    color: "var(--text-secondary)",
  };
  if (word.sourceNoteSlug) {
    return (
      <div style={labelStyle}>
        來源：
        <Link
          href={`/notes/${encodeURIComponent(word.sourceNoteSlug)}`}
          style={{ color: "var(--action-secondary-fg)", textDecoration: "underline" }}
        >
          {word.sourceNoteTitle ?? "來源筆記"}
        </Link>
      </div>
    );
  }
  return <div style={labelStyle}>來自筆記</div>;
}

/**
 * 單字清單單列元件。
 * @param props word 與 onChanged。
 */
export function VocabularyRow({ word, onChanged }: VocabularyRowProps) {
  const confirm = useConfirm();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // 編輯欄位（不含 word 與 SRS 排程欄）。
  const [phonetic, setPhonetic] = useState(word.phonetic ?? "");
  const [partOfSpeech, setPartOfSpeech] = useState(word.partOfSpeech ?? "");
  const [definitionZh, setDefinitionZh] = useState(word.definitionZh ?? "");
  const [definitionEn, setDefinitionEn] = useState(word.definitionEn ?? "");
  const [exampleSentence, setExampleSentence] = useState(word.exampleSentence ?? "");

  /** 進入編輯：以目前值填入。 */
  const startEdit = () => {
    setPhonetic(word.phonetic ?? "");
    setPartOfSpeech(word.partOfSpeech ?? "");
    setDefinitionZh(word.definitionZh ?? "");
    setDefinitionEn(word.definitionEn ?? "");
    setExampleSentence(word.exampleSentence ?? "");
    setEditing(true);
    setExpanded(true);
  };

  /** 儲存編輯。 */
  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await updateVocabulary(word.id, {
        phonetic: phonetic.trim() || null,
        partOfSpeech: partOfSpeech.trim() || null,
        definitionZh: definitionZh.trim() || null,
        definitionEn: definitionEn.trim() || null,
        exampleSentence: exampleSentence.trim() || null,
      });
      if (!updated) {
        showToast("儲存失敗，請稍後重試", { type: "error" });
        return;
      }
      showToast("已更新", { type: "success" });
      setEditing(false);
      onChanged();
    } catch {
      // fetchJson 於 5xx 會 throw；補上回饋避免無聲失敗與 unhandled rejection。
      showToast("儲存失敗，請重試", { type: "error" });
    } finally {
      setSaving(false);
    }
  };

  /** 刪除（軟刪除，先確認）。 */
  const handleDelete = async () => {
    const ok = await confirm({
      message: `刪除單字「${word.word}」？會移至垃圾桶。`,
      danger: true,
    });
    if (!ok) return;
    try {
      const success = await deleteVocabulary(word.id);
      if (!success) {
        showToast("刪除失敗，請稍後重試", { type: "error" });
        return;
      }
      showToast("已刪除", { type: "success" });
      onChanged();
    } catch {
      // fetchJson 於 5xx 會 throw；補上回饋避免無聲失敗與 unhandled rejection。
      showToast("刪除失敗，請重試", { type: "error" });
    }
  };

  const shortDefinition = word.definitionZh || word.definitionEn || "";

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "var(--text-xs)",
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: "var(--spacing-1)",
  };

  // 編輯態：整列換成編輯表單。
  if (editing) {
    return (
      <div
        style={{
          border: "1px solid var(--border-strong)",
          background: "var(--bg-surface)",
          borderRadius: "var(--radius-md)",
          padding: "var(--spacing-3)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--spacing-2)",
        }}
      >
        <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>{word.word}</div>
        <div>
          <label style={labelStyle}>音標</label>
          <Input
            value={phonetic}
            onChange={(event) => setPhonetic(event.target.value)}
            placeholder="/rɪˈzɪljənt/"
            aria-label="音標"
          />
        </div>
        <div>
          <label style={labelStyle}>詞性</label>
          <Input
            value={partOfSpeech}
            onChange={(event) => setPartOfSpeech(event.target.value)}
            placeholder="adj."
            aria-label="詞性"
          />
        </div>
        <div>
          <label style={labelStyle}>中文釋義</label>
          <Input
            value={definitionZh}
            onChange={(event) => setDefinitionZh(event.target.value)}
            aria-label="中文釋義"
          />
        </div>
        <div>
          <label style={labelStyle}>英文釋義</label>
          <Input
            value={definitionEn}
            onChange={(event) => setDefinitionEn(event.target.value)}
            aria-label="英文釋義"
          />
        </div>
        <div>
          <label style={labelStyle}>例句</label>
          <Input
            value={exampleSentence}
            onChange={(event) => setExampleSentence(event.target.value)}
            aria-label="例句"
          />
        </div>
        <div style={{ display: "flex", gap: "var(--spacing-2)" }}>
          <Button variant="primary" size="sm" onClick={handleSave} isLoading={saving}>
            保存
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
            取消
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        border: "1px solid var(--border-default)",
        background: "var(--bg-surface)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
      }}
    >
      {/* 收合列（整列可點展開/收合） */}
      <div
        role="button"
        tabIndex={0}
        className="vocab-row-header"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setExpanded((value) => !value);
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--spacing-3)",
          padding: "var(--spacing-3)",
          cursor: "pointer",
          transition: "background 0.15s ease",
        }}
      >
        <SpeakButton word={word.word} size="sm" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--spacing-2)", flexWrap: "wrap" }}>
            <span style={{ fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-primary)" }}>
              {word.word}
            </span>
            {word.phonetic && (
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
                {word.phonetic}
              </span>
            )}
          </div>
          {shortDefinition && (
            <div
              style={{
                marginTop: "var(--spacing-1)",
                fontSize: "var(--text-sm)",
                color: "var(--text-secondary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {shortDefinition}
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "var(--spacing-1)",
            flexShrink: 0,
          }}
        >
          <StateBadge state={word.state} />
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>
            {formatDueRelative(word.due)}
          </span>
        </div>
      </div>

      {/* 展開詳情 */}
      {expanded && (
        <div
          style={{
            borderTop: "1px solid var(--border-default)",
            padding: "var(--spacing-3)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--spacing-2)",
            fontSize: "var(--text-sm)",
            color: "var(--text-primary)",
            lineHeight: 1.7,
          }}
        >
          {word.partOfSpeech && (
            <div style={{ color: "var(--text-secondary)" }}>詞性：{word.partOfSpeech}</div>
          )}
          {word.definitionZh && <div>{word.definitionZh}</div>}
          {word.definitionEn && (
            <div style={{ color: "var(--text-secondary)" }}>{word.definitionEn}</div>
          )}
          {word.exampleSentence && (
            <div
              style={{
                fontStyle: "italic",
                color: "var(--text-secondary)",
                borderLeft: "3px solid var(--border-strong)",
                paddingLeft: "var(--spacing-3)",
              }}
            >
              {word.exampleSentence}
            </div>
          )}
          <SourceNoteLink word={word} />
          <div style={{ display: "flex", gap: "var(--spacing-2)", marginTop: "var(--spacing-1)" }}>
            <Button variant="secondary" size="sm" onClick={startEdit} aria-label="編輯">
              編輯
            </Button>
            <Button variant="danger" size="sm" onClick={handleDelete} aria-label="刪除">
              刪除
            </Button>
          </div>
        </div>
      )}

      {/* 收合列四態：focus 走全域 :focus-visible；無 disabled 態；hover/active 用次級底色回饋
          （header 未設 inline background，故可由 class 覆寫）。 */}
      <style jsx>{`
        .vocab-row-header:hover {
          background: var(--bg-surface-secondary);
        }
        .vocab-row-header:active {
          background: var(--border-default);
        }
      `}</style>
    </div>
  );
}
