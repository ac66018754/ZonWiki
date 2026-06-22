import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { getArticle, getCurrentUser, listComments } from "@/lib/api";
import { buildToc } from "@/lib/toc";
import { ArticleView } from "@/components/ArticleView";
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

  // SSR 需把瀏覽器 cookie 轉發給 API，否則 getCurrentUser 取不到登入者、時區會落回預設。
  const cookieHeader = (await cookies()).toString();
  const [comments, user] = await Promise.all([
    listComments(article.id).catch(() => []),
    getCurrentUser(cookieHeader).catch(() => null),
  ]);

  const { html, toc } = buildToc(article.contentHtml);
  // 依使用者選定時區顯示（資料存 UTC）；未設定時退回台北時區。
  const updated = new Date(article.updatedDateTime).toLocaleString("zh-TW", {
    timeZone: user?.timeZone || "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="article">
      <article className="article__col">
        <nav className="crumb" aria-label="麵包屑">
          <Link href="/">所有筆記</Link>
          <span className="crumb__sep">/</span>
          <Link href={`/?cat=${encodeURIComponent(article.categoryId ?? "")}`}>
            {article.categoryName ?? "未分類"}
          </Link>
        </nav>

        <header className="article-head">
          <h1 className="article-head__title">{article.title}</h1>
          <div className="article-head__meta">
            <span>更新於 {updated}</span>
            <span className="article-head__path">{article.filePath}</span>
            <span>{article.commentCount} 則留言</span>
          </div>
        </header>

        <ArticleView
          slug={article.slug}
          title={article.title}
          html={html}
          toc={toc}
        >
          <hr className="article-rule" />
          <CommentSection
            articleId={article.id}
            initialComments={comments}
            currentUser={user}
          />
        </ArticleView>
      </article>
    </div>
  );
}
