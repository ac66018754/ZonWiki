"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { closeMobileNav } from "@/lib/mobileNav";

/**
 * 行動版「區段導覽」區塊（只在手機斷點顯示，桌機以 CSS 隱藏）。
 *
 * 桌機的區段切換在 Header 的 .nav；但手機斷點 .nav 會被隱藏，
 * 故把區段連結放進側欄抽屜頂端，讓手機使用者仍能在各區段間切換。
 * 此區塊會出現在每一種側欄變體（筆記 / 任務 / 行事曆 / 首頁・畫布）頂端。
 */

/** 區段導覽項目（路徑與顯示名稱）。 */
const SECTIONS: { href: string; label: string; icon: string }[] = [
  { href: "/", label: "首頁", icon: "🏠" },
  { href: "/tasks", label: "日程規劃", icon: "🗓️" },
  { href: "/canvas", label: "開問啦", icon: "🎨" },
  { href: "/notes", label: "筆記", icon: "📝" },
  { href: "/others", label: "其他", icon: "🧰" },
  { href: "/trash", label: "垃圾桶", icon: "🗑️" },
];

/**
 * 行動版區段導覽。
 * @returns 區段連結清單（點擊後關閉抽屜）。
 */
export function MobileSectionNav() {
  const pathname = usePathname();

  /**
   * 判斷某區段是否為目前頁面（首頁需完全相符，其餘以前綴比對）。
   * @param href 區段路徑。
   * @returns 為目前區段則回傳 true。
   */
  const isActive = (href: string): boolean =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav className="mobnav-sections" aria-label="區段導覽">
      {SECTIONS.map((s) => (
        <Link
          key={s.href}
          href={s.href}
          className={`mobnav-section-link ${isActive(s.href) ? "mobnav-section-link--active" : ""}`}
          onClick={closeMobileNav}
        >
          <span aria-hidden="true">{s.icon}</span>
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
