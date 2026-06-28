"use client";

import { useEffect, useState } from "react";
import {
  updateMyProfile,
  changePassword,
  deleteMyAccount,
  getLogoutUrl,
  getUserSettings,
  updateUserSettings,
  updateTranscriptionSettings,
  type MyProfile,
  type MyStats,
  type MyActivityDay,
  type ActivityLogEntry,
} from "@/lib/api";
import { formatDateTime } from "@/lib/formatters";
import { getDeviceTimeZone, TIMEZONE_OPTIONS } from "@/lib/timezone";

// ============================================================================
// 個人頁共用：頁面外殼（標題 + 載入 / 錯誤狀態）
// ============================================================================

/**
 * 個人頁子頁共用外殼：統一頁面容器、標題、載入中與錯誤呈現。
 * @param title 頁面標題。
 * @param loading 是否載入中。
 * @param error 錯誤訊息（null＝無錯誤）。
 * @param children 子頁內容（載入完成且無錯誤時呈現）。
 */
export function ProfileShell({
  title,
  loading,
  error,
  children,
}: {
  title: string;
  loading: boolean;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <div style={pageStyle}>
      <h1 style={{ fontSize: "var(--text-2xl)", fontWeight: 700, margin: "0 0 var(--spacing-6) 0" }}>
        {title}
      </h1>
      {loading ? (
        <p style={{ color: "var(--text-secondary)" }}>載入中…</p>
      ) : error ? (
        <div style={errorBoxStyle} role="alert">
          {error}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

// ============================================================================
// 區塊：帳號資訊（帳號 / 暱稱 / 建立時間 / Google 綁定）
// ============================================================================

/**
 * 帳號資訊區塊：顯示帳號（唯讀）與可修改的暱稱，顯示帳號建立時間與 Google 綁定狀態。
 */
export function AccountInfoSection({
  profile,
  tz,
  onChanged,
}: {
  profile: MyProfile;
  /** 顯示時區（IANA）；用於格式化建立時間。 */
  tz: string;
  onChanged: () => Promise<void>;
}) {
  // 暱稱編輯
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);

  const handleSaveName = async () => {
    setNameMsg(null);
    if (!displayName.trim()) {
      setNameMsg("暱稱不可為空");
      return;
    }
    setSavingName(true);
    try {
      const ok = await updateMyProfile(displayName.trim());
      setNameMsg(ok ? "暱稱已更新（首頁將顯示新名稱）" : "暱稱更新失敗");
      if (ok) await onChanged();
    } catch {
      setNameMsg("暱稱更新失敗");
    } finally {
      setSavingName(false);
    }
  };

  return (
    <section style={cardStyle}>
      <h2 style={sectionTitleStyle}>帳號資訊</h2>

      {/* 帳號（登入識別字，唯讀） */}
      <div style={{ marginBottom: "var(--spacing-5)" }}>
        <label style={labelStyle}>帳號</label>
        <span style={{ color: "var(--text-primary)" }}>{profile.email}</span>
      </div>

      {/* 暱稱 */}
      <div style={{ marginBottom: "var(--spacing-5)" }}>
        <label style={labelStyle}>暱稱（首頁會顯示「你好，暱稱！」）</label>
        <div style={{ display: "flex", gap: "var(--spacing-2)" }}>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="你的名字"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button style={primaryBtnStyle} onClick={handleSaveName} disabled={savingName}>
            {savingName ? "儲存中…" : "儲存"}
          </button>
        </div>
        {nameMsg && <p style={hintTextStyle}>{nameMsg}</p>}
      </div>

      {/* 建立時間 + Google 綁定 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--spacing-6)" }}>
        <div>
          <label style={labelStyle}>帳號建立時間</label>
          <span style={{ color: "var(--text-primary)" }}>
            {formatDateTime(profile.createdDateTime, tz)}
          </span>
        </div>
        <div>
          <label style={labelStyle}>Google 綁定</label>
          <span style={{ color: "var(--text-primary)" }}>
            {profile.googleLinked ? "已綁定" : "未綁定"}
          </span>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// 區塊：修改密碼（新密碼需輸入兩次且一致）
// ============================================================================

/**
 * 修改密碼區塊：需輸入當前密碼、新密碼與確認新密碼（兩次須一致、至少 8 字元）。
 */
export function ChangePasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);

    if (!current.trim() || !next.trim()) {
      setErr("請填入當前密碼與新密碼");
      return;
    }
    if (next.length < 8) {
      setErr("新密碼至少需要 8 個字元");
      return;
    }
    if (next !== confirm) {
      setErr("兩次輸入的新密碼不一致");
      return;
    }

    setSaving(true);
    try {
      const result = await changePassword({ currentPassword: current, newPassword: next });
      if (result.ok) {
        setMsg("密碼已更新");
        setCurrent("");
        setNext("");
        setConfirm("");
      } else {
        // 後端會帶回明確訊息（如「目前密碼錯誤」）；沒有時退回通用提示。
        setErr(result.error ?? "修改密碼失敗，請確認當前密碼是否正確");
      }
    } catch {
      setErr("修改密碼失敗，請稍後再試");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section style={cardStyle}>
      <h2 style={sectionTitleStyle}>修改密碼</h2>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: "var(--spacing-3)" }}>
          <label style={labelStyle}>當前密碼</label>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            style={inputStyle}
          />
        </div>
        <div style={{ marginBottom: "var(--spacing-3)" }}>
          <label style={labelStyle}>新密碼（最少 8 個字元）</label>
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            style={inputStyle}
          />
        </div>
        <div style={{ marginBottom: "var(--spacing-4)" }}>
          <label style={labelStyle}>確認新密碼（再次輸入）</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            style={inputStyle}
          />
          {confirm.length > 0 && next !== confirm && (
            <p style={errTextStyle}>兩次密碼不一致</p>
          )}
        </div>
        <button type="submit" style={primaryBtnStyle} disabled={saving}>
          {saving ? "更新中…" : "更新密碼"}
        </button>
        {err && <p style={errTextStyle}>{err}</p>}
        {msg && <p style={hintTextStyle}>{msg}</p>}
      </form>
    </section>
  );
}

// ============================================================================
// 區塊：統計數據
// ============================================================================

/**
 * 統計數據區塊：以卡片網格顯示各類資料筆數。
 */
export function StatsSection({ stats }: { stats: MyStats | null }) {
  if (!stats) return null;
  const items: { label: string; value: number }[] = [
    { label: "筆記", value: stats.notes },
    { label: "任務 Todo", value: stats.tasks },
    { label: "畫布", value: stats.canvases },
    { label: "節點", value: stats.nodes },
    { label: "常用連結", value: stats.quickLinks },
    { label: "快速記錄", value: stats.captures },
    { label: "標籤", value: stats.tags },
    { label: "分類", value: stats.categories },
  ];
  return (
    <section style={cardStyle}>
      <h2 style={sectionTitleStyle}>統計數據</h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
          gap: "var(--spacing-3)",
        }}
      >
        {items.map((it) => (
          <div
            key={it.label}
            style={{
              padding: "var(--spacing-4)",
              background: "var(--bg-default)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-md)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "var(--text-2xl)", fontWeight: 700, color: "var(--text-primary)" }}>
              {it.value}
            </div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: "var(--spacing-1)" }}>
              {it.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ============================================================================
// 區塊：每日活動
// ============================================================================

/**
 * 每日活動區塊：近 30 天每天新增了哪些東西（依裝置時區歸日）。
 */
export function ActivitySection({ activity }: { activity: MyActivityDay[] }) {
  return (
    <section style={cardStyle}>
      <h2 style={sectionTitleStyle}>每日活動（近 30 天）</h2>
      {activity.length === 0 ? (
        <p style={{ color: "var(--text-secondary)", margin: 0 }}>近 30 天沒有活動紀錄。</p>
      ) : (
        <div style={{ display: "grid", gap: "var(--spacing-2)" }}>
          {activity.map((day) => (
            <div
              key={day.date}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--spacing-3)",
                padding: "var(--spacing-2) var(--spacing-3)",
                background: "var(--bg-default)",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-md)",
                fontSize: "var(--text-sm)",
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontWeight: 600, color: "var(--text-primary)", minWidth: "92px" }}>
                {day.date}
              </span>
              <span style={{ color: "var(--text-secondary)" }}>共 {day.total} 項</span>
              <span style={{ color: "var(--text-tertiary)" }}>
                {[
                  day.notes ? `📝 筆記 ${day.notes}` : null,
                  day.tasks ? `✅ 任務 ${day.tasks}` : null,
                  day.canvases ? `🗂️ 畫布 ${day.canvases}` : null,
                  day.nodes ? `🔵 節點 ${day.nodes}` : null,
                  day.captures ? `⚡ 記錄 ${day.captures}` : null,
                ]
                  .filter(Boolean)
                  .join("　")}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ============================================================================
// 區塊：活動明細（逐筆操作紀錄）
// ============================================================================

/** 動作型別 → 顯示標籤/圖示/顏色 */
const ACTION_META: Record<string, { label: string; icon: string; color: string }> = {
  created: { label: "新增", icon: "➕", color: "var(--status-success-fg, #16a34a)" },
  updated: { label: "編輯", icon: "✏️", color: "var(--action-secondary-fg)" },
  deleted: { label: "刪除", icon: "🗑️", color: "var(--status-danger-fg)" },
  restored: { label: "還原", icon: "↩️", color: "var(--status-warning-fg, #d97706)" },
};

/** 實體型別 → 中文標籤 */
const ENTITY_LABEL: Record<string, string> = {
  note: "筆記",
  taskcard: "任務",
  subtask: "子任務",
  node: "節點",
  aimodel: "API 金鑰",
  capture: "快速記錄",
  quicklink: "常用連結",
  prompt: "提示詞",
};

/**
 * 活動明細區塊：逐筆列出近 30 天「對哪個實體做了什麼」（新增/編輯/刪除/還原，標題級）。
 * 時間依裝置時區顯示。
 */
export function ActivityDetailSection({ log, tz }: { log: ActivityLogEntry[]; tz: string }) {
  const fmt = (iso: string) => formatDateTime(iso, tz);
  return (
    <section style={cardStyle}>
      <h2 style={sectionTitleStyle}>活動明細（近 30 天）</h2>
      {log.length === 0 ? (
        <p style={{ color: "var(--text-secondary)", margin: 0 }}>近 30 天沒有操作紀錄。</p>
      ) : (
        <div style={{ display: "grid", gap: "var(--spacing-1)", maxHeight: "480px", overflow: "auto" }}>
          {log.map((e) => {
            const a = ACTION_META[e.action] ?? {
              label: e.action,
              icon: "•",
              color: "var(--text-secondary)",
            };
            const typeLabel = ENTITY_LABEL[e.entityType] ?? e.entityType;
            return (
              <div
                key={e.id}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "var(--spacing-2)",
                  padding: "var(--spacing-2) var(--spacing-3)",
                  background: "var(--bg-default)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-md)",
                  fontSize: "var(--text-sm)",
                }}
              >
                <span style={{ flexShrink: 0, fontWeight: 600, color: a.color, minWidth: "56px" }}>
                  {a.icon} {a.label}
                </span>
                <span style={{ flexShrink: 0, color: "var(--text-tertiary)", minWidth: "56px" }}>
                  {typeLabel}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    color: "var(--text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={e.title}
                >
                  {e.title || "（無標題）"}
                </span>
                <span style={{ flexShrink: 0, color: "var(--text-tertiary)", fontSize: "var(--text-xs)" }}>
                  {fmt(e.at)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ============================================================================
// 區塊：危險操作（登出 / 刪除帳號）
// ============================================================================

/**
 * 危險操作區塊：登出與刪除帳號（刪除後立即登出並導回登入頁）。
 */
export function DangerZoneSection() {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleLogout = async () => {
    await fetch(getLogoutUrl(), { method: "POST", credentials: "include" }).catch(() => {});
    window.location.href = "/login";
  };

  const handleDelete = async () => {
    setErr(null);
    setDeleting(true);
    try {
      const ok = await deleteMyAccount();
      if (ok) {
        // 後端已 SignOut；前端整頁導回登入頁。
        window.location.href = "/login";
      } else {
        setErr("刪除帳號失敗，請稍後重試。");
      }
    } catch {
      setErr("刪除帳號失敗，請稍後重試。");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section style={{ ...cardStyle, borderColor: "var(--status-danger-fg, #c0392b)" }}>
      <h2 style={sectionTitleStyle}>帳號操作</h2>

      <div style={{ display: "flex", gap: "var(--spacing-3)", flexWrap: "wrap" }}>
        <button style={secondaryBtnStyle} onClick={handleLogout}>
          登出
        </button>

        {!confirming ? (
          <button style={dangerBtnStyle} onClick={() => setConfirming(true)}>
            刪除帳號
          </button>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-2)", flexWrap: "wrap" }}>
            <span style={{ color: "var(--status-danger-fg, #c0392b)", fontSize: "var(--text-sm)" }}>
              確定刪除帳號？此動作會立即登出。
            </span>
            <button style={dangerBtnStyle} onClick={handleDelete} disabled={deleting}>
              {deleting ? "刪除中…" : "確定刪除"}
            </button>
            <button style={secondaryBtnStyle} onClick={() => setConfirming(false)} disabled={deleting}>
              取消
            </button>
          </div>
        )}
      </div>
      {err && <p style={errTextStyle}>{err}</p>}
    </section>
  );
}

// ============================================================================
// 區塊：顯示時區（#7）
// ============================================================================

/**
 * 顯示時區設定區塊：選擇全站時間顯示所用的時區。
 * 預設＝裝置時區；可改成其它（例如 UTC+0）。資料一律存 UTC，僅顯示時換算。
 * 儲存後整頁重新載入，讓全站（標題列、各頁）即時改用新時區顯示。
 */
export function TimeZoneSection() {
  const deviceTz = getDeviceTimeZone();
  // 目前選定的時區；空字串代表「跟隨裝置」（實際儲存時寫入裝置 IANA 字串）。
  const [tz, setTz] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getUserSettings()
      .then((s) => {
        if (!alive) return;
        setTz(s?.timeZone ?? "");
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  // 目前實際生效的時區（空＝裝置時區）。
  const effectiveTz = tz || deviceTz;

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const ok = await updateUserSettings({ timeZone: tz });
      if (ok) {
        setMsg("已儲存，正在套用到全站…");
        // 重新載入，讓 SSR 外殼與各頁都以新時區重新取得 /api/me 並顯示。
        setTimeout(() => window.location.reload(), 500);
      } else {
        setMsg("儲存失敗，請稍後重試。");
        setSaving(false);
      }
    } catch {
      setMsg("儲存失敗，請稍後重試。");
      setSaving(false);
    }
  };

  return (
    <section style={cardStyle}>
      <h2 style={sectionTitleStyle}>顯示時區</h2>
      <p style={{ ...hintTextStyle, margin: "0 0 var(--spacing-3)" }}>
        所有時間都以 UTC 儲存，僅在顯示時換算成你選的時區。預設為裝置時區，可改成其它（例如 UTC+0）。
      </p>
      <div style={{ display: "flex", gap: "var(--spacing-2)", flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={tz}
          onChange={(e) => setTz(e.target.value)}
          disabled={!loaded || saving}
          style={{ ...inputStyle, width: "auto", minWidth: "260px" }}
          aria-label="顯示時區"
        >
          <option value="">跟隨裝置（{deviceTz}）</option>
          {TIMEZONE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button style={primaryBtnStyle} onClick={handleSave} disabled={!loaded || saving}>
          {saving ? "套用中…" : "儲存"}
        </button>
      </div>
      <p style={{ ...hintTextStyle }}>
        目前生效時區：<strong>{effectiveTz}</strong>
        ｜現在時間：{formatDateTime(new Date().toISOString(), effectiveTz)}
      </p>
      {msg && <p style={hintTextStyle}>{msg}</p>}
    </section>
  );
}

// ============================================================================
// 區塊：精煉成筆記（轉錄引擎設定）
// ============================================================================

/**
 * 「精煉成筆記」設定區塊：選轉錄引擎（Gemini 預設 / Groq），Groq 需自填免費金鑰。
 * 用於把影片/播客/文章連結自動整理成分類筆記時，沒有字幕的音訊要靠轉錄。
 */
export function RefineSettingsSection() {
  const [engine, setEngine] = useState<"gemini" | "groq">("gemini");
  const [groqKeySet, setGroqKeySet] = useState(false);
  const [groqKey, setGroqKey] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getUserSettings()
      .then((s) => {
        if (!alive || !s) return;
        setEngine((s.transcriptionEngine as "gemini" | "groq") ?? "gemini");
        setGroqKeySet(Boolean(s.groqKeySet));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const payload: { transcriptionEngine?: "gemini" | "groq"; groqApiKey?: string } = {
        transcriptionEngine: engine,
      };
      // 只有使用者實際輸入了新金鑰才送出（空字串＝不動；要清除請按「清除金鑰」）。
      if (groqKey.trim().length > 0) payload.groqApiKey = groqKey.trim();
      const result = await updateTranscriptionSettings(payload);
      if (result) {
        setGroqKeySet(Boolean(result.groqKeySet));
        setGroqKey("");
        setMsg("已儲存");
      } else {
        setMsg("儲存失敗，請稍後重試。");
      }
    } catch {
      setMsg("儲存失敗，請稍後重試。");
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const result = await updateTranscriptionSettings({ groqApiKey: "" });
      if (result) {
        setGroqKeySet(false);
        setGroqKey("");
        setMsg("已清除 Groq 金鑰");
      }
    } catch {
      setMsg("清除失敗，請稍後重試。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section style={cardStyle}>
      <h2 style={sectionTitleStyle}>精煉成筆記（轉錄引擎）</h2>
      <p style={{ ...hintTextStyle, margin: "0 0 var(--spacing-3)", fontSize: "var(--text-sm)" }}>
        「精煉成筆記」可以把一個影片/播客/文章連結，自動抓字幕或把音訊轉成文字，再用 AI 整理成分類筆記。
        有字幕的內容（多數 YouTube）用預設 Gemini 即可；<strong>沒字幕的音訊（多數 Podcast、IG）需要轉錄</strong>，
        這時請選 Groq。
      </p>

      <div style={{ marginBottom: "var(--spacing-4)" }}>
        <label style={labelStyle}>轉錄引擎</label>
        <select
          value={engine}
          onChange={(e) => setEngine(e.target.value as "gemini" | "groq")}
          disabled={!loaded || saving}
          style={{ ...inputStyle, width: "auto", minWidth: "260px" }}
          aria-label="轉錄引擎"
        >
          <option value="gemini">Gemini（預設）— 有字幕的內容免設定</option>
          <option value="groq">Groq Whisper — 音訊轉錄（需自填免費金鑰）</option>
        </select>
      </div>

      {engine === "groq" && (
        <div
          style={{
            marginBottom: "var(--spacing-4)",
            padding: "var(--spacing-4)",
            background: "var(--bg-default)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <p style={{ ...hintTextStyle, margin: "0 0 var(--spacing-2)", fontSize: "var(--text-sm)" }}>
            <strong>Groq 是什麼？</strong> Groq 是一個超快的 AI 推論服務，提供 OpenAI 的 Whisper
            語音轉文字。它有<strong>免費方案</strong>：每天約 2,000 次轉錄、每小時約 2 小時音訊量，個人用綽綽有餘。
          </p>
          <p style={{ ...hintTextStyle, margin: "0 0 var(--spacing-3)", fontSize: "var(--text-sm)" }}>
            到 <code>console.groq.com</code> 免費註冊 → 建立 API Key（zwk 之外，Groq 的金鑰以 <code>gsk_</code> 開頭）→ 貼到下面。
            金鑰會<strong>加密</strong>儲存，絕不外洩。
          </p>
          <label style={labelStyle}>
            Groq API 金鑰{groqKeySet ? "（已設定；要更換才需重填）" : ""}
          </label>
          <div style={{ display: "flex", gap: "var(--spacing-2)", flexWrap: "wrap" }}>
            <input
              type="password"
              value={groqKey}
              onChange={(e) => setGroqKey(e.target.value)}
              placeholder={groqKeySet ? "•••••••••（已設定）" : "gsk_..."}
              autoComplete="off"
              style={{ ...inputStyle, flex: 1, minWidth: "220px" }}
            />
            {groqKeySet && (
              <button style={secondaryBtnStyle} onClick={handleClearKey} disabled={saving} type="button">
                清除金鑰
              </button>
            )}
          </div>
        </div>
      )}

      <button style={primaryBtnStyle} onClick={handleSave} disabled={!loaded || saving}>
        {saving ? "儲存中…" : "儲存"}
      </button>
      {msg && <p style={hintTextStyle}>{msg}</p>}
    </section>
  );
}

// ============================================================================
// 共用樣式（與全站 CSS 變數一致）
// ============================================================================

export const pageStyle: React.CSSProperties = {
  maxWidth: "720px",
  margin: "0 auto",
  padding: "var(--spacing-6)",
};

export const cardStyle: React.CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-lg)",
  padding: "var(--spacing-6)",
  marginBottom: "var(--spacing-5)",
};

export const sectionTitleStyle: React.CSSProperties = {
  fontSize: "var(--text-lg)",
  fontWeight: 600,
  margin: "0 0 var(--spacing-4) 0",
  color: "var(--text-primary)",
};

export const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: "var(--spacing-2)",
  fontSize: "var(--text-sm)",
  fontWeight: 500,
  color: "var(--text-secondary)",
};

export const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "var(--spacing-2) var(--spacing-3)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-default)",
  color: "var(--text-primary)",
  fontSize: "var(--text-sm)",
  boxSizing: "border-box",
};

export const primaryBtnStyle: React.CSSProperties = {
  padding: "var(--spacing-2) var(--spacing-4)",
  background: "var(--action-primary-bg)",
  color: "var(--action-primary-fg)",
  border: "none",
  borderRadius: "var(--radius-md)",
  fontWeight: 600,
  fontSize: "var(--text-sm)",
  cursor: "pointer",
};

export const secondaryBtnStyle: React.CSSProperties = {
  padding: "var(--spacing-2) var(--spacing-4)",
  background: "var(--bg-default)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-md)",
  fontWeight: 500,
  fontSize: "var(--text-sm)",
  cursor: "pointer",
};

export const dangerBtnStyle: React.CSSProperties = {
  padding: "var(--spacing-2) var(--spacing-4)",
  background: "var(--status-danger-bg, #fdecea)",
  color: "var(--status-danger-fg, #c0392b)",
  border: "1px solid var(--status-danger-fg, #c0392b)",
  borderRadius: "var(--radius-md)",
  fontWeight: 600,
  fontSize: "var(--text-sm)",
  cursor: "pointer",
};

export const hintTextStyle: React.CSSProperties = {
  margin: "var(--spacing-2) 0 0 0",
  fontSize: "var(--text-xs)",
  color: "var(--text-secondary)",
};

export const errTextStyle: React.CSSProperties = {
  margin: "var(--spacing-2) 0 0 0",
  fontSize: "var(--text-xs)",
  color: "var(--status-error-fg, #c0392b)",
};

export const errorBoxStyle: React.CSSProperties = {
  padding: "var(--spacing-4)",
  background: "var(--status-error-bg, #fdecea)",
  color: "var(--status-error-fg, #c0392b)",
  borderRadius: "var(--radius-md)",
  fontSize: "var(--text-sm)",
};
