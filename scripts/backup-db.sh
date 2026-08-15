#!/usr/bin/env bash
# ============================================================================
# backup-db.sh — 正式環境（GCP VM）每日 PostgreSQL 自動備份腳本
# ----------------------------------------------------------------------------
# 用途：
#   在 VM 上以 cron 每日執行，對 zonwiki 資料庫做一份 pg_dump（純 SQL）並 gzip
#   壓縮，落地到 backup/ 目錄；只保留最近 N 份，較舊者自動輪替刪除。
#   成功／失敗都會寫日誌，並可選擇性地打 webhook 告警（避免「備份沒跑卻沒人知道」）。
#
# 設計依據：docs/DECISIONS.md（2026-07-06「正式環境 DB 備份：VM → 本機每日 pg_dump」）
#   —— 完全在 GCP 免費額度內，不用付費的 GCS／磁碟快照。
#
# 機制：
#   PostgreSQL 跑在 docker 容器裡（image: postgres:16-alpine），本腳本用
#   `docker exec <容器> pg_dump ...`（容器內走 unix socket、trust 驗證，免密碼），
#   把輸出以管線接 gzip 壓成 db-YYYY-MM-DD_HHMMSS.sql.gz。
#
# 還原（人工）：
#   gunzip -c db-XXXX.sql.gz | docker exec -i <容器> psql -U zonwiki -d zonwiki
#
# 安裝（crontab）與詳細說明見：scripts/README.md
# ============================================================================

# 任何未定義變數、任何指令失敗、任何管線中段失敗都立即中止（避免半套備份被誤判成功）。
set -euo pipefail

# ========= 可調參數（依你的 VM 環境調整這幾行）=============================
# PostgreSQL 容器名；留空則自動偵測名稱含 "postgres" 的第一個容器。
CONTAINER_NAME="${ZONWIKI_PG_CONTAINER:-}"
# 資料庫使用者與資料庫名（本專案 user 與 db 同名）。
DB_USER="${ZONWIKI_DB_USER:-zonwiki}"
DB_NAME="${ZONWIKI_DB_NAME:-zonwiki}"
# 備份落地目錄（預設放在執行使用者家目錄下的 zonwiki/backup）。
BACKUP_DIR="${ZONWIKI_BACKUP_DIR:-$HOME/zonwiki/backup}"
# 保留份數：超過的較舊備份會被輪替刪除。
KEEP_COPIES="${ZONWIKI_BACKUP_KEEP:-14}"
# App_Data（筆記附件圖檔等）容器名與容器內路徑：附件存磁碟不在 DB 裡，
# 必須跟 DB 一起備份，還原時兩者缺一不可（DB 只有中繼資料、檔案在 App_Data）。
# API 容器名；留空則自動偵測名稱含 "api" 的第一個容器；設為 "skip" 可明確停用附件備份。
API_CONTAINER_NAME="${ZONWIKI_API_CONTAINER:-}"
# 容器內的 App_Data 路徑（compose 掛卷位置）。
APPDATA_CONTAINER_PATH="${ZONWIKI_APPDATA_PATH:-/app/App_Data}"
# 選填：失敗（或成功）時要打的告警 webhook（例如 Discord／Slack／自建端點）。
#   留空則不打；只寫日誌。POST body 為純文字訊息。
ALERT_WEBHOOK="${ZONWIKI_BACKUP_WEBHOOK:-}"
# 日誌檔（append）。
LOG_FILE="${ZONWIKI_BACKUP_LOG:-$BACKUP_DIR/backup.log}"
# ==========================================================================

# --- 小工具：一律 UTF-8、帶時間戳寫日誌（同時輸出到 stderr 供 cron 郵件收集）---
log() {
    # 參數 $*：要記錄的訊息（繁中）。
    local timestamp
    timestamp="$(date '+%Y-%m-%d %H:%M:%S%z')"
    printf '%s | %s\n' "$timestamp" "$*" | tee -a "$LOG_FILE" >&2
}

