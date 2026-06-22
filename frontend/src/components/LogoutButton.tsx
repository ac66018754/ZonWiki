"use client";

interface LogoutButtonProps {
  href: string;
}

export function LogoutButton({ href }: LogoutButtonProps) {
  async function handleLogout() {
    await fetch(href, {
      method: "POST",
      credentials: "include",
    });
    window.location.reload();
  }

  return (
    <button type="button" onClick={handleLogout} className="btn btn--ghost">
      登出
    </button>
  );
}
