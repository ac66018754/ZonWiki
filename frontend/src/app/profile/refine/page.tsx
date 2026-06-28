"use client";

import { ProfileShell, RefineSettingsSection } from "../profileShared";

/**
 * 個人頁 — 精煉成筆記設定子頁 /profile/refine
 *
 * 設定「精煉成筆記」的轉錄引擎（Gemini 預設 / Groq Whisper），Groq 需自填免費金鑰。
 * 內容區塊自行載入設定，故外殼不需 loading/error 狀態。
 */
export default function ProfileRefinePage() {
  return (
    <ProfileShell title="精煉成筆記" loading={false} error={null}>
      <RefineSettingsSection />
    </ProfileShell>
  );
}
