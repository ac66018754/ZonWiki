import Link from "next/link";
import { getCurrentUser, loginUrl, logoutUrl } from "@/lib/api";
import { LogoutButton } from "./LogoutButton";

export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="border-b border-[var(--rule)] bg-[var(--bg-paper)]">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-baseline gap-3">
          <span className="text-2xl font-bold tracking-tight">ZonWiki</span>
          <span className="text-xs font-mono text-[var(--ink-mute)] hidden sm:inline">
            personal wiki · v0
          </span>
        </Link>

        <nav className="flex items-center gap-6 text-sm">
          <Link href="/" className="hover:text-[var(--accent)]">
            首頁
          </Link>
          {user ? (
            <div className="flex items-center gap-3">
              <span className="text-[var(--ink-mute)] hidden sm:inline">
                {user.displayName ?? user.email}
              </span>
              <LogoutButton href={logoutUrl()} />
            </div>
          ) : (
            <a
              href={loginUrl("/")}
              className="px-3 py-1.5 border border-[var(--ink)] rounded hover:bg-[var(--ink)] hover:text-[var(--bg-paper)] transition-colors text-sm"
            >
              Google 登入
            </a>
          )}
        </nav>
      </div>
    </header>
  );
}
