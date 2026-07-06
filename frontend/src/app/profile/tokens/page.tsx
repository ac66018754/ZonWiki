"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listApiTokens,
  createApiToken,
  revokeApiToken,
  type ApiTokenInfo,
  type CreatedApiToken,
} from "@/lib/api";
import { formatDateTime } from "@/lib/formatters";
import { getDeviceTimeZone } from "@/lib/timezone";
import { useConfirm } from "@/components/ConfirmProvider";
import {
  ProfileShell,
  cardStyle,
  sectionTitleStyle,
  labelStyle,
  inputStyle,
  primaryBtnStyle,
  dangerBtnStyle,
  hintTextStyle,
  errTextStyle,
} from "../profileShared";

/**
 * 個人頁 — API 權杖子頁 /profile/tokens
 *
 * 讓使用者產生 / 命名 / 撤銷「API 個人存取權杖（PAT）」，供外部 AI 助理
 * （Claude Code / Hermes / ChatGPT 的 Custom GPT Action）以 Bearer 權杖呼叫 ZonWiki API。
 * 安全：明碼權杖只在「產生當下」顯示一次；之後資料庫只存雜湊、無法還原。
 */
export default function ProfileTokensPage() {
  const confirm = useConfirm();
  const tz = getDeviceTimeZone();
  const [tokens, setTokens] = useState<ApiTokenInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 新增表單
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<string>(""); // "" = 永不過期；否則為天數字串
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  // 剛產生的明碼權杖（只顯示這一次）
  const [justCreated, setJustCreated] = useState<CreatedApiToken | null>(null);
  const [copied, setCopied] = useState(false);

  const reload = useCallback(async () => {
    const list = await listApiTokens();
    setTokens(list);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setTokens(await listApiTokens());
        setLoadError(null);
      } catch {
        setLoadError("無法載入權杖清單，請稍後重試。");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateErr(null);
    if (!name.trim()) {
      setCreateErr("請先為這把權杖取個名字（例如 Claude Code）");
      return;
    }
    setCreating(true);
    setJustCreated(null);
    setCopied(false);
    try {
      const expiresInDays = expiry ? Number(expiry) : null;
      const result = await createApiToken(name.trim(), expiresInDays);
      if ("error" in result) {
        setCreateErr(result.error);
      } else {
        setJustCreated(result);
        setName("");
        setExpiry("");
        await reload();
      }
    } catch {
      setCreateErr("產生權杖失敗，請稍後重試。");
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!justCreated) return;
    try {
      await navigator.clipboard.writeText(justCreated.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 某些瀏覽器/權限下複製失敗：請使用者手動選取。
      setCopied(false);
    }
  };

  const handleRevoke = async (id: string, tokenName: string) => {
    if (!(await confirm({
      message: `確定撤銷權杖「${tokenName}」？使用此權杖的 AI 將立即失去存取權，且無法復原。`,
      danger: true,
      confirmLabel: "撤銷",
    }))) {
      return;
    }
    const ok = await revokeApiToken(id);
    if (ok) await reload();
  };

  return (
    <ProfileShell title="API 權杖" loading={loading} error={loadError}>
      {/* 說明 */}
      <section style={cardStyle}>
        <h2 style={sectionTitleStyle}>什麼是 API 權杖？</h2>
        <p style={{ ...hintTextStyle, margin: "0 0 var(--spacing-2)", fontSize: "var(--text-sm)" }}>
          API 權杖（Personal Access Token）讓外部 AI 助理（Claude Code、Hermes、ChatGPT 的 Custom GPT
          Action…）以「你的身分」讀寫你的 ZonWiki 筆記與分類，而不必使用瀏覽器登入。
        </p>
        <p style={{ ...hintTextStyle, margin: 0, fontSize: "var(--text-sm)" }}>
          ⚠️ 權杖等同你帳號的鑰匙，請當成密碼保管：一個 AI 給一把、不要外流；外洩就到這裡撤銷那一把。
        </p>
      </section>

      {/* 新增權杖 */}
      <section style={cardStyle}>
        <h2 style={sectionTitleStyle}>產生新權杖</h2>
        <form onSubmit={handleCreate}>
          <div style={{ marginBottom: "var(--spacing-3)" }}>
            <label style={labelStyle}>名稱（辨識用途）</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：Claude Code、ChatGPT、Hermes"
              style={inputStyle}
              maxLength={128}
            />
          </div>
          <div style={{ marginBottom: "var(--spacing-4)" }}>
            <label style={labelStyle}>有效期限</label>
            <select
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              style={{ ...inputStyle, width: "auto", minWidth: "200px" }}
              aria-label="有效期限"
            >
              <option value="">永不過期</option>
              <option value="30">30 天</option>
              <option value="90">90 天</option>
              <option value="365">365 天</option>
            </select>
          </div>
          <button type="submit" style={primaryBtnStyle} disabled={creating}>
            {creating ? "產生中…" : "產生權杖"}
          </button>
          {createErr && <p style={errTextStyle}>{createErr}</p>}
        </form>

        {/* 剛產生的明碼權杖（只顯示一次） */}
        {justCreated && (
          <div
            style={{
              marginTop: "var(--spacing-4)",
              padding: "var(--spacing-4)",
              background: "var(--status-warning-bg, #fff7e6)",
              border: "1px solid var(--status-warning-fg, #d97706)",
              borderRadius: "var(--radius-md)",
            }}
            role="alert"
          >
            <p style={{ margin: "0 0 var(--spacing-2)", fontWeight: 700, color: "var(--text-primary)" }}>
              ✅ 權杖「{justCreated.info.name}」已產生——這串字只會出現這一次，請立刻複製保存！
            </p>
            <div style={{ display: "flex", gap: "var(--spacing-2)", flexWrap: "wrap", alignItems: "center" }}>
              <code
                style={{
                  flex: 1,
                  minWidth: "240px",
                  padding: "var(--spacing-2) var(--spacing-3)",
                  background: "var(--bg-default)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-md)",
                  fontFamily: "monospace",
                  fontSize: "var(--text-sm)",
                  color: "var(--text-primary)",
                  wordBreak: "break-all",
                }}
              >
                {justCreated.token}
              </code>
              <button style={primaryBtnStyle} onClick={handleCopy} type="button">
                {copied ? "已複製 ✓" : "複製"}
              </button>
            </div>
            <p style={{ ...hintTextStyle, marginTop: "var(--spacing-2)" }}>
              離開或重新整理此頁後就再也看不到完整權杖；屆時只能撤銷重產。
            </p>
          </div>
        )}
      </section>

      {/* 既有權杖清單 */}
      <section style={cardStyle}>
        <h2 style={sectionTitleStyle}>我的權杖（{tokens.length}）</h2>
        {tokens.length === 0 ? (
          <p style={{ color: "var(--text-secondary)", margin: 0 }}>尚未產生任何權杖。</p>
        ) : (
          <div style={{ display: "grid", gap: "var(--spacing-2)" }}>
            {tokens.map((t) => (
              <div
                key={t.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--spacing-3)",
                  padding: "var(--spacing-3)",
                  background: "var(--bg-default)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-md)",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: 1, minWidth: "180px" }}>
                  <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{t.name}</div>
                  <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", fontFamily: "monospace" }}>
                    {t.tokenPrefix}…
                  </div>
                </div>
                <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", minWidth: "150px" }}>
                  <div>建立：{formatDateTime(t.createdDateTime, tz)}</div>
                  <div>
                    最後使用：
                    {t.lastUsedDateTime ? formatDateTime(t.lastUsedDateTime, tz) : "尚未使用"}
                  </div>
                  <div>
                    到期：{t.expiresDateTime ? formatDateTime(t.expiresDateTime, tz) : "永不過期"}
                  </div>
                </div>
                <button
                  style={dangerBtnStyle}
                  onClick={() => handleRevoke(t.id, t.name)}
                  type="button"
                >
                  撤銷
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 怎麼接上各家 AI */}
      <section style={cardStyle}>
        <h2 style={sectionTitleStyle}>怎麼接上各家 AI</h2>
        <div style={{ display: "grid", gap: "var(--spacing-4)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
          <div>
            <strong style={{ color: "var(--text-primary)" }}>Claude Code / Claude Desktop（MCP，本機）</strong>
            <p style={{ margin: "var(--spacing-1) 0 0" }}>
              在 MCP 設定的環境變數設 <code>ZONWIKI_API_TOKEN</code> 為這把權杖、<code>ZONWIKI_API_BASE</code>
              指向你的 API 位址，即可使用 create_classified_note、list_categories 等工具。
            </p>
          </div>
          <div>
            <strong style={{ color: "var(--text-primary)" }}>ChatGPT（Custom GPT + Action）</strong>
            <p style={{ margin: "var(--spacing-1) 0 0" }}>
              建一個 Custom GPT → Configure → Actions → 匯入 <code>/openapi/zonwiki-ai.json</code>（你的 API
              網域下）→ Authentication 選「API Key／Bearer」貼上這把權杖。即可請它把整理好的內容寫成筆記並自動歸類。
            </p>
          </div>
          <div>
            <strong style={{ color: "var(--text-primary)" }}>Hermes / 自訂 agent</strong>
            <p style={{ margin: "var(--spacing-1) 0 0" }}>
              以遠端 MCP（同上環境變數）或直接呼叫 REST API，請求皆帶
              <code> Authorization: Bearer &lt;權杖&gt;</code> 標頭即可。
            </p>
          </div>
        </div>
      </section>
    </ProfileShell>
  );
}
