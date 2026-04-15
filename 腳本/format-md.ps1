# ============================================================================
# Markdown 自動排版腳本 - 使用 Gemini API
# ============================================================================
# 用途：自動檢測 git diff，對改動的 MD 檔案進行 AI 排版美化
# 使用：.\format-md.ps1
# ============================================================================

param(
    [string]$ApiKey = $env:GEMINI_API_KEY, # 自動讀取環境變數
    [string]$Model = "gemini-2.5-flash"
)

# ============================================================================
# 設定
# ============================================================================
# 強制 console I/O 使用 UTF-8，避免讀取 git 輸出時中文路徑亂碼
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{0}:generateContent" -f $Model
$MAX_FILE_SIZE = 100KB
$ENCODING = [System.Text.Encoding]::UTF8

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

function Get-ChangedFiles {
    try {
        Write-Log "檢測改動的 Markdown 檔案..."

        # ========== 已追蹤的檔案 ==========
        # --name-only: 只取路徑
        # --diff-filter=AM: 只取 新增(A)、修改(M) 的檔案，排除刪除(D) 和複製(C)
        # "*.md": 直接在 git 層級過濾副檔名，效率最高
        # -c core.quotePath=false: 避免非 ASCII 路徑被轉成 "\xxx" octal escape
        $staged = & git -c core.quotePath=false diff --cached --name-only --diff-filter=AM "*.md"
        $unstaged = & git -c core.quotePath=false diff --name-only --diff-filter=AM "*.md"

        # ========== 未追蹤的新檔案 ==========
        # git ls-files --others: 抓 untracked 的檔案
        # --exclude-standard: 排除 .gitignore 中的檔案
        $untracked = & git -c core.quotePath=false ls-files --others --exclude-standard "*.md"

        # 合併所有檔案並去除重複
        $mdFiles = (@($staged) + @($unstaged) + @($untracked)) | Where-Object { $_ } | Select-Object -Unique

        if ($null -eq $mdFiles -or $mdFiles.Count -eq 0) {
            Write-Log "沒有找到改動或新建的 MD 檔案" "WARNING"
            return @()
        }

        Write-Log "找到 $($mdFiles.Count) 個改動/新建的 MD 檔案" "SUCCESS"
        return $mdFiles
    }
    catch {
        Write-Log "檢測改動檔案失敗：$_" "ERROR"
        return @()
    }
}

function Read-FileContent {
    param([string]$FilePath)

    try {
        if (-not (Test-Path $FilePath)) {
            Write-Log "檔案不存在：$FilePath" "WARNING"
            return $null
        }

        $file = Get-Item $FilePath
        if ($file.Length -gt $MAX_FILE_SIZE) {
            Write-Log "檔案過大（$($file.Length) bytes）：$FilePath" "WARNING"
            return $null
        }

        return Get-Content -Path $FilePath -Raw -Encoding UTF8
    }
    catch {
        Write-Log "讀取檔案失敗 [$FilePath]：$_" "ERROR"
        return $null
    }
}

