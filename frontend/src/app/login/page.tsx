import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/api";
import { LoginForm } from "./LoginForm";

// 強制動態渲染：每次請求都依當下 cookie 重新判斷登入狀態
export const dynamic = "force-dynamic";

/**
 * 登入頁（server component 守門）
 *
 * 嚴重 bug 修正：過去登入頁是 client component，root layout 又會在「SSR 判定為已登入」時
 * 套上完整外殼（標題列＋側欄）。於是「已登入者被導到 /login」會出現
 * 「登入表單套在登入後外殼裡、且瀏覽器自動填入帳密」的矛盾畫面。
 *
 * 解法：在 server 端先判斷登入狀態——
 * - 已登入 → 在「任何畫面渲染之前」就 redirect 回首頁（不會送出外殼 HTML，也不會閃現登入表單）。
 * - 未登入 → 才渲染登入表單（此時 root layout 的 user 為 null，本就不套外殼，呈現滿版置中登入框）。
 */
export default async function LoginPage() {
  // SSR 時把瀏覽器送來的 cookie 轉發給 API，讓伺服器端能正確判斷登入狀態
  const cookieHeader = (await cookies()).toString();
  const user = await getCurrentUser(cookieHeader).catch(() => null);

  // 已登入者不該停留在登入頁：在渲染前直接導回首頁
  if (user) {
    redirect("/");
  }

  return <LoginForm />;
}
