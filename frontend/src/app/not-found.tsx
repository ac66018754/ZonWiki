import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page">
      <div className="page__col not-found">
        <span className="eyebrow">404 · NOT FOUND</span>
        <h1 className="display-xl">找不到這篇筆記</h1>
        <p className="not-found__text">
          它可能已被移動、改名，或還沒同步進工作區。
        </p>
        <Link href="/" className="btn btn--accent">
          回到所有筆記
        </Link>
      </div>
    </div>
  );
}