function Invoke-GeminiBatchAPI {
    param(
        [array]$Files  # 元素為 @{ path = ...; content = ... }
    )

    <#
    .SYNOPSIS
    一次性調用 Gemini API 對多個 Markdown 檔案進行批次排版
    使用 responseSchema 強制回傳結構化 JSON，避免解析失誤
    #>

    $systemPrompt = @"
你是一個 Markdown 排版專家。你的任務是改進用戶提供的多個 Markdown 文檔的格式。

**排版規則：**
1. **標題階層**：正確使用 # ## ### 等，確保邏輯清晰
2. **列表格式**：無序用 ``- ``，有序用 ``1. 2. 3.``，嵌套用適當縮進
3. **代碼塊**：行內用反引號，代碼塊指定語言
4. **強調**：粗體 **text**、斜體 *text*、粗斜體 ***text***
5. **表格**：使用標準 Markdown 表格格式
6. **連結與圖片**：[text](url) 與 ![alt](url)
7. **分隔線**：用 ---
8. **引用**：用 > 開頭
9. **其他**：
   - 移除多餘空行（最多連續兩行空行）
   - 確保檔案末尾有單個換行符
   - 正確的中英文間距（英文/數字前後加空格）

**輸入格式**：一個 JSON 陣列，每個元素包含 path 與 content。
**輸出要求**：
- 回傳同樣長度與順序的 JSON 陣列
- path 必須與輸入原樣保留，不得修改
- content 為排版美化後的 Markdown 全文
- 不得新增任何解釋或 markdown 以外的文字
- 保留原始語意，只改進格式
"@

    $totalBytes = ($Files | ForEach-Object { $_.content.Length } | Measure-Object -Sum).Sum
    Write-Log "準備 API 請求（$($Files.Count) 個檔案，約 $totalBytes 字元）..."

    # PowerShell 5.1 的 ConvertTo-Json 對含有大量特殊字元的字串有二次方時間 bug，
    # 改用 .NET 的 JavaScriptSerializer 或 System.Web.Script 直接序列化，速度數量級差異
    Add-Type -AssemblyName System.Web.Extensions -ErrorAction SilentlyContinue
    $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $serializer.MaxJsonLength = [int]::MaxValue

    # 小幫手：建立 Dictionary<string,object>，避免每行都 New-Object
    function New-JsonDict {
        New-Object 'System.Collections.Generic.Dictionary[string,object]'
    }
    function New-JsonList {
        New-Object 'System.Collections.Generic.List[object]'
    }

    Write-Log "序列化 files → JSON..." "INFO"
    $sw1 = [System.Diagnostics.Stopwatch]::StartNew()

    # 用強型別 List<object> 而非 PowerShell @()，用 ["key"] 索引器而非 .key 屬性
    # 這樣 JavaScriptSerializer 就不會踩到 PSParameterizedProperty 循環參考
    $filesList = New-JsonList
    foreach ($f in $Files) {
        $d = New-JsonDict
        $d["path"] = [string]$f["path"]
        $d["content"] = [string]$f["content"]
        $filesList.Add($d)
    }
    $inputJson = $serializer.Serialize($filesList)
    $sw1.Stop()
    Write-Log "檔案 JSON 完成（$($inputJson.Length) 字元，耗時 $([int]$sw1.Elapsed.TotalMilliseconds) ms）" "SUCCESS"

    Write-Log "組裝 request body..." "INFO"
    $sw2 = [System.Diagnostics.Stopwatch]::StartNew()

    # 巢狀 Dictionary 丟給 JavaScriptSerializer 會偶發 PSParameterizedProperty 例外，
    # 改為：只用 serializer 對「text 欄位的字串」做 JSON 轉義，外層結構手寫成 JSON
    $textContent = [string]($systemPrompt + "`n`n以下是待排版的檔案（JSON）：`n" + $inputJson)
    $textJson = $serializer.Serialize($textContent)  # 回傳帶引號的 JSON 字串字面值

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
    "temperature": 0.1,
    "thinkingConfig": { "thinkingBudget": 0 },
    "responseMimeType": "application/json",
    "responseSchema": {
      "type": "ARRAY",
      "items": {
        "type": "OBJECT",
        "properties": {
          "path": { "type": "STRING" },
          "content": { "type": "STRING" }
        },
        "required": ["path", "content"]
      }
    }
  }
}
"@
    $sw2.Stop()
    Write-Log "Request body 完成（$($requestBody.Length) 字元，耗時 $([int]$sw2.Elapsed.TotalMilliseconds) ms）" "SUCCESS"

    # 以 UTF-8 bytes 送出，避免 PowerShell 預設編碼破壞非 ASCII 內容
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($requestBody)
    Write-Log "請求大小：$($bodyBytes.Length) bytes" "INFO"

    # ========== 重試設定 ==========
    # 對暫時性錯誤（timeout、429、5xx、TLS 中斷）做指數退避重試
    $maxAttempts = 4
    $baseDelaySec = 2

    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        try {
            Write-Log "API 呼叫嘗試 $attempt / $maxAttempts ..."
            $sw = [System.Diagnostics.Stopwatch]::StartNew()

            $response = Invoke-RestMethod `
                -Uri "$GEMINI_API_URL`?key=$ApiKey" `
                -Method Post `
                -ContentType "application/json; charset=utf-8" `
                -Body $bodyBytes `
                -TimeoutSec 180 `
                -ErrorAction Stop

            $sw.Stop()
            Write-Log "API 回應已收到（耗時 $([int]$sw.Elapsed.TotalSeconds) 秒）" "INFO"

            $text = $response.candidates[0].content.parts[0].text
            if ([string]::IsNullOrWhiteSpace($text)) {
                Write-Log "API 回應為空" "ERROR"
                return $null
            }

            $result = $text | ConvertFrom-Json
            Write-Log "API 呼叫成功，回傳 $($result.Count) 個檔案" "SUCCESS"
            return $result
        }
        catch {
            $sw.Stop()
            $errMsg = $_.Exception.Message
            $statusCode = $null
            if ($_.Exception.Response) {
                $statusCode = [int]$_.Exception.Response.StatusCode
            }

            # 判斷是否為可重試的暫時性錯誤
            $isTransient = $false
            if ($null -ne $statusCode) {
                # 408 timeout, 429 rate limit, 500/502/503/504 server error
                if ($statusCode -in 408, 429, 500, 502, 503, 504) {
                    $isTransient = $true
                }
            }
            else {
                # 沒有 HTTP 狀態碼通常是 timeout / 連線中斷 / DNS 失敗
                if ($errMsg -match "timeout|timed out|connection|TLS|SSL|aborted|reset") {
                    $isTransient = $true
                }
            }

            $statusText = if ($statusCode) { "HTTP $statusCode" } else { "無狀態碼" }
            Write-Log "嘗試 $attempt 失敗（$statusText）：$errMsg" "WARNING"

            if (-not $isTransient) {
                Write-Log "非暫時性錯誤，停止重試" "ERROR"
                return $null
            }

            if ($attempt -eq $maxAttempts) {
                Write-Log "已達最大重試次數，放棄" "ERROR"
                return $null
            }

            # 指數退避：2s, 4s, 8s
            $delay = $baseDelaySec * [math]::Pow(2, $attempt - 1)
            Write-Log "等待 $delay 秒後重試..." "INFO"
            Start-Sleep -Seconds $delay
        }
    }

    return $null
}

