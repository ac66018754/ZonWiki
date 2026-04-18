import Link from "next/link";
import { listArticles, listCategories } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [categories, articles] = await Promise.all([
    listCategories(),
    listArticles(),
  ]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-[14rem_1fr] gap-10">
      <aside className="lg:sticky lg:top-6 self-start">
        <h2 className="text-xs font-mono uppercase tracking-widest text-[var(--ink-mute)] mb-3">
          Categories
        </h2>
        <ul className="space-y-1.5 text-sm">
          {categories.length === 0 && (
            <li className="text-[var(--ink-mute)] italic">尚無分類</li>
          )}
          {categories.map((c) => (
            <li key={c.id}>
              <span
                className="text-[var(--ink)] hover:text-[var(--accent)] cursor-default"
                style={{
                  paddingLeft: `${(c.folderPath.split("/").length - 1) * 0.75}rem`,
                }}
              >
                {c.name}
                <span className="ml-2 text-[var(--ink-faint)] font-mono text-xs">
                  {c.articleCount}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </aside>

      <section>
        <header className="mb-8">
          <h1 className="text-4xl font-bold tracking-tight mb-2">所有筆記</h1>
          <p className="text-[var(--ink-mute)]">
            {articles.length} 篇文章 · 真相來源是檔案系統
          </p>
        </header>

        {articles.length === 0 ? (
          <p className="text-[var(--ink-mute)]">
            尚無文章。請確認 API 已執行 sync 並指向正確的筆記資料夾。
          </p>
        ) : (
          <ul className="divide-y divide-[var(--rule)]">
            {articles.map((a) => (
              <li key={a.id} className="py-4">
                <Link href={`/a/${a.slug}`} className="block group">
                  <h3 className="text-lg font-medium group-hover:text-[var(--accent)]">
                    {a.title}
                  </h3>
                  <p className="text-xs font-mono text-[var(--ink-faint)] mt-1">
                    {a.filePath}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
