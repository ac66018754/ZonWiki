# =============================================================================
# launch-backend-hidden.ps1
# 用途：以「隱藏視窗」方式把 start-backend.ps1 丟到背景常駐執行。
#       執行後本腳本立即返回，後端在無可見視窗的背景程序中運行（port 5009），
#       獨立於當前 session —— 關掉這個終端機也不會收掉後端。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\launch-backend-hidden.ps1
#
# 停止後端：
#   1) 找出佔用 5009 的 PID：  netstat -ano | findstr :5009
#   2) 連同程序樹一起終止：     taskkill /T /F /PID <PID>
#   （只殺外層 wrapper 不會釋放 port，務必用 /T 殺整棵樹）
# =============================================================================

$scriptDir = $PSScriptRoot
$target = Join-Path $scriptDir 'start-backend.ps1'

# -WindowStyle Hidden：不顯示視窗（背景化）
# 啟動後即與本程序解耦，獨立常駐
Start-Process `
    -FilePath 'powershell' `
    -WindowStyle Hidden `
    -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', $target
    )

Write-Output "後端已於背景啟動（隱藏視窗）。log: $(Join-Path (Split-Path -Parent $scriptDir) 'tmp\backend.log')"
Write-Output "驗證：curl http://localhost:5009/healthz  → 應回 Healthy（首次啟動需數秒編譯）"
