/**
 * 筆記主功能頁佈局
 *
 * 包含左側欄（分類樹 + 標籤） + 主內容區
 * 這個佈局在 app/layout 的 sidebar + main-content 之外再建一層
 */

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '筆記 — ZonWiki',
  description: '管理、編輯、搜尋個人筆記與知識庫',
};

export default function NotesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
