const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5009";

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string | null;
  statusCode?: number;
}

export interface Category {
  id: string;
  parentId: string | null;
  name: string;
  folderPath: string;
  articleCount: number;
}

export interface ArticleSummary {
  id: string;
  categoryId: string;
  title: string;
  slug: string;
  filePath: string;
  updatedDateTime: string;
}

export interface ArticleDetail {
  id: string;
  categoryId: string;
  categoryName: string;
  title: string;
  slug: string;
  filePath: string;
  contentHtml: string;
  createdDateTime: string;
  updatedDateTime: string;
  commentCount: number;
}

export interface Comment {
  id: string;
  articleId: string;
  userId: string;
  authorName: string;
  authorAvatarUrl?: string | null;
  content: string;
  createdDateTime: string;
}

export interface CurrentUser {
  userId?: string;
  email?: string;
  displayName?: string;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok && res.status !== 401 && res.status !== 404) {
    throw new Error(`API ${path} failed with ${res.status}`);
  }
  return (await res.json()) as ApiResponse<T>;
}

export async function listCategories(): Promise<Category[]> {
  const r = await fetchJson<Category[]>("/api/categories");
  return r.data ?? [];
}

export async function listArticles(categoryId?: string): Promise<ArticleSummary[]> {
  const path = categoryId ? `/api/articles?categoryId=${categoryId}` : "/api/articles";
  const r = await fetchJson<ArticleSummary[]>(path);
  return r.data ?? [];
}

export async function getArticle(slug: string[]): Promise<ArticleDetail | null> {
  const joined = slug.map(encodeURIComponent).join("/");
  const r = await fetchJson<ArticleDetail>(`/api/articles/${joined}`);
  return r.data ?? null;
}

export async function listComments(articleId: string): Promise<Comment[]> {
  const r = await fetchJson<Comment[]>(`/api/articles/${articleId}/comments`);
  return r.data ?? [];
}

export async function postComment(articleId: string, content: string): Promise<Comment | null> {
  const r = await fetchJson<Comment>(`/api/articles/${articleId}/comments`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
  return r.data ?? null;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const r = await fetchJson<CurrentUser>("/api/me");
    return r.success ? r.data ?? null : null;
  } catch {
    return null;
  }
}

export function loginUrl(returnUrl = "/"): string {
  return `${API_BASE}/api/auth/login?returnUrl=${encodeURIComponent(returnUrl)}`;
}

export function logoutUrl(): string {
  return `${API_BASE}/api/auth/logout`;
}
