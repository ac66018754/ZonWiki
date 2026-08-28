"use client";

import { CurrentUser, getLogoutUrl, getLoginUrl, updateUserSettings } from "@/lib/api";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GlobalSearch } from "./GlobalSearch";
import { AiProcessingMenu } from "./AiProcessingMenu";
import { confirmNavigation } from "@/lib/navigationGuard";
import { getNotesNavTarget } from "@/lib/notesNavTarget";
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
import { fileToBrandLogoDataUrl } from "@/lib/brandLogo";
import { showToast } from "@/lib/toast";

/**
 * 品牌標誌裡的大寫「Z」向量圖形。
 *
 * 為什麼不用文字：見 Header 內品牌區塊的註解（各平台字體 cap height 不同，
 * 文字無法保證「佔滿元件 80~90%」這個明確規格）。
 *
 * 座標系固定為 100×100 的 viewBox，Z 的外框佔 7.5~92.5（＝邊長的 85%，落在需求的 80~90% 內）。
 * 由三塊組成：上橫槓、下橫槓、以及連接兩者的斜槓（平行四邊形）。
 * 斜槓的水平寬度 25.5 ＝ 垂直厚度 18 × √2，如此斜槓的「垂直於自身」的厚度才與橫槓一致（不會看起來偏細）。
 * @returns 可隨父層 color 變色（fill="currentColor"）的 SVG 元素。
 */
