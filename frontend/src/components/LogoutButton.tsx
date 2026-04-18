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
    <button
      type="button"
      onClick={handleLogout}
      className="text-sm text-[var(--ink-mute)] hover:text-[var(--accent)]"
    >
      登出
    </button>
  );
}
