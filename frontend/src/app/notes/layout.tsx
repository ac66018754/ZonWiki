/**
 * 筆記主功能頁佈局
 *
 * 包含左側欄（分類樹 + 標籤） + 主內容區
 * 這個佈局在 app/layout 的 sidebar + main-content 之外再建一層
 *
 * 同時掛載提問佇列浮動面板（用戶可從此跳轉到提問的來源筆記）。
 * 註：本佈局維持 server component 以保留 metadata 匯出；
 *     AskQueuePanel 自身是 client component（'use client'），server 佈局可直接 render。
 */

import type { Metadata } from 'next';
import { AskQueuePanel } from '@/components/AskQueuePanel';

export const metadata: Metadata = {
  title: '筆記 — ZonWiki',
  description: '管理、編輯、搜尋個人筆記與知識庫',
};

export default function NotesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <AskQueuePanel />
      {children}
    </>
  );
}