function BrandZ(): React.ReactElement {
  return (
    <svg
      className="brand__z"
      viewBox="0 0 100 100"
      fill="currentColor"
      focusable="false"
      aria-hidden
    >
      {/* 上橫槓 */}
      <rect x="7.5" y="7.5" width="85" height="18" />
      {/* 斜槓（右上 → 左下的平行四邊形） */}
      <polygon points="67,7.5 92.5,7.5 33,92.5 7.5,92.5" />
      {/* 下橫槓 */}
      <rect x="7.5" y="74.5" width="85" height="18" />
    </svg>
  );
}

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
  const router = useRouter();
  // 開問啦工具列（由 /canvas 的 KaiWenCanvas 透過 Context 上送；其他頁為 null）
  const { node: canvasToolbar } = useCanvasToolbar();

  /**
   * 點「筆記」導覽：若記得「最後看的筆記」就直接回到那篇（含捲動位置），
   * 否則退回筆記清單 /notes。每次點擊都即時讀 localStorage，確保拿到最新一篇。
   *
   * 導頁前先過全站導頁守門 confirmNavigation()（如筆記編輯中有未儲存變更會先確認）；
   * 使用者取消就留在原地。這個 <a> 標了 data-skip-leave-guard，讓筆記頁的 <a> 攔截器
   * 不插手、由本函式自行決定「導回上次那篇」的正確目的地（避免被攔去 /notes 清單）。
   */
  const handleNotesNav = (e: React.MouseEvent) => {
    // 修飾鍵 / 非左鍵（開新分頁、另開視窗等）交給瀏覽器預設行為，不攔。
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    // 一律自行導頁：先算目的地（記得的最後一篇；否則清單），再過守門確認。
    // 目的地計算抽到 getNotesNavTarget() 與快捷鍵 N 共用（DRY）。
    e.preventDefault();
    const target = getNotesNavTarget();
    void confirmNavigation().then((canLeave) => {
      if (canLeave) router.push(target);
    });
  };
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

  // ── 自訂品牌標誌（Header 左上角圓形圖示）──────────────────────────────
  // 初始值取自 SSR 帶下來的 user（外殼在伺服端就拿到 /api/me），故首次繪製就是正確的圖，
  // 不會先閃內建「Z」再換圖；之後使用者換圖時以本地 state 立即反映。
  const [brandLogoUrl, setBrandLogoUrl] = useState<string | null>(user?.brandLogoUrl ?? null);
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const [brandLogoSaving, setBrandLogoSaving] = useState(false);
  const brandMenuRef = useRef<HTMLDivElement>(null);
  const brandFileRef = useRef<HTMLInputElement>(null);

  // 切換帳號 / 伺服端資料更新時，同步標誌（例如在另一台裝置換過圖後重新整理）。
  useEffect(() => {
    setBrandLogoUrl(user?.brandLogoUrl ?? null);
  }, [user?.brandLogoUrl]);

  // 標誌選單：點外部 / 按 Esc 關閉（與帳號、主題選單一致）。
  useEffect(() => {
    if (!brandMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (brandMenuRef.current && !brandMenuRef.current.contains(e.target as Node)) {
        setBrandMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBrandMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [brandMenuOpen]);

  /**
   * 套用使用者選的圖片為品牌標誌：瀏覽器端縮成 128×128 → 存進 DB → 立即反映。
   * 樂觀更新：先換畫面再送出；失敗則回滾成原圖並提示（避免「看起來成功、重整後不見」）。
   * @param file 使用者選的圖片檔。
   */
  const applyBrandLogoFile = async (file: File) => {
    const previous = brandLogoUrl;
    setBrandLogoSaving(true);
    try {
      const dataUrl = await fileToBrandLogoDataUrl(file);
      setBrandLogoUrl(dataUrl);
      await updateUserSettings({ brandLogoUrl: dataUrl });
      showToast("已更換標誌", { type: "success" });
    } catch (err) {
      setBrandLogoUrl(previous);
      showToast(err instanceof Error ? err.message : "更換標誌失敗", { type: "error" });
    } finally {
      setBrandLogoSaving(false);
    }
  };

  /** 還原成內建的「Z」向量標誌（後端以空字串代表清除）。 */
  const clearBrandLogo = async () => {
    const previous = brandLogoUrl;
    setBrandLogoSaving(true);
    try {
      setBrandLogoUrl(null);
      await updateUserSettings({ brandLogoUrl: "" });
      showToast("已還原預設標誌", { type: "success" });
    } catch {
      setBrandLogoUrl(previous);
      showToast("還原標誌失敗", { type: "error" });
    } finally {
      setBrandLogoSaving(false);
    }
  };

  // 手機搜尋框開關（≤768px 搜尋框預設收合、點 🔍 才展開——置頂空間讓給內容頁的
  // 工具列，使用者裁示 2026-08-11）。桌機不受影響（🔍 鈕與收合規則都只在手機斷點生效）。
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const toggleMobileSearch = () => {
    setMobileSearchOpen((open) => {
      const next = !open;
      if (next) {
        // 展開後自動聚焦輸入框，點一下就能直接打字（rAF 等展開的列渲染完）。
        requestAnimationFrame(() => {
          document.querySelector<HTMLInputElement>(".header .search-box input")?.focus();
        });
      }
      return next;
    });
  };

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
        {/* 品牌：圓形標誌（像大頭照），內容是使用者自訂圖片，未設定時用內建的「Z」向量。
            右鍵點它 → 小選單（更換圖片 / 還原預設）。用右鍵而非左鍵：左鍵要留給「回首頁」。
            圖片存 DB（User_BrandLogoUrl），故跨裝置同步；詳見 lib/brandLogo.ts 的縮圖說明。 */}
        <div ref={brandMenuRef} style={{ position: "relative", display: "inline-flex" }}>
          <Link
            href="/"
            className="brand"
            aria-label="ZonWiki 首頁（在標誌上按右鍵可更換圖片）"
            title="回首頁（在標誌上按右鍵可更換圖片）"
            onContextMenu={(e) => {
              e.preventDefault();
              setBrandMenuOpen((open) => !open);
            }}
          >
            <span className="brand__icon" aria-hidden>
              {brandLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- data URI 不需要 next/image 最佳化
                <img className="brand__img" src={brandLogoUrl} alt="" />
              ) : (
                <BrandZ />
              )}
            </span>
          </Link>

          {/* 隱藏的檔案選擇器：由選單的「更換圖片」觸發 */}
          <input
            ref={brandFileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              // 先清空 value：同一個檔案連選兩次也要能觸發 change。
              e.target.value = "";
              if (file) void applyBrandLogoFile(file);
            }}
          />

          {brandMenuOpen && (
            <div role="menu" className="brand__menu">
              <button
                type="button"
                role="menuitem"
                className="brand__menuitem"
                onClick={() => {
                  setBrandMenuOpen(false);
                  brandFileRef.current?.click();
                }}
              >
                更換圖片…
              </button>
              <button
                type="button"
                role="menuitem"
                className="brand__menuitem"
                disabled={!brandLogoUrl || brandLogoSaving}
                onClick={() => {
                  setBrandMenuOpen(false);
                  void clearBrandLogo();
                }}
              >
                還原預設標誌
              </button>
            </div>
          )}
        </div>

        {/* 主功能導覽 (桌面版)。
            「首頁」原本沒有字樣、只靠左上角的 ZonWiki 字標進入；2026-08-28 字標移除後
            那顆可點的文字按鈕就消失了（標誌縮成 32px 圖示不好認），故補回成第一顆導覽項。
            順序：首頁 → 日程規劃 → 開問啦 → 筆記 → 其他。行事曆已併入「日程規劃」的視圖。 */}
        <nav className="nav" role="navigation">
          <Link href="/" className="nav-item">
            首頁
            {showHints && hintKeys.openHome && (
              <span className="nav-hint">({hintKeys.openHome})</span>
            )}
          </Link>
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
          <Link
            href="/notes"
            className="nav-item"
            onClick={handleNotesNav}
            data-skip-leave-guard
          >
            筆記
            {showHints && hintKeys.openNotes && (
              <span className="nav-hint">({hintKeys.openNotes})</span>
            )}
          </Link>
          {/* 「其他」功能群（記帳／單字庫／英文教練）——普通 Link 即可，
              天然位於「筆記」右、AiProcessingMenu 左，不需搬動任何元件。 */}
          <Link href="/others" className="nav-item">
            其他
          </Link>
        </nav>
      </div>

      {/* 「AI處理中(n)」下拉：位於「筆記」與「搜尋框」之間；點開就地展開清單、不跳頁。
          僅登入後顯示（提問佇列 API 需驗證）。 */}
      {user && <AiProcessingMenu />}

      {/* 中央：搜尋框（尺寸/邊距移到 globals.css 的 .header .search-box——
          先前 inline style 的固定 max-width 與左右 24px margin 會蓋掉 640px 斷點的
          手機規則，讓 Header 在 393px 有溢出風險）。
          手機（≤768px）預設收合、由 🔍 鈕展開（search-box--mobile-open）。 */}
      <div className={`search-box ${mobileSearchOpen ? "search-box--mobile-open" : ""}`}>
        <GlobalSearch />
      </div>

      {/* 右側：主題切換、帳號 —— marginLeft:auto 確保永遠貼齊畫面最右上角 */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginLeft: "auto" }}>
        {/* 開問啦工具列：僅在 /canvas 由 KaiWenCanvas 透過 Context 提供功能按鈕，
            其餘頁面為 null。這樣開問啦就不需要自己的第二列標題，畫布高度與原版一致。 */}
        {toolbarHydrated ? canvasToolbar : null}

        {/* 手機搜尋切換鈕（桌機由 CSS 隱藏）：點開/收合整列搜尋框 */}
        <button
          className="icon-btn mobile-search-toggle"
          title={mobileSearchOpen ? "收合搜尋" : "搜尋"}
          aria-label={mobileSearchOpen ? "收合搜尋" : "開啟搜尋"}
          aria-expanded={mobileSearchOpen}
          onClick={toggleMobileSearch}
        >
          🔍
        </button>

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
                  // 2026-08-28 使用者裁示：右側三顆（垃圾桶／顯示設定／帳號）相對 56px 的 Header
                  // 顯得太小，統一放大到 40px。
                  width: "40px",
                  height: "40px",
                  borderRadius: "50%",
                  background: "var(--action-secondary-bg)",
                  color: "var(--action-secondary-fg)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 600,
                  fontSize: "var(--text-base)",
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
