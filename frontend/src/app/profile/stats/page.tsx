"use client";

import { useEffect, useState } from "react";
import { getMyStats, type MyStats } from "@/lib/api";
import { ProfileShell, StatsSection } from "../profileShared";

/**
 * 個人頁面 — 統計數據子頁 /profile/stats
 * 顯示各類資料筆數（筆記 / 任務 / 畫布 / 節點 / 常用連結 / 快速記錄 / 標籤 / 分類）。
 */
export default function ProfileStatsPage() {
  const [stats, setStats] = useState<MyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setStats(await getMyStats());
        setError(null);
      } catch {
        setError("無法載入統計數據，請稍後重試。");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <ProfileShell title="統計數據" loading={loading} error={error}>
      <StatsSection stats={stats} />
    </ProfileShell>
  );
}
