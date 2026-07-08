"use client";

import { useCallback, useEffect, useState } from "react";
import { getMyProfile, type MyProfile } from "@/lib/api";
import { useCurrentUser } from "@/lib/swr";
import { getDeviceTimeZone } from "@/lib/timezone";
import {
  ProfileShell,
  AccountInfoSection,
  ChangePasswordSection,
  TimeZoneSection,
  DangerZoneSection,
} from "./profileShared";

/**
 * 個人頁面 — 帳號資訊子頁 /profile
 *
 * 提供：帳號資訊（帳號、暱稱、建立時間、Google 綁定）、修改密碼、顯示時區（#7）、
 * 帳號操作（登出 / 刪除帳號）。統計、活動、快捷鍵已拆成獨立子頁，由左側欄導覽。
 */
export default function ProfileAccountPage() {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  // 目前登入者（時區顯示）改由共用的 SWR 快取取得，不再與個人資料一起手動抓。
  const { data: currentUser } = useCurrentUser();
  const tz = currentUser?.timeZone || getDeviceTimeZone();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 重新載入個人資料（暱稱變更後呼叫）
  const reloadProfile = useCallback(async () => {
    const p = await getMyProfile();
    setProfile(p);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const p = await getMyProfile();
        if (!p) {
          setLoadError("無法載入個人資料，請重新登入後再試。");
          return;
        }
        setProfile(p);
        setLoadError(null);
      } catch {
        setLoadError("無法載入個人資料，請稍後重試。");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <ProfileShell title="帳號資訊" loading={loading} error={loadError}>
      {profile && (
        <>
          <AccountInfoSection profile={profile} tz={tz} onChanged={reloadProfile} />
          <TimeZoneSection />
          <ChangePasswordSection />
          <DangerZoneSection />
        </>
      )}
    </ProfileShell>
  );
}
