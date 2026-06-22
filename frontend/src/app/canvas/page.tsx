/**
 * 開問啦頁面 — /canvas
 *
 * 包裝 KaiWenCanvas 元件，傳入當前使用者設定（主題、時區）
 */

import { getCurrentUser } from '@/lib/api'
import { cookies } from 'next/headers'
import { KaiWenCanvas } from './KaiWenCanvas'

export const dynamic = 'force-dynamic'

export default async function CanvasPage() {
  // SSR 時轉發瀏覽器 cookie 給 API，否則永遠取不到使用者（會誤判未登入）
  const cookieHeader = (await cookies()).toString()
  const user = await getCurrentUser(cookieHeader).catch(() => null)

  // 提取主題與時區（預設值）
  const theme =
    (user?.displayMode as 'warmpaper' | 'light' | 'dark' | 'night' | undefined) ?? 'warmpaper'
  const timezone = user?.timeZone ?? 'Asia/Taipei'
  const isAuthenticated = user !== null

  return (
    <KaiWenCanvas
      theme={theme}
      timezone={timezone}
      isAuthenticated={isAuthenticated}
    />
  )
}
