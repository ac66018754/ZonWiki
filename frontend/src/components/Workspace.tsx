"use client";

import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ArticleSummary, Category, CurrentUser } from "@/lib/api";
import { loginUrl, logoutUrl } from "@/lib/api";
import { FloatingPanel } from "./FloatingPanel";
import { CategoryPanel } from "./CategoryPanel";
import { CommandPalette } from "./CommandPalette";
import { LogoutButton } from "./LogoutButton";
import { CloseIcon, MoonIcon, SearchIcon, SunIcon } from "./Icons";

export interface TabEntry {
  slug: string;
  title: string;
}

interface WorkspaceContextValue {
  registerTab: (tab: TabEntry) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within <Workspace>");
  }
  return ctx;
}

const TABS_KEY = "zonwiki:tabs";
const THEME_KEY = "zonwiki:theme";
const MAX_TABS = 8;

function loadTabs(): TabEntry[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TABS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t): t is TabEntry =>
          !!t && typeof t.slug === "string" && typeof t.title === "string",
      )
      .slice(0, MAX_TABS);
  } catch {
    return [];
  }
}

interface WorkspaceProps {
  categories: Category[];
  articles: ArticleSummary[];
  user: CurrentUser | null;
  children: React.ReactNode;
}

export function Workspace({
  categories,
  articles,
  user,
  children,
}: WorkspaceProps) {
  const pathname = usePathname();
  const [tabs, setTabs] = useState<TabEntry[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const decodedPath = useMemo(() => {
    try {
      return decodeURIComponent(pathname);
    } catch {
      return pathname;
    }
  }, [pathname]);

  // Open tabs live in localStorage; hydrate once after mount so the server
  // and first client render agree (an empty strip).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-time client hydration
    setTabs(loadTabs());
  }, []);

  const registerTab = useCallback((tab: TabEntry) => {
    setTabs((prev) => {
      const next = [tab, ...prev.filter((t) => t.slug !== tab.slug)].slice(
        0,
        MAX_TABS,
      );
      try {
        window.localStorage.setItem(TABS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const closeTab = useCallback((slug: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.slug !== slug);
      try {
        window.localStorage.setItem(TABS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Global ⌘K / Ctrl+K to open the command palette.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Theme is reflected purely through the [data-theme] attribute — the icon
  // swap is CSS-driven, so no React state (and no hydration concern).
  function toggleTheme() {
    const root = document.documentElement;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      /* ignore */
    }
  }

  return (
    <WorkspaceContext.Provider value={{ registerTab }}>
      <header className="topbar">
        <Link href="/" className="brand-mark" aria-label="ZonWiki 首頁">
          <span className="brand-glyph">Z</span>
          <span className="hide-sm">ZonWiki</span>
        </Link>

        <div className="tabstrip scroll-thin" aria-label="開啟的筆記">
          {tabs.map((t) => {
            const isActive = decodedPath === `/a/${t.slug}`;
            return (
              <div
                key={t.slug}
                className={`tab${isActive ? " tab--active" : ""}`}
              >
                <Link href={`/a/${t.slug}`} className="tab__link" title={t.title}>
                  {isActive && <span className="tab__dot" />}
                  <span className="tab__label">{t.title}</span>
                </Link>
                <button
                  type="button"
                  className="tab__close"
                  onClick={() => closeTab(t.slug)}
                  aria-label={`關閉 ${t.title}`}
                >
                  <CloseIcon size={12} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="topbar-actions">
          <button
            type="button"
            className="topbar-search"
            onClick={() => setPaletteOpen(true)}
          >
            <SearchIcon size={15} />
            <span className="hide-sm">跳轉筆記</span>
            <span className="kbd hide-sm">⌘K</span>
          </button>

          <button
            type="button"
            className="icon-btn icon-btn--lg"
            onClick={toggleTheme}
            aria-label="切換深色 / 淺色"
          >
            <SunIcon size={16} className="theme-ico theme-ico--sun" />
            <MoonIcon size={16} className="theme-ico theme-ico--moon" />
          </button>

          <span className="topbar-div" aria-hidden="true" />

          {user ? (
            <div className="topbar-user">
              <span className="topbar-user__name hide-sm">
                {user.displayName ?? user.email}
              </span>
              <LogoutButton href={logoutUrl()} />
            </div>
          ) : (
            <a className="btn btn--accent" href={loginUrl("/")}>
              Google 登入
            </a>
          )}
        </div>
      </header>

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          categories={categories}
          articles={articles}
        />
      )}

      <main className="canvas scroll-thin">
        <div className="dock-zone">
          <FloatingPanel
            id="categories"
            title={`分類 · ${categories.length}`}
            defaultPos={{ x: 22, y: 70 }}
          >
            <Suspense fallback={null}>
              <CategoryPanel categories={categories} total={articles.length} />
            </Suspense>
          </FloatingPanel>
        </div>
        {children}
      </main>
    </WorkspaceContext.Provider>
  );
}
