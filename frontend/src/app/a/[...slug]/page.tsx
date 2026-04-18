import { notFound } from "next/navigation";
import Link from "next/link";
import { getArticle, getCurrentUser, listComments } from "@/lib/api";
import { CommentSection } from "@/components/CommentSection";

export const dynamic = "force-dynamic";

interface ArticlePageProps {
  params: Promise<{ slug: string[] }>;
}

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { slug } = await params;
  const article = await getArticle(slug);

  if (!article) {
    notFound();
  }

  const [comments, user] = await Promise.all([
    listComments(article.id),
    getCurrentUser(),
  ]);

  const updated = new Date(article.updatedDateTime).toLocaleString("zh-TW");

  return (
    <article className="max-w-3xl mx-auto px-6 py-10">
      <nav className="text-xs font-mono text-[var(--ink-mute)] mb-4">
        <Link href="/" className="hover:text-[var(--accent)]">
          ← 首頁
        </Link>
        <span className="mx-2">/</span>
        <span>{article.categoryName}</span>
      </nav>

      <header className="mb-8 pb-6 border-b border-[var(--rule)]">
        <h1 className="text-4xl font-bold tracking-tight mb-3 leading-tight">
          {article.title}
        </h1>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono text-[var(--ink-mute)]">
          <span>updated {updated}</span>
          <span>· {article.filePath}</span>
        </div>
      </header>

      <div
        className="prose"
        dangerouslySetInnerHTML={{ __html: article.contentHtml }}
      />

      <hr className="my-12 border-[var(--rule)]" />

      <CommentSection
        articleId={article.id}
        initialComments={comments}
        currentUser={user}
      />
    </article>
  );
}
