# =============================================================================
# start-backend.ps1
# 用途：以「隱藏視窗的背景程序」啟動 ZonWiki .NET 後端 API（port 5009）。
#       與前端（next start）、PostgreSQL（Docker 容器）一致 —— 不佔用終端機
#       視窗、獨立於任何 Claude / 終端機 session 常駐。
#
# 設計說明（重要決策，留給後人）：
#   - 為什麼不直接開一個 PowerShell 視窗跑 dotnet run？
#     因為那會佔用一個可見視窗，且容易讓人以為「關掉視窗 = 正常停服務」。
#     前端與 DB 都是無視窗背景程序，後端理當比照。
#   - 本腳本本身就是「在前景跑 dotnet run 並把輸出導到 log」；要做到「隱藏 +
#     背景」，請用同資料夾的 launch-backend-hidden.ps1 來呼叫它（Start-Process
#     -WindowStyle Hidden）。
#   - 編碼鐵則：明確指定 UTF-8，避免 Windows 預設 CP950 把中文 log 寫成亂碼。
# =============================================================================

# 跨界一律 UTF-8（避免中文 log 亂碼）
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# 專案根目錄（本腳本位於 <repo>\scripts，往上一層即 repo 根）
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

# log 檔（tmp 下，方便排查；採 append 保留歷史）
$logDir = Join-Path $repoRoot 'tmp'
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
}
$logPath = Join-Path $logDir 'backend.log'

# 啟動後端：dotnet run（建置一次後執行，非 watch，不會隨時間吃記憶體）
# *>> 會把 stdout/stderr 等所有串流附加到 log 檔
dotnet run --project src/ZonWiki.Api --launch-profile http *>> $logPath