# --- 告警：把訊息送到 webhook（若有設定）。失敗不影響主流程。 ---------------
send_alert() {
    # 參數 $1：告警訊息（繁中）。
    local message="$1"
    if [[ -z "$ALERT_WEBHOOK" ]]; then
        return 0
    fi
    # --data 用 UTF-8 純文字；連不到告警端點時不讓整支腳本掛掉。
    curl --silent --show-error --max-time 15 \
        --header 'Content-Type: text/plain; charset=utf-8' \
        --data "$message" \
        "$ALERT_WEBHOOK" >/dev/null 2>&1 \
        || log "告警送出失敗（webhook 連線異常，已略過）：$ALERT_WEBHOOK"
}

# --- 失敗時的統一收尾：寫日誌 + 告警 + 以非零碼結束 -------------------------
fail() {
    # 參數 $1：失敗原因（繁中）。
    local reason="$1"
    log "備份失敗：$reason"
    send_alert "[ZonWiki 備份失敗] $reason（主機：$(hostname)）"
    exit 1
}

# --- 自動偵測 PostgreSQL 容器名（當未指定 CONTAINER_NAME 時）----------------
resolve_container() {
    if [[ -n "$CONTAINER_NAME" ]]; then
        printf '%s' "$CONTAINER_NAME"
        return 0
    fi
    # 取第一個名稱含 postgres 的執行中容器。
    docker ps --format '{{.Names}}' | grep -i postgres | head -n 1
}

main() {
    # 備份目錄不存在就建立（-p：多層一次建、已存在不報錯）。
    mkdir -p "$BACKUP_DIR"

    local container
    # `|| true`：避免 grep 找不到容器（回傳非零）時，set -e 在此提前中止、跳過下面的友善錯誤訊息。
    container="$(resolve_container)" || true
    if [[ -z "$container" ]]; then
        fail "找不到 PostgreSQL 容器（請設定 ZONWIKI_PG_CONTAINER 或確認容器已啟動）"
    fi

    # 檔名帶秒級時間戳，避免同日多次執行互相覆蓋。
    local stamp
    stamp="$(date '+%Y-%m-%d_%H%M%S')"
    local target_file="$BACKUP_DIR/db-${stamp}.sql.gz"
    # 先寫到 .partial，全部成功才改名 —— 避免中途失敗留下「看起來完整」的半套檔。
    local partial_file="${target_file}.partial"

    log "開始備份：容器=$container 資料庫=$DB_NAME → $target_file"

    # pg_dump（純 SQL）| gzip；set -o pipefail 已開，pg_dump 失敗會讓整條管線失敗。
    if ! docker exec "$container" \
            pg_dump --username="$DB_USER" --format=plain "$DB_NAME" \
            | gzip --best -c > "$partial_file"; then
        rm -f "$partial_file"
        fail "pg_dump／gzip 執行失敗（容器=$container）"
    fi

    # 驗證產物：gzip 完整性 + 檔案非空（防「壓出 0 byte 卻回傳成功」）。
    if ! gzip --test "$partial_file" 2>/dev/null; then
        rm -f "$partial_file"
        fail "產出的 gzip 檔完整性驗證未通過：$partial_file"
    fi
    if [[ ! -s "$partial_file" ]]; then
        rm -f "$partial_file"
        fail "產出的備份檔為空（0 byte）：$partial_file"
    fi

    # 全數通過才落定正式檔名。
    mv "$partial_file" "$target_file"
    local size_human
    size_human="$(du -h "$target_file" | cut -f1)"
    log "備份成功：$target_file（大小 $size_human）"

    # --- App_Data（筆記附件）備份：附件檔不在 DB 裡，必須一起備 ---------------
    # 失敗只告警不中止（DB 備份已成功落地，附件下一輪再補）。
    backup_appdata || log "App_Data 備份失敗（DB 備份不受影響，詳見上方訊息）"

    # --- 輪替：只保留最近 KEEP_COPIES 份，較舊者刪除 ------------------------
    # 備份檔為壓縮產物、非產品資料，屬正常備份輪替（不受軟刪除鐵則約束）。
    rotate_old_backups

    send_alert "[ZonWiki 備份成功] $target_file（$size_human，主機：$(hostname)）"
}

