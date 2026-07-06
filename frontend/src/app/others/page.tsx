import { redirect } from "next/navigation";

/**
 * 「其他」功能群索引頁：Phase 1 唯一功能頁＝記帳，故直接 redirect 到 /others/expense。
 *
 * server component（不加 "use client"）：layout 已 force-dynamic（關閉 streaming），
 * redirect 於外殼 HTML 送出前生效，不會閃現空頁。
 */
export default function OthersIndexPage(): never {
  redirect("/others/expense");
}
