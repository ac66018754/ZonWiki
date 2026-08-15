/**
 * 筆記主功能頁佈局
 *
 * 包含左側欄（分類樹 + 標籤） + 主內容區
 * 這個佈局在 app/layout 的 sidebar + main-content 之外再建一層
 */

import type { Metadata } from 'next';

import { NOTES_DEFAULT_DOCUMENT_TITLE } from '@/lib/constants';

// 註：這是整個 /notes 子樹的靜態標題。筆記詳細頁（[...slug]）是用戶端元件，
// 無法使用 generateMetadata，改在載入筆記後以 document.title 覆寫成筆記標題。
export const metadata: Metadata = {
  title: NOTES_DEFAULT_DOCUMENT_TITLE,
  description: '管理、編輯、搜尋個人筆記與知識庫',
};

export default function NotesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
