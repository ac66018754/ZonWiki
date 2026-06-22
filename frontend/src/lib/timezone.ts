/**
 * 時區工具：供個人頁時區選單與全站時間顯示使用。
 *
 * 規則：資料一律以 UTC 儲存；前端依「使用者選定的時區」換算顯示。
 * 使用者可在個人頁挑選時區（預設＝裝置時區，可改成例如 UTC+0）。
 */

/** 取得裝置（瀏覽器）目前的 IANA 時區字串；取不到時退回 Asia/Taipei。 */
export function getDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Taipei";
  } catch {
    return "Asia/Taipei";
  }
}

/**
 * 時區選單選項（以 UTC 偏移標示，方便辨識）。
 * 涵蓋常用區與整數偏移（UTC-12 ~ UTC+14 的代表性 IANA 區）。
 */
export const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "Pacific/Midway", label: "UTC-11（中途島）" },
  { value: "Pacific/Honolulu", label: "UTC-10（檀香山）" },
  { value: "America/Anchorage", label: "UTC-09（安克拉治）" },
  { value: "America/Los_Angeles", label: "UTC-08/-07（洛杉磯）" },
  { value: "America/Denver", label: "UTC-07/-06（丹佛）" },
  { value: "America/Chicago", label: "UTC-06/-05（芝加哥）" },
  { value: "America/New_York", label: "UTC-05/-04（紐約）" },
  { value: "America/Sao_Paulo", label: "UTC-03（聖保羅）" },
  { value: "UTC", label: "UTC+00（世界協調時間）" },
  { value: "Europe/London", label: "UTC+00/+01（倫敦）" },
  { value: "Europe/Paris", label: "UTC+01/+02（巴黎）" },
  { value: "Europe/Athens", label: "UTC+02/+03（雅典）" },
  { value: "Europe/Moscow", label: "UTC+03（莫斯科）" },
  { value: "Asia/Dubai", label: "UTC+04（杜拜）" },
  { value: "Asia/Karachi", label: "UTC+05（喀拉蚩）" },
  { value: "Asia/Kolkata", label: "UTC+05:30（加爾各答）" },
  { value: "Asia/Bangkok", label: "UTC+07（曼谷）" },
  { value: "Asia/Taipei", label: "UTC+08（台北）" },
  { value: "Asia/Shanghai", label: "UTC+08（上海）" },
  { value: "Asia/Hong_Kong", label: "UTC+08（香港）" },
  { value: "Asia/Tokyo", label: "UTC+09（東京）" },
  { value: "Australia/Sydney", label: "UTC+10/+11（雪梨）" },
  { value: "Pacific/Auckland", label: "UTC+12/+13（奧克蘭）" },
];
