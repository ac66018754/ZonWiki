# scripts/ — 維運腳本

本目錄放與部署／維運相關的腳本。以下聚焦「正式環境 DB 備份自動化」。

> 決策背景見 `docs/DECISIONS.md`（2026-07-06「正式環境 DB 備份：VM → 本機每日 pg_dump（免費方案）」）。
> 採**免費**方案：VM 端 cron 每日 `pg_dump`＋gzip，本機定時拉回並保留數份；不使用付費的 GCS／磁碟快照。

## 備份鏈總覽

```
VM（GCP）                                   本機（Windows）
┌─────────────────────────────┐            ┌───────────────────────────┐
│ cron 每日 03:00               │  走 IAP    │ 工作排程器每日 13:00        │
│ scripts/backup-db.sh          │  加密通道  │ scripts/local/pull-backup  │
│  → pg_dump | gzip             │  ───────▶  │  .ps1 → scp 拉回最新一份    │
│  → ~/zonwiki/backup/*.sql.gz  │            │  → D:\Backups\ZonWiki\     │
│  → 保留最近 N 份              │            │  → 保留最近 N 份            │
└─────────────────────────────┘            └───────────────────────────┘
        VM 一份（本地）                          本機離線一份（異地備援）
```

---

## (a) VM 端每日備份：`scripts/backup-db.sh`

在 VM 上以 cron 每日執行，對 `zonwiki` 資料庫做 `pg_dump`（純 SQL）＋gzip，落地到
`~/zonwiki/backup/db-YYYY-MM-DD_HHMMSS.sql.gz`，只保留最近 N 份，成功／失敗都寫日誌並可打 webhook 告警。

### 啟用步驟（在 VM 上）

1. 把腳本放到 VM 並給執行權限（本機 → VM，走 IAP）：
   ```powershell
   # 本機 PowerShell（zone 依你的 VM 調整，遷移後為 asia-east1-b）
   gcloud compute scp .\scripts\backup-db.sh zonwiki:~/zonwiki/backup-db.sh --zone=asia-east1-b --tunnel-through-iap
   ```
   ```bash
   # VM 上
   chmod +x ~/zonwiki/backup-db.sh
   ```

2. 先手動跑一次驗證（會在 `~/zonwiki/backup/` 產出一個 `.sql.gz`）：
   ```bash
   ~/zonwiki/backup-db.sh
   ls -lh ~/zonwiki/backup/
   cat ~/zonwiki/backup/backup.log
   ```

3. 掛上 cron（每日 03:00 執行）：
   ```bash
   crontab -e
   ```
   加入這一行（`>> ...cron.log 2>&1` 讓 cron 環境下的輸出也留檔）：
   ```cron
   0 3 * * * /home/<你的使用者>/zonwiki/backup-db.sh >> /home/<你的使用者>/zonwiki/backup/cron.log 2>&1
   ```
   > cron 的環境變數很精簡，請用**絕對路徑**（`which docker` 找出 docker 路徑，必要時在腳本或 crontab 裡設 `PATH`）。

### 可調參數（環境變數，於 crontab 該行前面加 `VAR=值` 即可覆蓋）

| 變數 | 預設 | 說明 |
|------|------|------|
| `ZONWIKI_PG_CONTAINER` | 自動偵測名稱含 `postgres` 的容器 | PostgreSQL 容器名 |
| `ZONWIKI_DB_USER` / `ZONWIKI_DB_NAME` | `zonwiki` | DB 使用者／資料庫名 |
| `ZONWIKI_BACKUP_DIR` | `$HOME/zonwiki/backup` | 備份落地目錄 |
| `ZONWIKI_BACKUP_KEEP` | `14` | 保留份數 |
| `ZONWIKI_BACKUP_WEBHOOK` | 空 | 告警 webhook（成功／失敗都會打；留空則只寫日誌） |
| `ZONWIKI_BACKUP_LOG` | `<備份目錄>/backup.log` | 日誌檔 |

### 告警範例（可選）

若想在失敗時收到通知，設一個 Discord／Slack webhook：
```cron
0 3 * * * ZONWIKI_BACKUP_WEBHOOK='https://discord.com/api/webhooks/xxx' /home/<你>/zonwiki/backup-db.sh >> /home/<你>/zonwiki/backup/cron.log 2>&1
```

---

## (b) 本機定時拉回：`scripts/local/pull-backup.ps1`

> 位於 `scripts/local/`，**已被 `.gitignore` 忽略**（含 Prod／VM 細節，不進公開 repo）。

在本機用 Windows 工作排程器每天跑一次，走 IAP 把 VM 上「最新一份」備份拉回本機，
只保留最近 N 份（較舊者送進資源回收桶，可復原）。

### 啟用步驟（在本機）

1. 前置：本機已裝 `gcloud` CLI 並登入（`gcloud auth login`），且有該 VM 的 IAP／OS Login 權限。

2. 打開 `scripts/local/pull-backup.ps1`，確認頂端參數（`$Zone`、`$LocalRoot`、`$KeepCopies` 等）符合你的環境。
   > VM 於 2026-07-01 遷移到彰化，`$Zone` 預設 `asia-east1-b`；若仍在舊區請改回 `us-central1-a`。

3. 先手動跑一次驗證：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\local\pull-backup.ps1
   ```

4. 註冊工作排程器（每天 13:00 自動拉一次；時間、路徑可改）：
   ```powershell
   $action = New-ScheduledTaskAction `
       -Execute 'powershell.exe' `
       -Argument '-NoProfile -ExecutionPolicy Bypass -File "D:\Repos\SideProjects\ZonWiki\scripts\local\pull-backup.ps1"'
   $trigger = New-ScheduledTaskTrigger -Daily -At '13:00'
   Register-ScheduledTask `
       -TaskName 'ZonWiki-雲端DB備份拉回' `
       -Action  $action `
       -Trigger $trigger `
       -Description '每天從 GCP VM 拉回 ZonWiki 最新 DB 備份做本機離線備援'
   ```

---

## 還原（人工，DR 演練時）

備份是純 SQL + gzip，還原直接把它灌回容器內的 psql：

```bash
# 在 VM 上，還原到「臨時測試庫」驗證（不動到正式庫）
docker exec <postgres容器> createdb -U zonwiki zonwiki_restore_test
gunzip -c ~/zonwiki/backup/db-YYYY-MM-DD_HHMMSS.sql.gz \
  | docker exec -i <postgres容器> psql -U zonwiki -d zonwiki_restore_test
```

```powershell
# 在本機（已裝本機 postgres 容器 zonwiki-pg-verify），還原到測試庫驗證
docker exec zonwiki-pg-verify createdb -U zonwiki zonwiki_restore_test
Get-Content -Raw D:\Backups\ZonWiki\YYYY-MM-DD\db-XXXX.sql.gz  # 僅示意；請用下列 gunzip 管線
```
> 二進位／壓縮檔切勿用 PowerShell 的 `<`／`>` 重導（會插入 CRLF 搞壞內容）。
> 本機還原請在 WSL/Git Bash 用 `gunzip -c file.sql.gz | docker exec -i <容器> psql ...`，
> 或先 `gunzip` 解成 `.sql` 再 `docker cp` 進容器內 `psql -f`。

> ⚠️ 正式庫的實際還原一律由使用者本人操作（Claude 不部署／不動 prod 資料）。
> 提醒：AI 金鑰密文以 DataProtection 加密、金鑰存檔案系統（不在 DB），跨環境還原時金鑰卷需一致才解得開，詳見 `scripts/local/取得ProdDB密碼與倒回本機.md`。