# --- App_Data（筆記附件圖檔）備份：docker exec tar | gzip → files-*.tar.gz ---
backup_appdata() {
    if [[ "$API_CONTAINER_NAME" == "skip" ]]; then
        log "App_Data 備份已停用（ZONWIKI_API_CONTAINER=skip）"
        return 0
    fi

    # 解析 API 容器：未指定則取第一個名稱含 api 的執行中容器。
    local api_container
    api_container="$API_CONTAINER_NAME"
    if [[ -z "$api_container" ]]; then
        api_container="$(docker ps --format '{{.Names}}' | grep -i api | head -n 1)" || true
    fi
    if [[ -z "$api_container" ]]; then
        log "找不到 API 容器，略過 App_Data 備份（可設 ZONWIKI_API_CONTAINER 指定）"
        send_alert "[ZonWiki 備份警告] 找不到 API 容器，本輪未備份附件（主機：$(hostname)）"
        return 1
    fi

    # 容器內沒有 App_Data（尚無任何附件）→ 視為正常，略過。
    if ! docker exec "$api_container" test -d "$APPDATA_CONTAINER_PATH" 2>/dev/null; then
        log "容器 $api_container 內無 $APPDATA_CONTAINER_PATH（尚無附件），略過"
        return 0
    fi

    local stamp
    stamp="$(date '+%Y-%m-%d_%H%M%S')"
    local files_target="$BACKUP_DIR/files-${stamp}.tar.gz"
    local files_partial="${files_target}.partial"

    log "開始備份附件：容器=$api_container 路徑=$APPDATA_CONTAINER_PATH → $files_target"
    # tar 打包容器內整個 App_Data（-C 讓還原時解出相對的 App_Data/ 結構）。
    if ! docker exec "$api_container" tar -cf - -C "$(dirname "$APPDATA_CONTAINER_PATH")" "$(basename "$APPDATA_CONTAINER_PATH")" \
            | gzip --best -c > "$files_partial"; then
        rm -f "$files_partial"
        send_alert "[ZonWiki 備份警告] 附件 tar/gzip 失敗（主機：$(hostname)）"
        return 1
    fi
    if ! gzip --test "$files_partial" 2>/dev/null || [[ ! -s "$files_partial" ]]; then
        rm -f "$files_partial"
        send_alert "[ZonWiki 備份警告] 附件備份檔驗證未通過（主機：$(hostname)）"
        return 1
    fi
    mv "$files_partial" "$files_target"
    log "附件備份成功：$files_target（大小 $(du -h "$files_target" | cut -f1)）"
    return 0
}

# --- 輪替舊備份：依修改時間排序，DB 與附件兩類各保留最新 N 份 -----------------
rotate_old_backups() {
    rotate_pattern 'db-*.sql.gz'
    rotate_pattern 'files-*.tar.gz'
}

# --- 輪替單一檔名樣式：跳過最新 KEEP_COPIES 份、刪掉其餘 ---------------------
rotate_pattern() {
    # 參數 $1：檔名 glob 樣式（如 db-*.sql.gz）。
    local pattern="$1"
    local old_files
    old_files="$(
        find "$BACKUP_DIR" -maxdepth 1 -type f -name "$pattern" -printf '%T@ %p\n' \
            | sort -rn \
            | tail -n "+$((KEEP_COPIES + 1))" \
            | cut -d' ' -f2-
    )" || true
    if [[ -z "$old_files" ]]; then
        return 0
    fi
    while IFS= read -r old; do
        [[ -z "$old" ]] && continue
        rm -f "$old" && log "已輪替刪除舊備份：$old"
    done <<< "$old_files"
}

main "$@"
