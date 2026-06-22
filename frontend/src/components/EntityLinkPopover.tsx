"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  listLinks,
  deleteLink,
  createLink,
  searchLinkCandidates,
  createNoteFromEntity,
  createCanvasFromEntity,
  type LinkEntityType,
  type LinkedEntity,
  type LinkCandidate,
} from "@/lib/api";

const icon = (t: string) =>
  t === "note" ? "📝" : t === "node" ? "🎨" : t === "subtask" ? "☑️" : "🎯";

/**
 * 暫時性浮動視窗：把某個實體（任務 / 子任務 / 筆記 / 開問啦節點）關聯到其他實體。
 * - 搜尋既有：輸入關鍵字找既有的筆記 / 任務 / 節點，點一下即建立關聯。
 * - 建立新項（僅任務/子任務來源）：一鍵建立並關聯「新筆記（帶入標題）」或「開問啦畫布＋節點」。
 * - 下半：列出此實體已關聯的項目，可點擊前往、可解除關聯。
 * - 點視窗以外任何地方即關閉（無 X 關閉鈕）。
 */
export function EntityLinkPopover({
  sourceType,
  sourceId,
  sourceTitle,
  rect,
  onClose,
  onChanged,
}: {
  sourceType: LinkEntityType;
  sourceId: string;
  sourceTitle: string;
  /** 觸發按鈕的位置（用於定位浮動視窗） */
  rect: { top: number; bottom: number; left: number; right: number };
  onClose: () => void;
  /** 關聯有變動時通知外層（例如讓反向連結列重新載入） */
  onChanged?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [links, setLinks] = useState<LinkedEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"note" | "canvas" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // 搜尋既有
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<LinkCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  // 搜尋序號：避免較慢回來的舊查詢覆蓋較新的結果（race）
  const searchSeqRef = useRef(0);

  // 只有任務/子任務來源提供「建立新筆記/畫布」；筆記/節點來源以搜尋既有為主。
  const canCreate = sourceType === "taskcard" || sourceType === "subtask";

  const reloadLinks = useCallback(async () => {
    setLinks(await listLinks(sourceType, sourceId));
    setLoading(false);
  }, [sourceType, sourceId]);

  const runSearch = useCallback(
    async (q: string) => {
      const seq = ++searchSeqRef.current;
      setSearching(true);
      try {
        const res = await searchLinkCandidates(sourceType, sourceId, q);
        // 只有「最新一次搜尋」的結果可套用，避免舊查詢慢回蓋掉新結果
        if (seq === searchSeqRef.current) setCandidates(res);
      } finally {
        if (seq === searchSeqRef.current) setSearching(false);
      }
    },
    [sourceType, sourceId]
  );

  // 動作後刷新候選的「已關聯」標記：僅在有搜尋關鍵字時才重搜（否則沒列出候選，無須刷新）。
  const refreshCandidates = useCallback(async () => {
    const q = query.trim();
    if (q) await runSearch(q);
    else setCandidates([]);
  }, [query, runSearch]);

  useEffect(() => {
    reloadLinks();
  }, [reloadLinks]);

  // 輸入關鍵字才搜尋（不預先列出候選，避免一打開就一長串眼花撩亂）。
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setCandidates([]);
      setSearching(false);
      return;
    }
    const id = setTimeout(() => runSearch(q), 250);
    return () => clearTimeout(id);
  }, [query, runSearch]);

  // 點視窗以外即關閉。
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  /** 關聯一筆既有實體。 */
  const handleAddExisting = async (c: LinkCandidate) => {
    if (c.alreadyLinked) return;
    const key = `${c.type}:${c.id}`;
    setAddingKey(key);
    try {
      const linkId = await createLink(sourceType, sourceId, c.type, c.id);
      if (linkId) {
        await Promise.all([reloadLinks(), refreshCandidates()]);
        onChanged?.();
      } else {
        setMsg("建立關聯失敗");
      }
    } finally {
      setAddingKey(null);
    }
  };

  const handleCreateNote = async () => {
    setBusy("note");
    setMsg(null);
    try {
      const res = await createNoteFromEntity(sourceType, sourceId, sourceTitle);
      if (res) {
        setMsg("已建立並關聯新筆記");
        await Promise.all([reloadLinks(), refreshCandidates()]);
        onChanged?.();
      } else {
        setMsg("建立筆記失敗");
      }
    } finally {
      setBusy(null);
    }
  };

  const handleCreateCanvas = async () => {
    setBusy("canvas");
    setMsg(null);
    try {
      const res = await createCanvasFromEntity(sourceType, sourceId, sourceTitle);
      if (res) {
        setMsg("已建立並關聯開問啦節點");
        await Promise.all([reloadLinks(), refreshCandidates()]);
        onChanged?.();
      } else {
        setMsg("建立畫布失敗");
      }
    } finally {
      setBusy(null);
    }
  };

  const handleUnlink = async (linkId: string) => {
    const snapshot = links;
    setLinks((prev) => prev.filter((l) => l.linkId !== linkId)); // 樂觀移除
    const ok = await deleteLink(linkId);
    if (!ok) {
      setLinks(snapshot); // 失敗回滾
      setMsg("解除關聯失敗");
      return;
    }
    await refreshCandidates(); // 解除後候選的 alreadyLinked 要更新
    onChanged?.();
  };

  // 定位：觸發點下方；靠右時往左收，避免超出視窗。
  const width = 320;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const top = Math.min(rect.bottom + 6, window.innerHeight - 360);

  return (
    <div
      ref={ref}
      role="dialog"
      style={{
        position: "fixed",
        top,
        left,
        width,
        maxHeight: "70vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-lg)",
        zIndex: 4000,
        overflow: "hidden",
      }}
    >
      {/* 標題 */}
      <div style={{ padding: "var(--spacing-3)", borderBottom: "1px solid var(--border-default)" }}>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>關聯此項到…</div>
        <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-primary)", wordBreak: "break-word" }}>
          {icon(sourceType)} {sourceTitle || "（未命名）"}
        </div>
      </div>

      <div style={{ overflow: "auto", display: "flex", flexDirection: "column" }}>
        {/* 已關聯清單（置頂，確保看得到；點項目即前往該筆記/節點/任務） */}
        <div style={{ padding: "var(--spacing-3)", borderBottom: "1px solid var(--border-default)" }}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginBottom: "var(--spacing-2)" }}>
            已關聯（{links.length}）{links.length > 0 ? " · 點項目可前往" : ""}
          </div>
          {loading ? (
            <div style={hintStyle}>載入中…</div>
          ) : links.length === 0 ? (
            <div style={hintStyle}>尚無關聯。</div>
          ) : (
            <ul style={listStyle}>
              {links.map((l) => (
                <li
                  key={l.linkId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--spacing-2)",
                    padding: "var(--spacing-2)",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--bg-default)",
                    border: "1px solid var(--border-default)",
                  }}
                >
                  <button
                    onClick={() => { window.location.href = l.url; }}
                    title={`前往：${l.title}`}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: "left",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--text-primary)",
                      fontSize: "var(--text-xs)",
                    }}
                  >
                    <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {icon(l.type)} {l.title} <span style={{ color: "var(--action-primary-bg)" }}>↗</span>
                    </div>
                    {l.subText && <div style={{ color: "var(--text-tertiary)" }}>{l.subText}</div>}
                  </button>
                  <button
                    onClick={() => handleUnlink(l.linkId)}
                    title="解除關聯"
                    aria-label="解除關聯"
                    style={{ border: "none", background: "transparent", color: "var(--text-tertiary)", cursor: "pointer", fontSize: "var(--text-xs)" }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 搜尋既有來關聯（不預先列出，輸入才搜尋） */}
        <div style={{ padding: "var(--spacing-3)", borderBottom: canCreate ? "1px solid var(--border-default)" : "none" }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋既有筆記 / 任務 / 節點來關聯…"
            autoFocus
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "var(--spacing-2) var(--spacing-3)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-md)",
              background: "var(--bg-default)",
              color: "var(--text-primary)",
              fontSize: "var(--text-sm)",
              marginBottom: "var(--spacing-2)",
            }}
          />
          {!query.trim() ? (
            <div style={hintStyle}>輸入關鍵字以搜尋既有項目來關聯。</div>
          ) : searching ? (
            <div style={hintStyle}>搜尋中…</div>
          ) : candidates.length === 0 ? (
            <div style={hintStyle}>找不到符合「{query.trim()}」的項目。</div>
          ) : (
            <ul style={listStyle}>
              {candidates.map((c) => {
                const key = `${c.type}:${c.id}`;
                return (
                  <li key={key}>
                    <button
                      onClick={() => handleAddExisting(c)}
                      disabled={c.alreadyLinked || addingKey === key}
                      title={c.alreadyLinked ? "已關聯" : "點擊建立關聯"}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--spacing-2)",
                        textAlign: "left",
                        padding: "var(--spacing-2)",
                        borderRadius: "var(--radius-sm)",
                        background: "var(--bg-default)",
                        border: "1px solid var(--border-default)",
                        cursor: c.alreadyLinked ? "default" : "pointer",
                        opacity: c.alreadyLinked ? 0.55 : 1,
                        color: "var(--text-primary)",
                        fontSize: "var(--text-xs)",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {icon(c.type)} {c.title}
                        </div>
                        {c.subText && <div style={{ color: "var(--text-tertiary)" }}>{c.subText}</div>}
                      </div>
                      <span style={{ flexShrink: 0, color: c.alreadyLinked ? "var(--text-tertiary)" : "var(--action-primary-bg)", fontWeight: 600 }}>
                        {addingKey === key ? "…" : c.alreadyLinked ? "已關聯" : "＋"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 建立新項（僅任務/子任務來源） */}
        {canCreate && (
          <div style={{ padding: "var(--spacing-3)", display: "flex", flexDirection: "column", gap: "var(--spacing-2)" }}>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)" }}>或建立新項並關聯</div>
            <button onClick={handleCreateNote} disabled={busy !== null} style={createBtn}>
              📝 {busy === "note" ? "建立中…" : "建立新筆記（帶入標題）"}
            </button>
            <button onClick={handleCreateCanvas} disabled={busy !== null} style={createBtn}>
              🎨 {busy === "canvas" ? "建立中…" : "建立開問啦畫布＋節點"}
            </button>
          </div>
        )}

        {msg && <div style={{ padding: "0 var(--spacing-3) var(--spacing-3)", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{msg}</div>}
      </div>
    </div>
  );
}

const hintStyle: React.CSSProperties = { fontSize: "var(--text-xs)", color: "var(--text-tertiary)" };
const listStyle: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--spacing-1)",
};
const createBtn: React.CSSProperties = {
  width: "100%",
  textAlign: "left",
  padding: "var(--spacing-2) var(--spacing-3)",
  background: "var(--bg-default)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-md)",
  fontSize: "var(--text-sm)",
  cursor: "pointer",
};
