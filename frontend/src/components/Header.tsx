"use client";

import { CurrentUser, getLogoutUrl, getLoginUrl } from "@/lib/api";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { GlobalSearch } from "./GlobalSearch";
import { useCanvasToolbar } from "./CanvasToolbarContext";
import {
  toggleMobileNav,
  isMobileNavOpen,
  MOBILE_NAV_EVENT,
} from "@/lib/mobileNav";
import {
  SHORTCUT_ACTIONS,
  effectiveKey,
  keyCapLabel,
  loadShortcutOverrides,
  SHORTCUTS_UPDATED_EVENT,
} from "@/lib/shortcuts";
import { THEME_CHANGED_EVENT } from "@/components/ShortcutRuntime";

/**
 * Header 元件
 * - 品牌標誌
 * - 主功能導覽 (首頁、筆記、日程規劃、行事曆、開問啦)
 * - 全域搜尋框
 * - 顯示模式切換
 * - 帳號選單
 * - 手機版漢堡菜單
 */
export function Header({ user }: { user: CurrentUser | null }) {
  // 開問啦工具列（由 /canvas 的 KaiWenCanvas 透過 Context 上送；其他頁為 null）
  const { node: canvasToolbar } = useCanvasToolbar();
  // 僅在掛載後才渲染工具列：SSR 與首次 hydration 都輸出 null（與伺服器一致），
  // 避免「伺服器渲染主題鈕、客戶端已渲染工具列」的 hydration 不一致 (#418)。
  const [toolbarHydrated, setToolbarHydrated] = useState(false);
  useEffect(() => setToolbarHydrated(true), []);

  // 初始一律用穩定預設值，避免 SSR 與首次 client render 不一致（hydration mismatch）；
  // 真正的偏好在下方 useEffect（掛載後）才從 localStorage 讀取並套用。
  const [theme, setTheme] = useState<
    "warmpaper" | "light" | "dark" | "night"
  >("warmpaper");
  // 行動版側欄抽屜開關（真實狀態在 <html data-mobnav>；此 state 僅供漢堡鈕的
  // aria-expanded 同步，透過自訂事件監聽各處開關（漢堡、遮罩、側欄連結、換頁）。
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useEffect(() => {
    const sync = () => {
      const open = isMobileNavOpen();
      setMobileMenuOpen(open);
      // 開啟側欄抽屜時，順手關掉 Header 內的下拉選單——它們 z-index 高於抽屜，
      // 否則開抽屜後殘留的選單會浮在抽屜之上，造成視覺混亂。
      if (open) {
        setAccountMenuOpen(false);
        setThemeMenuOpen(false);
      }
    };
    window.addEventListener(MOBILE_NAV_EVENT, sync);
    return () => window.removeEventListener(MOBILE_NAV_EVENT, sync);
  }, []);

  // 帳號選單狀態
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  // 是否在導覽列顯示快捷鍵提示（如「日程規劃 (T)」）。預設關閉（避免太雜），
  // 使用者可於「顯示」選單開啟；偏好存 localStorage。
  const [showHints, setShowHints] = useState(false);
  // 各快捷鍵動作目前「生效鍵」的鍵帽文字（動作 ID → 顯示字，如 "T"）。
  const [hintKeys, setHintKeys] = useState<Record<string, string>>({});

  // 切換主題
  const handleThemeChange = (newTheme: typeof theme) => {
    setTheme(newTheme);
    localStorage.setItem("zonwiki:theme", newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
  };

  // 切換「顯示快捷鍵提示」並持久化。
  const toggleHints = () => {
    setShowHints((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("zonwiki:showShortcutHints", next ? "1" : "0");
      } catch {
        /* localStorage 不可用時忽略 */
      }
      return next;
    });
  };

  // 載入「顯示提示」偏好，並依快捷鍵覆寫算出各導覽動作的生效鍵；
  // 覆寫更新時（SHORTCUTS_UPDATED_EVENT）即時重算。
  useEffect(() => {
    try {
      setShowHints(localStorage.getItem("zonwiki:showShortcutHints") === "1");
    } catch {
      /* 忽略 */
    }
    let alive = true;
    const apply = () =>
      loadShortcutOverrides(true).then((overrides) => {
        if (!alive) return;
        const map: Record<string, string> = {};
        for (const action of SHORTCUT_ACTIONS) {
          map[action.id] = keyCapLabel(effectiveKey(action, overrides));
        }
        setHintKeys(map);
      });
    apply();
    const onUpdated = () => apply();
    window.addEventListener(SHORTCUTS_UPDATED_EVENT, onUpdated);
    return () => {
      alive = false;
      window.removeEventListener(SHORTCUTS_UPDATED_EVENT, onUpdated);
    };
  }, []);

  // 處理登出
  const handleLogout = async () => {
    // 呼叫後端登出 API 清除 cookie。
    // 必須用「絕對網址」(getLogoutUrl 指向後端 5009)；先前用 .replace 改成相對網址
    // 會打到前端 3000(無此路由)而失敗，導致 cookie 沒被清除、仍是登入狀態。
    await fetch(getLogoutUrl(), {
      method: "POST",
      credentials: "include",
    }).catch(() => {});
    // 用整頁導向而非 router.push：強制重新執行 server layout，
    // 讓 user 變為 null → 登入頁以獨立版面(不套外殼)呈現。
    window.location.href = "/login";
  };

  // 在掛載時應用保存的主題，並監聽「主題已由快捷鍵切換」事件以同步顯示（V 鍵循環主題）。
  useEffect(() => {
    const stored = localStorage.getItem("zonwiki:theme") as
      | "warmpaper"
      | "light"
      | "dark"
      | "night"
      | null;
    const themeToApply = stored || "warmpaper";
    document.documentElement.setAttribute("data-theme", themeToApply);
    setTheme(themeToApply);

    const onThemeChanged = (e: Event) => {
      const next = (e as CustomEvent<{ theme?: string }>).detail?.theme;
      if (next === "warmpaper" || next === "light" || next === "dark" || next === "night") {
        setTheme(next);
      }
    };
    window.addEventListener(THEME_CHANGED_EVENT, onThemeChanged);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, onThemeChanged);
  }, []);

  // 帳號選單：點外部自動關閉
  useEffect(() => {
    if (!accountMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(e.target as Node)
      ) {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [accountMenuOpen]);

  // 主題選單開關（點外部自動關閉）
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  useEffect(() => {
    if (!themeMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        themeMenuRef.current &&
        !themeMenuRef.current.contains(e.target as Node)
      ) {
        setThemeMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [themeMenuOpen]);

  const themeOptions = [
    { key: "warmpaper" as const, label: "暖紙" },
    { key: "light" as const, label: "明亮" },
    { key: "dark" as const, label: "暗色" },
    { key: "night" as const, label: "夜間" },
  ];

  return (
    <header className="header" role="banner">
      {/* 左側：品牌 + 導覽 */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        {/* 品牌 */}
        <Link href="/" className="brand">
          <div className="brand__icon">Z</div>
          <span style={{ fontWeight: 700 }}>ZonWiki</span>
        </Link>

        {/* 主功能導覽 (桌面版)。首頁不放字樣 —— 點左上 Logo (ZonWiki) 即可回首頁。
            順序：ZonWiki(Logo) → 日程規劃 → 開問啦 → 筆記。行事曆已併入「日程規劃」的視圖。 */}
        <nav className="nav" role="navigation">
          <Link href="/tasks" className="nav-item">
            日程規劃
            {showHints && hintKeys.openTasks && (
              <span className="nav-hint">({hintKeys.openTasks})</span>
            )}
          </Link>
          <Link href="/canvas" className="nav-item">
            開問啦
            {showHints && hintKeys.openCanvas && (
              <span className="nav-hint">({hintKeys.openCanvas})</span>
            )}
          </Link>
          <Link href="/notes" className="nav-item">
            筆記
            {showHints && hintKeys.openNotes && (
              <span className="nav-hint">({hintKeys.openNotes})</span>
            )}
          </Link>
        </nav>
      </div>

      {/* 中央：搜尋框 */}
      <div className="search-box" style={{ flex: 1, maxWidth: "400px", margin: "0 var(--spacing-6)" }}>
        <GlobalSearch />
      </div>

      {/* 右側：主題切換、帳號 —— marginLeft:auto 確保永遠貼齊畫面最右上角 */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginLeft: "auto" }}>
        {/* 開問啦工具列：僅在 /canvas 由 KaiWenCanvas 透過 Context 提供功能按鈕，
            其餘頁面為 null。這樣開問啦就不需要自己的第二列標題，畫布高度與原版一致。 */}
        {toolbarHydrated ? canvasToolbar : null}

        {/* 統一垃圾桶入口 */}
        <Link href="/trash" className="icon-btn hide-mobile" title="垃圾桶" aria-label="垃圾桶">
          🗑️
        </Link>

        {/* 主題切換 */}
        <div ref={themeMenuRef} style={{ position: "relative", display: "inline-block" }}>
          <button
            className="icon-btn"
            title="顯示設定"
            aria-label="顯示設定"
            aria-haspopup="menu"
            aria-expanded={themeMenuOpen}
            onClick={() => setThemeMenuOpen((open) => !open)}
          >
            {theme === "warmpaper" && "🌙"}
            {theme === "light" && "☀️"}
            {theme === "dark" && "🌗"}
            {theme === "night" && "⭐"}
          </button>

          {/* 主題選單（僅在開啟時顯示） */}
          {themeMenuOpen && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              right: 0,
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-md)",
              padding: "var(--spacing-2)",
              marginTop: "var(--spacing-2)",
              minWidth: "160px",
              boxShadow: "var(--shadow-md)",
              zIndex: 1000,
            }}
            role="menu"
          >
            {themeOptions.map((opt) => (
              <button
                key={opt.key}
                onClick={() => {
                  handleThemeChange(opt.key);
                  setThemeMenuOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "var(--spacing-2) var(--spacing-3)",
                  background:
                    theme === opt.key
                      ? "var(--action-secondary-bg)"
                      : "transparent",
                  color:
                    theme === opt.key
                      ? "var(--action-secondary-fg)"
                      : "var(--text-primary)",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  fontSize: "var(--text-sm)",
                  transition: "all 0.2s ease",
                }}
                role="menuitem"
              >
                {opt.label}
              </button>
            ))}

            {/* 分隔線 */}
            <div
              style={{
                borderTop: "1px solid var(--border-default)",
                margin: "var(--spacing-2) 0",
              }}
            />

            {/* 顯示快捷鍵提示開關（如「日程規劃 (T)」） */}
            <button
              onClick={toggleHints}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                textAlign: "left",
                padding: "var(--spacing-2) var(--spacing-3)",
                background: "transparent",
                color: "var(--text-primary)",
                border: "none",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
                fontSize: "var(--text-sm)",
                gap: "var(--spacing-2)",
              }}
              role="menuitemcheckbox"
              aria-checked={showHints}
            >
              <span>顯示快捷鍵提示</span>
              <span
                aria-hidden
                style={{
                  fontSize: "var(--text-xs)",
                  fontWeight: 600,
                  color: showHints
                    ? "var(--action-secondary-fg)"
                    : "var(--text-tertiary)",
                }}
              >
                {showHints ? "開啟" : "關閉"}
              </span>
            </button>
          </div>
          )}
        </div>

        {/* 帳號選單 */}
        {user ? (
          <div ref={accountMenuRef} style={{ position: "relative", display: "inline-block" }}>
            <button
              onClick={() => setAccountMenuOpen(!accountMenuOpen)}
              className="account-menu"
              style={{
                background: "transparent",
                border: "none",
                padding: "0",
                display: "flex",
                alignItems: "center",
                gap: "var(--spacing-2)",
                cursor: "pointer",
              }}
              aria-label="帳號選單"
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
            >
              <div
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  background: "var(--action-secondary-bg)",
                  color: "var(--action-secondary-fg)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 600,
                  fontSize: "var(--text-sm)",
                }}
                title={user.email}
              >
                {user.displayName?.charAt(0).toUpperCase()}
              </div>
            </button>

            {/* 帳號下拉菜單 */}
            {accountMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-md)",
                  padding: "var(--spacing-2)",
                  marginTop: "var(--spacing-2)",
                  minWidth: "220px",
                  boxShadow: "var(--shadow-md)",
                  zIndex: 1000,
                }}
                role="menu"
              >
                {/* 使用者資訊 */}
                <div style={{
                  padding: "var(--spacing-2) var(--spacing-3)",
                  borderBottom: "1px solid var(--border-default)",
                  marginBottom: "var(--spacing-2)",
                }}>
                  <div style={{
                    fontSize: "var(--text-sm)",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                  }}>
                    {user.displayName}
                  </div>
                  <div style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--text-secondary)",
                  }}>
                    {user.email}
                  </div>
                </div>

                {/* 個人頁面：email/暱稱/統計/每日活動/刪除帳號等都在此頁 */}
                <Link
                  href="/profile"
                  onClick={() => setAccountMenuOpen(false)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "var(--spacing-2) var(--spacing-3)",
                    background: "transparent",
                    color: "var(--text-primary)",
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                    fontSize: "var(--text-sm)",
                    textDecoration: "none",
                    transition: "all 0.2s ease",
                  }}
                  role="menuitem"
                >
                  個人頁面
                </Link>

                {/* 登出選項 */}
                <button
                  onClick={handleLogout}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "var(--spacing-2) var(--spacing-3)",
                    background: "transparent",
                    color: "var(--text-primary)",
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                    fontSize: "var(--text-sm)",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    const target = e.target as HTMLElement;
                    target.style.background = "var(--action-secondary-bg)";
                  }}
                  onMouseLeave={(e) => {
                    const target = e.target as HTMLElement;
                    target.style.background = "transparent";
                  }}
                  role="menuitem"
                >
                  登出
                </button>
              </div>
            )}

          </div>
        ) : (
          <a href={getLoginUrl()} className="btn-primary">
            登入
          </a>
        )}
      </div>

      {/* 手機版漢堡鈕：只在手機斷點（CSS）顯示，點擊切換真正的側欄抽屜 */}
      <button
        className="icon-btn mobile-nav-toggle"
        onClick={toggleMobileNav}
        aria-label="切換側欄"
        aria-expanded={mobileMenuOpen}
        aria-controls="app-sidebar"
      >
        ≡
      </button>
      {/* 注意：抽屜遮罩 .mobnav-overlay 已移至版面根層（<MobileNavOverlay/>），
          不可放在 Header 內——否則會被困在 Header 的堆疊環境而蓋住抽屜，
          導致點抽屜連結反而點到遮罩、頁面切換不了。 */}
    </header>
  );
}
