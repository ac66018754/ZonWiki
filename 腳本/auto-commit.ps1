# ============================================================================
# 自動 Commit + Push 腳本 - 使用 Gemini API 生成 commit message
# ============================================================================
# 用途：git add . → Gemini 產生 commit message → git commit → git push
# 使用：.\auto-commit.ps1              # 預設會要你確認
#       .\auto-commit.ps1 -Yes         # 跳過確認
#       .\auto-commit.ps1 -NoPush      # 不推送到 remote
# ============================================================================

param(
    [string]$ApiKey = $env:GEMINI_API_KEY,
    [string]$Model = "gemini-2.5-flash",
    [switch]$Yes,
    [switch]$NoPush,
    [int]$MaxDiffChars = 30000  # 超過就截斷，避免送過大的 payload
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{0}:generateContent" -f $Model

# ============================================================================
# 工具函數
# ============================================================================

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $color = @{
        "INFO"    = "Cyan"
        "SUCCESS" = "Green"
        "WARNING" = "Yellow"
        "ERROR"   = "Red"
    }
    Write-Host "[$timestamp] [$Level] $Message" -ForegroundColor $color[$Level]
}

function Get-GitDiffSummary {
    # --stat: 檔案變更統計概要
    $stat = & git -c core.quotePath=false diff --cached --stat
    return ($stat -join "`n")
}

function Get-GitDiffFull {
    param([int]$MaxChars)

    $diff = & git -c core.quotePath=false diff --cached
    $diffText = ($diff -join "`n")

    if ($diffText.Length -gt $MaxChars) {
        $diffText = $diffText.Substring(0, $MaxChars) + "`n...（diff 已截斷，超過 $MaxChars 字元）"
        Write-Log "diff 內容過大，截斷至 $MaxChars 字元" "WARNING"
    }
    return $diffText
}

function Invoke-GeminiCommitMessage {
    param(
        [string]$DiffSummary,
        [string]$DiffFull
    )

    $systemPrompt = @"
你是一個 Git commit message 專家。根據用戶提供的 git diff，產生一條簡潔、符合 Conventional Commits 規範的 commit message。

**格式要求**：
<type>: <description>

**type 必須是以下其中之一**：
- feat: 新功能
- fix: bug 修復
- refactor: 重構（不改變外部行為）
- docs: 文件或筆記更新
- test: 測試相關
- chore: 瑣事（建置、設定、相依套件）
- perf: 效能優化
- ci: CI/CD

**description 規則**：
- 用繁體中文（除非 diff 內容本身就是英文為主）
- 不超過 60 字
- 用祈使句、現在式（例如「新增 X」而非「新增了 X」）
- 具體描述「改了什麼」，避免空泛（例如「更新檔案」是不好的）
- 結尾不加句號

**輸出要求**：
- 只回傳 commit message 一行，不要加引號、說明、markdown 包裹或任何其他文字
- 不要換行，只有一行
"@

    $diffBlock = "diff --stat 概要：`n$DiffSummary`n`n完整 diff：`n$DiffFull"

    Add-Type -AssemblyName System.Web.Extensions -ErrorAction SilentlyContinue
    $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $serializer.MaxJsonLength = [int]::MaxValue

    $textContent = [string]($systemPrompt + "`n`n" + $diffBlock)
    $textJson = $serializer.Serialize($textContent)

    $requestBody = @"
{
  "contents": [
    {
      "role": "user",
      "parts": [
        { "text": $textJson }
      ]
    }
  ],
  "generationConfig": {
    "temperature": 0.2,
    "thinkingConfig": { "thinkingBudget": 0 },
    "maxOutputTokens": 200
  }
}
"@

    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($requestBody)
    Write-Log "請求大小：$($bodyBytes.Length) bytes" "INFO"

    $maxAttempts = 3
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        try {
            Write-Log "調用 Gemini API（嘗試 $attempt / $maxAttempts）..."
            $sw = [System.Diagnostics.Stopwatch]::StartNew()

            $response = Invoke-RestMethod `
                -Uri "$GEMINI_API_URL`?key=$ApiKey" `
                -Method Post `
                -ContentType "application/json; charset=utf-8" `
                -Body $bodyBytes `
                -TimeoutSec 60 `
                -ErrorAction Stop

            $sw.Stop()
            Write-Log "API 回應（$([int]$sw.Elapsed.TotalMilliseconds) ms）" "SUCCESS"

            $cand = $response.candidates[0]
            if (-not $cand.content.parts) {
                Write-Log "API 回應沒有 parts（finishReason: $($cand.finishReason)）" "ERROR"
                return $null
            }

            $msg = $cand.content.parts[0].text.Trim()
            # 去除可能的引號包裹或 markdown code block
            $msg = $msg -replace '^["`]+', '' -replace '["`]+$', ''
            $msg = $msg -replace '^```[a-z]*\s*', '' -replace '\s*```$', ''
            return $msg.Trim()
        }
        catch {
            $statusCode = $null
            if ($_.Exception.Response) {
                $statusCode = [int]$_.Exception.Response.StatusCode
            }
            $statusText = if ($statusCode) { "HTTP $statusCode" } else { "無狀態碼" }
            Write-Log "嘗試 $attempt 失敗（$statusText）：$($_.Exception.Message)" "WARNING"

            $isTransient = $false
            if ($statusCode -in 408, 429, 500, 502, 503, 504) { $isTransient = $true }
            elseif ($null -eq $statusCode -and $_.Exception.Message -match "timeout|timed out|connection|TLS|SSL|aborted|reset") {
                $isTransient = $true
            }

            if (-not $isTransient -or $attempt -eq $maxAttempts) {
                return $null
            }

            $delay = 2 * [math]::Pow(2, $attempt - 1)
            Write-Log "等待 $delay 秒後重試..." "INFO"
            Start-Sleep -Seconds $delay
        }
    }
    return $null
}

