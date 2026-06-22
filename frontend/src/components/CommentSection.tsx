"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import type { Comment, CurrentUser } from "@/lib/api";
import { loginUrl, postComment } from "@/lib/api";
import { formatDateTime } from "@/lib/formatters";
import { DEFAULT_TIMEZONE } from "@/lib/constants";

interface CommentSectionProps {
  articleId: string;
  initialComments: Comment[];
  currentUser: CurrentUser | null;
}

/**
 * 格式化留言時間，使用用戶自訂時區
 * @param iso UTC 日期字串 (ISO 8601)
 * @param userTimeZone 用戶時區 (IANA)，預設為 Asia/Taipei
 * @returns 格式化後的時間字串 (MM/DD HH:mm)
 */
function formatCommentTime(
  iso: string,
  userTimeZone: string = DEFAULT_TIMEZONE
): string {
  return formatDateTime(iso, userTimeZone);
}

export function CommentSection({
  articleId,
  initialComments,
  currentUser,
}: CommentSectionProps) {
  const [comments, setComments] = useState<Comment[]>(initialComments);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;

    setSubmitting(true);
    setError(null);
    try {
      const created = await postComment(articleId, content);
      if (created) {
        setComments((prev) => [...prev, created]);
        setDraft("");
      } else {
        setError("留言失敗，請確認你已登入。");
      }
    } catch {
      setError("送出留言時發生錯誤。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="comments">
      <h2 className="eyebrow comments__title">留言 · {comments.length}</h2>

      <ul className="comment-list">
        {comments.length === 0 && (
          <li className="comment-empty">還沒有留言，成為第一個。</li>
        )}
        {comments.map((c) => (
          <li key={c.id} className="comment">
            <span className="comment__avatar" aria-hidden="true">
              {c.authorName.trim().charAt(0) || "?"}
            </span>
            <div className="comment__main">
              <div className="comment__head">
                <span className="comment__author">{c.authorName}</span>
                <span className="comment__time">
                  {formatCommentTime(c.createdDateTime, currentUser?.timeZone)}
                </span>
              </div>
              <p className="comment__body">{c.content}</p>
            </div>
          </li>
        ))}
      </ul>

      {currentUser ? (
        <form className="comment-form" onSubmit={handleSubmit}>
          <textarea
            className="comment-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="寫下你的想法…"
            rows={3}
            disabled={submitting}
            aria-label="留言內容"
          />
          {error && <p className="comment-error">{error}</p>}
          <div className="comment-form__foot">
            <button
              type="submit"
              className="btn btn--accent"
              disabled={submitting || !draft.trim()}
            >
              {submitting ? "送出中…" : "送出留言"}
            </button>
          </div>
        </form>
      ) : (
        <p className="comment-login">
          想留言？ <a href={loginUrl(pathname)}>登入</a>
        </p>
      )}
    </section>
  );
}
