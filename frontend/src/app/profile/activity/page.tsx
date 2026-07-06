"use client";

import { useEffect, useState } from "react";
import {
  getMyActivity,
  getActivityLog,
  type MyActivityDay,
  type ActivityLogEntry,
} from "@/lib/api";
import { useCurrentUser } from "@/lib/swr";
import { getDeviceTimeZone } from "@/lib/timezone";
import { ProfileShell, ActivitySection, ActivityDetailSection } from "../profileShared";

/**
 * 個人頁面 — 活動紀錄子頁 /profile/activity
 * 顯示近 30 天的每日活動匯總，以及逐筆操作明細（時間依使用者選定時區顯示）。
 */
export default function ProfileActivityPage() {
  const [activity, setActivity] = useState<MyActivityDay[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  // 時區顯示改由共用的 SWR 使用者快取取得，不再與活動資料一起手動抓。
  const { data: currentUser } = useCurrentUser();
  const tz = currentUser?.timeZone || getDeviceTimeZone();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [a, log] = await Promise.all([
          getMyActivity(30),
          getActivityLog(30, 200),
        ]);
        setActivity(a);
        setActivityLog(log);
        setError(null);
      } catch {
        setError("無法載入活動紀錄，請稍後重試。");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <ProfileShell title="活動紀錄" loading={loading} error={error}>
      <ActivitySection activity={activity} />
      <ActivityDetailSection log={activityLog} tz={tz} />
    </ProfileShell>
  );
}