function Write-FileContent {
    param(
        [string]$FilePath,
        [string]$Content
    )

    <#
    .SYNOPSIS
    將內容寫入檔案
    #>

    try {
        # 確保檔案末尾只有一個換行符
        $content = $content.TrimEnd() + "`n"

        # 使用 .NET 方法確保無 BOM 的 UTF-8，這對 Git 比較友善
        [System.IO.File]::WriteAllText($FilePath, $content, (New-Object System.Text.UTF8Encoding($false)))
        Write-Log "檔案已更新：$FilePath" "SUCCESS"
        return $true
    }
    catch {
        Write-Log "寫入失敗：$_" "ERROR"
        return $false
    }
}

# ============================================================================
# 主程式
# ============================================================================

function Main {
    Write-Log "========================================" "INFO"
    Write-Log "開始 Markdown 自動排版流程" "INFO"
    Write-Log "========================================" "INFO"
    Write-Host ""

    # 驗證 API 密鑰
    if ([string]::IsNullOrWhiteSpace($ApiKey)) {
        Write-Log "未提供 Gemini API 密鑰" "ERROR"
        exit 1
    }

    # 驗證 git 倉庫
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

    # 切換到 repo 根目錄，確保 pathspec 與相對路徑正確解析
    Set-Location $repoRoot
    Write-Log "工作目錄：$repoRoot" "INFO"

    # 獲取改動檔案
    $changedFiles = Get-ChangedFiles
    if ($changedFiles.Count -eq 0) {
        Write-Log "無改動檔案可處理，結束" "INFO"
        exit 0
    }

    Write-Host ""

    # ========== 讀取所有檔案 ==========
    $fileBundle = @()
    $originalMap = @{}
    foreach ($file in $changedFiles) {
        $content = Read-FileContent -FilePath $file
        if ($null -ne $content) {
            $fileBundle += @{ path = $file; content = $content }
            $originalMap[$file] = $content
        }
    }

    if ($fileBundle.Count -eq 0) {
        Write-Log "沒有可讀取的檔案，結束" "WARNING"
        exit 0
    }

    Write-Host ""

    # ========== 一次性批次排版 ==========
    $formatted = Invoke-GeminiBatchAPI -Files $fileBundle
    if ($null -eq $formatted) {
        Write-Log "批次 API 呼叫失敗，結束" "ERROR"
        exit 1
    }

    Write-Host ""

    # ========== 寫回檔案 ==========
    $successCount = 0
    $failureCount = 0
    $unchangedCount = 0

    foreach ($item in $formatted) {
        $path = $item.path
        $newContent = $item.content

        if (-not $originalMap.ContainsKey($path)) {
            Write-Log "API 回傳了未預期的檔案路徑：$path" "WARNING"
            $failureCount++
            continue
        }

        if ($originalMap[$path] -eq $newContent) {
            Write-Log "檔案無需修改：$path" "INFO"
            $unchangedCount++
            continue
        }

        if (Write-FileContent -FilePath $path -Content $newContent) {
            $successCount++
        }
        else {
            $failureCount++
        }
    }

    Write-Host ""
    Write-Log "========================================" "INFO"
    Write-Log "排版流程完成" "INFO"
    Write-Log "成功：$successCount，未變更：$unchangedCount，失敗：$failureCount" "INFO"
    Write-Log "========================================" "INFO"

    if ($failureCount -gt 0) {
        exit 1
    }

    exit 0
}

# 執行主程式
Main
