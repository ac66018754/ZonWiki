"use client";

import { useState } from "react";
import { login, register } from "@/lib/api";

/**
 * 登入 / 註冊表單（純前端互動元件）
 *
 * 雙標籤設計：
 * - 登入標籤：帳號 + 密碼
 * - 註冊標籤：帳號 + 顯示名稱 + 密碼 + 確認密碼
 *
 * 注意：是否「已登入」的判斷與重導，由其上層的 server component（login/page.tsx）負責，
 * 確保已登入者在 SSR 階段就被導回首頁，不會看到登入表單（更不會看到登入後的外殼）。
 */
export function LoginForm() {
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 密碼是否以明文顯示（登入與註冊欄共用；點眼睛按鈕切換）
  const [showPassword, setShowPassword] = useState(false);

  // 登入狀態
  const [loginAccount, setLoginAccount] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // 註冊狀態
  const [registerAccount, setRegisterAccount] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  // 確認密碼（必須與密碼一致）
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState("");
  const [registerDisplayName, setRegisterDisplayName] = useState("");

  /**
   * 處理登入提交
   */
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!loginAccount.trim() || !loginPassword.trim()) {
        setError("請輸入帳號和密碼");
        return;
      }

      const result = await login({
        account: loginAccount,
        password: loginPassword,
      });

      if (result) {
        // 登入成功，用整頁導向（而非 router.push）重導到首頁：
        // 才能重新執行 server layout、讓它讀到新 cookie 判定為已登入，
        // 否則 client 端導向時 layout 的 user 仍為 null，會被 AuthGuard 彈回登入頁。
        window.location.href = "/";
      } else {
        setError("登入失敗，請檢查帳號和密碼");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "發生錯誤，請重試");
    } finally {
      setLoading(false);
    }
  };

  /**
   * 處理註冊提交
   */
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!registerAccount.trim() || !registerPassword.trim() || !registerDisplayName.trim()) {
        setError("請填入所有欄位");
        return;
      }

      if (registerPassword.length < 8) {
        setError("密碼至少需要 8 個字元");
        return;
      }

      // 兩次密碼必須一致
      if (registerPassword !== registerPasswordConfirm) {
        setError("兩次輸入的密碼不一致");
        return;
      }

      const result = await register({
        account: registerAccount,
        password: registerPassword,
        displayName: registerDisplayName,
      });

      if (result) {
        // 註冊成功，用整頁導向（而非 router.push）重導到首頁，理由同登入。
        window.location.href = "/";
      } else {
        setError("註冊失敗，此帳號可能已被使用");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "發生錯誤，請重試");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      minHeight: "100vh",
      background: "var(--bg-default)",
      padding: "var(--spacing-4)",
    }}>
      <div style={{
        width: "100%",
        maxWidth: "400px",
        background: "var(--bg-surface)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-lg)",
        overflow: "hidden",
      }}>
        {/* 標題 */}
        <div style={{
          padding: "var(--spacing-6)",
          textAlign: "center",
          borderBottom: "1px solid var(--border-default)",
        }}>
          <h1 style={{
            fontSize: "var(--text-2xl)",
            fontWeight: 700,
            margin: "0 0 var(--spacing-2) 0",
            color: "var(--text-primary)",
          }}>
            ZonWiki
          </h1>
          <p style={{
            fontSize: "var(--text-sm)",
            color: "var(--text-secondary)",
            margin: 0,
          }}>
            個人知識與任務管理系統
          </p>
        </div>

        {/* 標籤選項 */}
        <div style={{
          display: "flex",
          borderBottom: "1px solid var(--border-default)",
        }}>
          <button
            onClick={() => {
              setActiveTab("login");
              setError(null);
            }}
            style={{
              flex: 1,
              padding: "var(--spacing-3)",
              border: "none",
              background: activeTab === "login"
                ? "var(--bg-surface)"
                : "var(--bg-default)",
              borderBottom: activeTab === "login"
                ? "2px solid var(--action-primary-bg)"
                : "none",
              color: activeTab === "login"
                ? "var(--action-primary-bg)"
                : "var(--text-secondary)",
              cursor: "pointer",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              transition: "all 0.2s ease",
            }}
          >
            登入
          </button>
          <button
            onClick={() => {
              setActiveTab("register");
              setError(null);
            }}
            style={{
              flex: 1,
              padding: "var(--spacing-3)",
              border: "none",
              background: activeTab === "register"
                ? "var(--bg-surface)"
                : "var(--bg-default)",
              borderBottom: activeTab === "register"
                ? "2px solid var(--action-primary-bg)"
                : "none",
              color: activeTab === "register"
                ? "var(--action-primary-bg)"
                : "var(--text-secondary)",
              cursor: "pointer",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              transition: "all 0.2s ease",
            }}
          >
            註冊
          </button>
        </div>

        {/* 內容 */}
        <div style={{ padding: "var(--spacing-6)" }}>
          {error && (
            <div
              role="alert"
              className="login-error-alert"
              style={{
                marginBottom: "var(--spacing-4)",
                padding: "var(--spacing-3) var(--spacing-4)",
                background: "var(--status-error-bg)",
                color: "var(--status-error-fg)",
                border: "2px solid var(--status-error-fg)",
                borderRadius: "var(--radius-md)",
                fontSize: "var(--text-sm)",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: "var(--spacing-2)",
              }}
            >
              <span aria-hidden style={{ fontSize: "var(--text-base)" }}>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {activeTab === "login" && (
            <form onSubmit={handleLoginSubmit}>
              <div style={{ marginBottom: "var(--spacing-4)" }}>
                <label style={{
                  display: "block",
                  marginBottom: "var(--spacing-2)",
                  fontSize: "var(--text-sm)",
                  fontWeight: 500,
                  color: "var(--text-primary)",
                }}>
                  帳號
                </label>
                <input
                  type="text"
                  value={loginAccount}
                  onChange={(e) => setLoginAccount(e.target.value)}
                  placeholder="帳號"
                  autoComplete="username"
                  disabled={loading}
                  style={{
                    width: "100%",
                    padding: "var(--spacing-2) var(--spacing-3)",
                    border: "1px solid var(--border-default)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--bg-default)",
                    color: "var(--text-primary)",
                    fontSize: "var(--text-sm)",
                    boxSizing: "border-box",
                    opacity: loading ? 0.5 : 1,
                  }}
                />
              </div>

              <div style={{ marginBottom: "var(--spacing-6)" }}>
                <label style={{
                  display: "block",
                  marginBottom: "var(--spacing-2)",
                  fontSize: "var(--text-sm)",
                  fontWeight: 500,
                  color: "var(--text-primary)",
                }}>
                  密碼
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    disabled={loading}
                    style={{
                      width: "100%",
                      padding: "var(--spacing-2) var(--spacing-3)",
                      paddingRight: "2.5rem",
                      border: "1px solid var(--border-default)",
                      borderRadius: "var(--radius-md)",
                      background: "var(--bg-default)",
                      color: "var(--text-primary)",
                      fontSize: "var(--text-sm)",
                      boxSizing: "border-box",
                      opacity: loading ? 0.5 : 1,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    disabled={loading}
                    aria-label={showPassword ? "隱藏密碼" : "顯示密碼"}
                    title={showPassword ? "隱藏密碼" : "顯示密碼"}
                    style={{
                      position: "absolute",
                      right: "var(--spacing-2)",
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "transparent",
                      border: "none",
                      cursor: loading ? "default" : "pointer",
                      fontSize: "var(--text-base)",
                      lineHeight: 1,
                      padding: "0.25rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {showPassword ? "🙈" : "👁"}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: "100%",
                  padding: "var(--spacing-3)",
                  background: "var(--action-primary-bg)",
                  color: "var(--action-primary-fg)",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  fontWeight: 600,
                  cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading ? 0.6 : 1,
                  transition: "all 0.2s ease",
                }}
              >
                {loading ? "登入中..." : "登入"}
              </button>
            </form>
          )}

          {activeTab === "register" && (
            <form onSubmit={handleRegisterSubmit}>
              <div style={{ marginBottom: "var(--spacing-4)" }}>
                <label style={{
                  display: "block",
                  marginBottom: "var(--spacing-2)",
                  fontSize: "var(--text-sm)",
                  fontWeight: 500,
                  color: "var(--text-primary)",
                }}>
                  帳號
                </label>
                <input
                  type="text"
                  value={registerAccount}
                  onChange={(e) => setRegisterAccount(e.target.value)}
                  placeholder="設定一個帳號（登入用）"
                  autoComplete="username"
                  disabled={loading}
                  style={{
                    width: "100%",
                    padding: "var(--spacing-2) var(--spacing-3)",
                    border: "1px solid var(--border-default)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--bg-default)",
                    color: "var(--text-primary)",
                    fontSize: "var(--text-sm)",
                    boxSizing: "border-box",
                    opacity: loading ? 0.5 : 1,
                  }}
                />
              </div>

              <div style={{ marginBottom: "var(--spacing-4)" }}>
                <label style={{
                  display: "block",
                  marginBottom: "var(--spacing-2)",
                  fontSize: "var(--text-sm)",
                  fontWeight: 500,
                  color: "var(--text-primary)",
                }}>
                  顯示名稱
                </label>
                <input
                  type="text"
                  value={registerDisplayName}
                  onChange={(e) => setRegisterDisplayName(e.target.value)}
                  placeholder="你的名字"
                  disabled={loading}
                  style={{
                    width: "100%",
                    padding: "var(--spacing-2) var(--spacing-3)",
                    border: "1px solid var(--border-default)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--bg-default)",
                    color: "var(--text-primary)",
                    fontSize: "var(--text-sm)",
                    boxSizing: "border-box",
                    opacity: loading ? 0.5 : 1,
                  }}
                />
              </div>

              <div style={{ marginBottom: "var(--spacing-6)" }}>
                <label style={{
                  display: "block",
                  marginBottom: "var(--spacing-2)",
                  fontSize: "var(--text-sm)",
                  fontWeight: 500,
                  color: "var(--text-primary)",
                }}>
                  密碼（最少 8 個字元）
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={registerPassword}
                    onChange={(e) => setRegisterPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    disabled={loading}
                    style={{
                      width: "100%",
                      padding: "var(--spacing-2) var(--spacing-3)",
                      paddingRight: "2.5rem",
                      border: "1px solid var(--border-default)",
                      borderRadius: "var(--radius-md)",
                      background: "var(--bg-default)",
                      color: "var(--text-primary)",
                      fontSize: "var(--text-sm)",
                      boxSizing: "border-box",
                      opacity: loading ? 0.5 : 1,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    disabled={loading}
                    aria-label={showPassword ? "隱藏密碼" : "顯示密碼"}
                    title={showPassword ? "隱藏密碼" : "顯示密碼"}
                    style={{
                      position: "absolute",
                      right: "var(--spacing-2)",
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "transparent",
                      border: "none",
                      cursor: loading ? "default" : "pointer",
                      fontSize: "var(--text-base)",
                      lineHeight: 1,
                      padding: "0.25rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {showPassword ? "🙈" : "👁"}
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: "var(--spacing-6)" }}>
                <label style={{
                  display: "block",
                  marginBottom: "var(--spacing-2)",
                  fontSize: "var(--text-sm)",
                  fontWeight: 500,
                  color: "var(--text-primary)",
                }}>
                  確認密碼（再次輸入）
                </label>
                <input
                  type={showPassword ? "text" : "password"}
                  value={registerPasswordConfirm}
                  onChange={(e) => setRegisterPasswordConfirm(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  disabled={loading}
                  style={{
                    width: "100%",
                    padding: "var(--spacing-2) var(--spacing-3)",
                    border: "1px solid var(--border-default)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--bg-default)",
                    color: "var(--text-primary)",
                    fontSize: "var(--text-sm)",
                    boxSizing: "border-box",
                    opacity: loading ? 0.5 : 1,
                  }}
                />
                {registerPasswordConfirm.length > 0 &&
                  registerPassword !== registerPasswordConfirm && (
                    <p style={{
                      margin: "var(--spacing-2) 0 0 0",
                      fontSize: "var(--text-xs)",
                      color: "var(--status-error-fg)",
                    }}>
                      兩次密碼不一致
                    </p>
                  )}
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: "100%",
                  padding: "var(--spacing-3)",
                  background: "var(--action-primary-bg)",
                  color: "var(--action-primary-fg)",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  fontWeight: 600,
                  cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading ? 0.6 : 1,
                  transition: "all 0.2s ease",
                }}
              >
                {loading ? "註冊中..." : "註冊"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
