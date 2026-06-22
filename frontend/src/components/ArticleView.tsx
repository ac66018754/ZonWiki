"use client";

import { useEffect, useState } from "react";
import type { TocItem } from "@/lib/toc";
import { FloatingPanel } from "./FloatingPanel";
import { useWorkspace } from "./Workspace";

interface ArticleViewProps {
  slug: string;
  title: string;
  /** Article HTML, already augmented with heading anchor ids. */
  html: string;
  toc: TocItem[];
  children?: React.ReactNode;
}

function scrollToHeading(id: string) {
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * Client shell for an article: renders the prose, a draggable floating
 * table-of-contents with scroll-spy, and registers the article as an open tab.
 */
export function ArticleView({
  slug,
  title,
  html,
  toc,
  children,
}: ArticleViewProps) {
  const { registerTab } = useWorkspace();
  const [activeId, setActiveId] = useState<string | null>(toc[0]?.id ?? null);

  useEffect(() => {
    registerTab({ slug, title });
  }, [slug, title, registerTab]);

  useEffect(() => {
    if (toc.length === 0) return;
    const headings = toc
      .map((t) => document.getElementById(t.id))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          );
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -65% 0px", threshold: 0 },
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [toc]);

  return (
    <>
      {toc.length > 0 && (
        <FloatingPanel
          id="toc"
          title="目錄"
          defaultPos={{ x: 99999, y: 70 }}
          width={234}
        >
          <div className="toc">
            {toc.map((item) => (
              <button
                key={item.id}
                type="button"
                className="toc-item"
                data-level={item.level}
                data-active={item.id === activeId}
                onClick={() => scrollToHeading(item.id)}
              >
                {item.text}
              </button>
            ))}
          </div>
        </FloatingPanel>
      )}

      <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />
      {children}
    </>
  );
}