# ============================================================================
# 主程式
# ============================================================================

function Main {
    Write-Log "========================================" "INFO"
    Write-Log "開始自動 Commit 流程" "INFO"
    Write-Log "========================================" "INFO"
    Write-Host ""

    if ([string]::IsNullOrWhiteSpace($ApiKey)) {
        Write-Log "未提供 Gemini API 密鑰" "ERROR"
        exit 1
    }

    # 切到 repo root
    try {
        $repoRoot = & git rev-parse --show-toplevel 2>$null
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repoRoot)) {
            throw "不是 git 倉庫"
        }
    }
    catch {
        Write-Log "此目錄不是有效的 git 倉庫" "ERROR"
        exit 1
    }
    Set-Location $repoRoot
    Write-Log "工作目錄：$repoRoot" "INFO"

    # 檢查是否有變更
    $statusBefore = & git -c core.quotePath=false status --porcelain
    if (-not $statusBefore) {
        Write-Log "工作區沒有任何變更，結束" "WARNING"
        exit 0
    }

    # git add .
    Write-Log "執行 git add ..." "INFO"
    & git add .
    if ($LASTEXITCODE -ne 0) {
        Write-Log "git add 失敗" "ERROR"
        exit 1
    }

    # 確認 staged 有東西
    $statusAfter = & git -c core.quotePath=false diff --cached --name-only
    if (-not $statusAfter) {
        Write-Log "沒有 staged 變更（可能全部被 .gitignore 擋掉），結束" "WARNING"
        exit 0
    }

    # 顯示變更概要
    Write-Host ""
    Write-Host "===== 變更檔案 =====" -ForegroundColor Yellow
    $statusAfter -split "`n" | ForEach-Object { Write-Host "  $_" }
    Write-Host ""

    # 取得 diff
    Write-Log "讀取 staged diff..." "INFO"
    $diffSummary = Get-GitDiffSummary
    $diffFull = Get-GitDiffFull -MaxChars $MaxDiffChars
    Write-Log "diff 大小：$($diffFull.Length) 字元" "INFO"

    # 呼叫 Gemini 生成 commit message
    Write-Host ""
    $commitMessage = Invoke-GeminiCommitMessage -DiffSummary $diffSummary -DiffFull $diffFull
    if ([string]::IsNullOrWhiteSpace($commitMessage)) {
        Write-Log "無法生成 commit message，結束" "ERROR"
        exit 1
    }

    # 顯示 message 並確認
    Write-Host ""
    Write-Host "===== 生成的 commit message =====" -ForegroundColor Yellow
    Write-Host "  $commitMessage" -ForegroundColor Green
    Write-Host ""

    if (-not $Yes) {
        $answer = Read-Host "確認執行 commit$(if (-not $NoPush) { ' + push' })？[y/N]"
        if ($answer -notmatch '^[Yy]') {
            Write-Log "使用者取消" "WARNING"
            exit 0
        }
    }

    # git commit
    Write-Log "執行 git commit ..." "INFO"
    & git commit -m $commitMessage
    if ($LASTEXITCODE -ne 0) {
        Write-Log "git commit 失敗" "ERROR"
        exit 1
    }
    Write-Log "commit 成功" "SUCCESS"

    # git push
    if (-not $NoPush) {
        Write-Log "執行 git push origin ..." "INFO"
        & git push origin
        if ($LASTEXITCODE -ne 0) {
            Write-Log "git push 失敗" "ERROR"
            exit 1
        }
        Write-Log "push 成功" "SUCCESS"
    }
    else {
        Write-Log "跳過 push（-NoPush）" "INFO"
    }

    Write-Host ""
    Write-Log "========================================" "INFO"
    Write-Log "完成" "SUCCESS"
    Write-Log "========================================" "INFO"
    exit 0
}

Main
