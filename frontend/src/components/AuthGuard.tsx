"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { CurrentUser } from "@/lib/api";

/**
 * 驗證守護元件：確保登入狀態與路由一致（雙向守門）
 *
 * - 未登入且不在登入頁 → 重導到登入頁。
 * - 已登入卻在登入頁 → 重導回首頁（避免「登入表單套在登入後外殼裡」的矛盾畫面）。
 *
 * 此元件是 client 端的防線；伺服器端 login/page.tsx 已先擋一層（已登入者 SSR 即導回），
 * 這裡再補上 client 端 soft navigation（router.push("/login")）的情境。
 */
export function AuthGuard({ user }: { user: CurrentUser | null }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // 未登入且不在登入頁 → 導到登入頁
    if (!user && pathname !== "/login") {
      router.push("/login");
      return;
    }
    // 已登入卻在登入頁 → 導回首頁（用 replace 不留歷史，避免上一頁又回到登入頁）
    if (user && pathname === "/login") {
      router.replace("/");
    }
  }, [user, pathname, router]);

  // 未登入且不在登入頁，不渲染任何內容（避免閃爍）
  if (!user && pathname !== "/login") {
    return null;
  }

  return null; // 驗證守護只負責重導，不渲染任何 UI
}
