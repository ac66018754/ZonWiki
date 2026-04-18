"use client";

import { useState } from "react";
import type { Comment, CurrentUser } from "@/lib/api";
import { loginUrl, postComment } from "@/lib/api";

interface CommentSectionProps {
  articleId: string;
  initialComments: Comment[];
  currentUser: CurrentUser | null;
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const created = await postComment(articleId, draft.trim());
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
    <section>
      <h2 className="text-xs font-mono uppercase tracking-widest text-[var(--ink-mute)] mb-4">
        Comments · {comments.length}
      </h2>

      <ul className="space-y-5 mb-8">
        {comments.length === 0 && (
          <li className="text-sm text-[var(--ink-mute)] italic">尚無留言</li>
        )}
        {comments.map((c) => (
          <li key={c.id} className="border-l-2 border-[var(--rule)] pl-4">
            <div className="flex items-baseline gap-3 mb-1">
              <span className="font-medium text-sm">{c.authorName}</span>
              <span className="text-xs font-mono text-[var(--ink-faint)]">
                {new Date(c.createdDateTime).toLocaleString("zh-TW")}
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap">{c.content}</p>
          </li>
        ))}
      </ul>

      {currentUser ? (
        <form onSubmit={handleSubmit} className="space-y-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="留言..."
            rows={3}
            className="w-full border border-[var(--rule)] rounded p-3 text-sm font-body bg-transparent focus:outline-none focus:border-[var(--accent)]"
            disabled={submitting}
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting || !draft.trim()}
              className="px-4 py-2 bg-[var(--ink)] text-[var(--bg-paper)] text-sm rounded disabled:opacity-50 hover:bg-[var(--accent)] transition-colors"
            >
              {submitting ? "送出中..." : "送出留言"}
            </button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-[var(--ink-mute)]">
          想留言?{" "}
          <a href={loginUrl(typeof window !== "undefined" ? window.location.pathname : "/")}
            className="text-[var(--accent)] underline">
            Google 登入
          </a>
        </p>
      )}
    </section>
  );
}
