"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * 瀏覽器端 API 基底（與 lib/api.ts 一致）。
 * 這裡用「原生 fetch」直接打 /api/me 做二次確認，刻意不走 fetchJson——
 * 避免 fetchJson 收到 401 又再次廣播 `zonwiki:unauthorized` 造成無窮迴圈。
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5009";

/** 暫時性錯誤提示條自動消失的毫秒數 */
const TRANSIENT_TOAST_MS = 6000;

/**
 * 401 統一回饋元件：把「任一 API 回 401」分流成兩種對使用者明確的回饋。
 *
 * 收到 `zonwiki:unauthorized` 後，先以 /api/me 二次確認是否「真的」登出：
 *
 * 1) 確實登出（/api/me 明確回 401）→ 彈出「🔒 請先登入」對話窗 + 「前往登入頁」按鈕。
 *
 * 2) 其實仍登入（/api/me 回 200），或後端暫時壞掉/連不上（5xx、逾時、連線失敗）
 *    → 這是「暫時性 401」：你沒有被登出，但「剛才那個操作（例如存筆記）失敗了」。
 *    過去這種情況「靜默無提示」，使用者完全不知道發生什麼事（就是最初『新增筆記沒反應』的輕量版）。
 *    現在改為跳出一個輕量、會自動消失的提示條（toast），明確告訴使用者「操作未完成、請稍後重試」。
 *
 * 注意：對「新增/儲存」這類寫入操作，我們刻意「不自動重試」（自動重送可能造成重複資料），
 * 而是提示使用者自行重試，較安全。
 *
 * 嚴重 bug 修正脈絡：過去只要任一 401 就立刻彈窗並導向 /login，暫時性 401（例如後端重啟瞬間、
 * 競態）會把「其實仍登入」的人趕到 /login，再加上當時登入頁會套在登入後外殼裡，
 * 就出現「登入後畫面 + 登入表單 + 瀏覽器自動填入帳密」的矛盾畫面。二次確認即為此而設。
 */
export function SessionExpiryPrompt() {
  // 確實登出 → 顯示登入對話窗
  const [show, setShow] = useState(false);
  // 暫時性錯誤（仍登入但操作失敗 / 後端暫時不可用）→ 顯示提示條
  const [transient, setTransient] = useState(false);
  const pathname = usePathname();
  // 避免同時間多個 401 觸發多次確認
  const verifyingRef = useRef(false);
  // 提示條自動消失計時器
  const transientTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * 二次確認是否「真的」登出。回傳 true = 確實登出（且僅在這種情況才彈登入窗）。
   *
   * 關鍵：唯有 /api/me 明確回 401 才算「登出」。
   * - 200 → 仍登入（暫時性 401 的誤報）。
   * - 5xx / 其它非 401 錯誤 → 後端異常（例如重啟中），不是登出。
   * - 連線失敗 / 逾時（後端短暫不可用）→ 同理，不視為登出。
   * 這正是對抗式審查抓到的重點：別把「後端暫時壞掉」誤判成「使用者登出」。
   */
  const isReallyLoggedOut = useCallback(async (): Promise<boolean> => {
    // 加上逾時，避免後端卡住時這個確認永遠不回來
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${API_BASE}/api/me`, {
        credentials: "include",
        cache: "no-store", // 避免快取造成誤判
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      });
      // 唯有明確 401 才算登出；其餘一律視為「仍可能登入」
      return res.status === 401;
    } catch {
      // 連線失敗 / 逾時：不視為登出
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  /**
   * 顯示「暫時性錯誤」提示條，並（重置）自動消失計時器。
   */
  const showTransientToast = useCallback(() => {
    setTransient(true);
    if (transientTimerRef.current) clearTimeout(transientTimerRef.current);
    transientTimerRef.current = setTimeout(() => setTransient(false), TRANSIENT_TOAST_MS);
  }, []);

  useEffect(() => {
    const onUnauth = async () => {
      // 已在登入頁就不處理（登入頁本身的 401 屬正常）
      if (window.location.pathname === "/login") return;
      if (verifyingRef.current) return;
      verifyingRef.current = true;
      try {
        const loggedOut = await isReallyLoggedOut();
        if (window.location.pathname === "/login") return; // await 期間可能已導到登入頁
        if (loggedOut) {
          // 確實登出 → 登入對話窗
          setShow(true);
        } else {
          // 仍登入 / 後端暫時不可用 → 暫時性錯誤提示條（讓使用者知道操作沒成功）
          showTransientToast();
        }
      } finally {
        verifyingRef.current = false;
      }
    };
    window.addEventListener("zonwiki:unauthorized", onUnauth);
    return () => window.removeEventListener("zonwiki:unauthorized", onUnauth);
  }, [isReallyLoggedOut, showTransientToast]);

  // 換頁時自動關閉兩種提示（例如已導回登入頁）
  useEffect(() => {
    setShow(false);
    setTransient(false);
  }, [pathname]);

  // 卸載時清掉計時器
  useEffect(() => {
    return () => {
      if (transientTimerRef.current) clearTimeout(transientTimerRef.current);
    };
  }, []);

  const goLogin = () => {
    // 整頁導向，強制重新執行 server layout 並讀新 cookie（此時確實登出 → 呈現純登入頁）
    window.location.href = "/login";
  };

  return (
    <>
      {/* 1) 確實登出 → 登入對話窗 */}
      {show && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={goLogin}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 3000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: "360px",
              background: "var(--bg-surface)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "var(--shadow-lg)",
              padding: "var(--spacing-6)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "var(--text-2xl)", marginBottom: "var(--spacing-2)" }}>🔒</div>
            <h2 style={{ margin: "0 0 var(--spacing-2) 0", fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--text-primary)" }}>
              請先登入
            </h2>
            <p style={{ margin: "0 0 var(--spacing-5) 0", fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
              您的登入已逾時或尚未登入，無法完成剛才的操作。請重新登入後再試。
            </p>
            <button
              onClick={goLogin}
              style={{
                width: "100%",
                padding: "var(--spacing-3)",
                background: "var(--action-primary-bg)",
                color: "var(--action-primary-fg)",
                border: "none",
                borderRadius: "var(--radius-md)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              前往登入頁
            </button>
          </div>
        </div>
      )}

      {/* 2) 暫時性錯誤（仍登入但操作失敗 / 後端暫時不可用）→ 自動消失的提示條 */}
      {transient && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: "var(--spacing-6)",
            left: "50%",
            transform: "translateX(-50%)",
            maxWidth: "min(92vw, 460px)",
            display: "flex",
            alignItems: "flex-start",
            gap: "var(--spacing-3)",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-default)",
            borderLeft: "4px solid var(--status-warning-fg, #d97706)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-lg)",
            padding: "var(--spacing-3) var(--spacing-4)",
            zIndex: 2900,
          }}
        >
          <span style={{ fontSize: "var(--text-lg)", lineHeight: 1.2 }}>⚠️</span>
          <div style={{ flex: 1, fontSize: "var(--text-sm)", color: "var(--text-primary)", lineHeight: 1.5 }}>
            <strong style={{ display: "block", marginBottom: "2px" }}>剛才的操作沒有成功</strong>
            <span style={{ color: "var(--text-secondary)" }}>
              連線忙碌或伺服器暫時中斷（你仍在登入狀態）。請稍後再試一次。
            </span>
          </div>
          <button
            onClick={() => setTransient(false)}
            aria-label="關閉提示"
            title="關閉"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--text-secondary)",
              fontSize: "var(--text-base)",
              lineHeight: 1,
              padding: "2px",
            }}
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
