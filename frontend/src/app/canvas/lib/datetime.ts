/**
 * 日期時間工具
 * 格式化與時區處理
 */

/**
 * 將 UTC ISO 字串格式化為完整日期時間
 * @param isoString - UTC ISO 8601 格式字串 (如 "2026-06-11T12:34:56Z")
 * @param timezone - IANA 時區字串 (如 "Asia/Taipei")，預設 "UTC"
 * @returns 完整格式字串，例："2026 年 6 月 11 日 20:34:56"
 */
export function formatDateTime(
  isoString: string | undefined | null,
  timezone = 'UTC'
): string {
  if (!isoString) return '(無日期)'

  try {
    const date = new Date(isoString)
    if (isNaN(date.getTime())) return '(無效日期)'

    return date.toLocaleString('zh-TW', {
      year: 'numeric',
      month: 'long',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: timezone,
    })
  } catch {
    return '(無法解析)'
  }
}

/**
 * 將 UTC ISO 字串格式化為簡短日期時間（縮略）
 * @param isoString - UTC ISO 8601 格式字串
 * @param timezone - IANA 時區字串，預設 "UTC"
 * @returns 簡短格式字串，例："6/11 20:34"
 */
export function formatShort(
  isoString: string | undefined | null,
  timezone = 'UTC'
): string {
  if (!isoString) return '(無)'

  try {
    const date = new Date(isoString)
    if (isNaN(date.getTime())) return '(無)'

    return date.toLocaleString('zh-TW', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    })
  } catch {
    return '(無)'
  }
}

/**
 * 取得目前時刻的簡短相對時間 (如 "剛剛", "2 分鐘前")
 * @param isoString - UTC ISO 8601 格式字串
 * @returns 相對時間字串
 */
export function formatRelative(isoString: string | undefined | null): string {
  if (!isoString) return '(無)'

  try {
    const date = new Date(isoString)
    if (isNaN(date.getTime())) return '(無)'

    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffSecs = Math.floor(diffMs / 1000)

    if (diffSecs < 60) return '剛剛'
    if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)} 分鐘前`
    if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)} 小時前`
    if (diffSecs < 604800) return `${Math.floor(diffSecs / 86400)} 天前`
    return `${Math.floor(diffSecs / 604800)} 週前`
  } catch {
    return '(無)'
  }
}
