# PowerShell(二):寫 `.ps1` 腳本

這份專注在「把一串邏輯寫進檔案,之後重複執行」的部分——也就是寫 `.ps1` 檔。互動式下指令的部分在 `PowerShell-下指令.md`。

**前置假設**:你已經看過 `PowerShell-下指令.md`,知道 cmdlet 是 Verb-Noun、pipeline 傳物件不傳文字。本篇不重複那些基礎。

---

## 一、第一個 `.ps1` 腳本

把下面存成 `hello.ps1`:

```powershell
param(
    [string]$Name = "World"
)

Write-Host "Hello, $Name!" -ForegroundColor Green
```

執行:

```powershell
.\hello.ps1                # Hello, World!
.\hello.ps1 -Name Alice    # Hello, Alice!
```

注意**一定要加 `.\`**。PowerShell 為了安全,不會自動在當前目錄找執行檔(跟 Linux 一樣,跟 cmd 不一樣)。

---

## 二、執行政策(Execution Policy)

第一次跑 `.ps1` 可能會看到:

```
hello.ps1 cannot be loaded because running scripts is disabled on this system.
```

這是 PowerShell 的安全機制,防止亂下載的腳本被雙擊誤觸。

### 查看現在的政策

```powershell
Get-ExecutionPolicy -List
```

會看到每個 scope 的設定(MachinePolicy / UserPolicy / Process / CurrentUser / LocalMachine)。

### 政策等級(從嚴到鬆)

| 政策             | 行為                                              |
| :--------------- | :------------------------------------------------ |
| `Restricted`     | 什麼 `.ps1` 都不能跑(Windows 預設)              |
| `AllSigned`      | 只能跑有數位簽章的                                |
| `RemoteSigned`   | 本機寫的可以直接跑,從網路下載的要簽章(**建議**) |
| `Unrestricted`   | 全部都能跑(會跳警告)                             |
| `Bypass`         | 全部都能跑、沒警告(CI/CD 常用)                   |

### 建議設定(開發機)

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### 單次 bypass(寫在 CI script 裡)

```bash
pwsh -ExecutionPolicy Bypass -File ./deploy.ps1
```

---

## 三、變數

```powershell
$name = "Alice"             # 字串
$age = 30                   # 數字
$isActive = $true           # 布林(注意 $true / $false,不是 true)
$empty = $null

# 內插字串 — 用雙引號
"Hello, $name!"             # → Hello, Alice!
"Next year: $($age + 1)"    # 複雜表達式用 $(...)

# 不內插 — 用單引號
'Hello, $name!'             # → Hello, $name!(原樣)
```

### 型別註記(可選但推薦)

```powershell
[string]$name = "Alice"
[int]$age = 30
[string[]]$tags = @("dev", "ops")
```

加了型別,傳錯東西進去會直接噴錯,比跑到一半才發現強得多。

### 變數範圍

| 範圍      | 用法                  | 意義                      |
| :-------- | :-------------------- | :------------------------ |
| `$local:` | 預設                  | 當前 scope 可見           |
| `$script:`| `$script:counter`     | 整個 `.ps1` 檔可見        |
| `$global:`| `$global:config`      | 整個 session 都可見       |
| `$env:`   | `$env:PATH`           | 環境變數                  |

---

## 四、集合資料型別

### 4.1 陣列

```powershell
$fruits = @("apple", "banana", "cherry")
# 或
$fruits = "apple", "banana", "cherry"

$fruits[0]                  # apple
$fruits[-1]                 # cherry(最後一個)
$fruits.Count               # 3
$fruits.Length              # 3(同義)

$fruits += "durian"         # append(⚠️ 每次建新陣列,大量 append 效能差)
$fruits.Contains("apple")   # $true
```

**大量 append 的效能問題**:`+=` 每次都建新陣列。真的要大量 append,用 `List`:

```powershell
$list = [System.Collections.Generic.List[string]]::new()
$list.Add("apple")
$list.Add("banana")
```

### 4.2 Hashtable(字典)

```powershell
$person = @{
    Name = "Alice"
    Age  = 30
    City = "Taipei"
}

$person.Name                # Alice
$person["Age"]              # 30
$person.Email = "a@b.com"   # 加 key

$person.ContainsKey("Age")  # $true
$person.Keys                # 所有 key
$person.Values              # 所有 value
$person.Remove("City")      # 刪掉
```

Hashtable 超常用,很多 cmdlet 的參數就是 hashtable:

```powershell
Invoke-RestMethod -Uri $url -Headers @{
    "Authorization" = "Bearer $token"
    "Content-Type"  = "application/json"
}
```

### 4.3 PSCustomObject(輕量結構體)

```powershell
$user = [PSCustomObject]@{
    Name  = "Alice"
    Age   = 30
    Email = "a@b.com"
}

$user.Name
$user | Select-Object Name, Email
$user | ConvertTo-Json
```

**Hashtable vs PSCustomObject 的選擇**:
- Hashtable:當 map 用、傳參數、查詢
- PSCustomObject:輸出、回傳、要在 pipeline 裡處理

---

## 五、流程控制

### 5.1 條件

```powershell
if ($age -ge 18) {
    Write-Host "成年"
} elseif ($age -ge 12) {
    Write-Host "青少年"
} else {
    Write-Host "兒童"
}
```

**PowerShell 比較運算子**(**注意不用 `==` 跟 `>`**):

| 意思               | PowerShell          | 等同其他語言 |
| :----------------- | :------------------ | :----------- |
| 等於               | `-eq`               | `==`         |
| 不等於             | `-ne`               | `!=`         |
| 大於               | `-gt`               | `>`          |
| 小於               | `-lt`               | `<`          |
| 大於等於           | `-ge`               | `>=`         |
| 小於等於           | `-le`               | `<=`         |
| 區分大小寫         | `-ceq`、`-cne` 等   | —            |
| 字串比對           | `-like`、`-match`   | —            |
| 陣列包含           | `-contains`、`-in`  | —            |

為什麼不用 `>`?因為 `>` 在 shell 裡是**重導向**符號:

```powershell
"hello" > out.txt       # 這是寫到檔案,不是比較!
```

### 5.2 迴圈

```powershell
# foreach(陣列逐個)
foreach ($fruit in $fruits) {
    Write-Host $fruit
}

# for(C-style)
for ($i = 0; $i -lt 10; $i++) {
    Write-Host $i
}

# while
while ($count -lt 5) {
    $count++
}

# do-while
do {
    $input = Read-Host "請輸入 yes 繼續"
} while ($input -ne "yes")

# Pipeline 版(最 PowerShell 風格)
$fruits | ForEach-Object { Write-Host $_ }
1..10 | ForEach-Object { $_ * $_ }
```

`$_` 代表 pipeline 傳進來的當前物件。

### 5.3 Switch

```powershell
switch ($status) {
    "active"   { "啟用中"; break }
    "inactive" { "停用"; break }
    "pending"  { "待處理"; break }
    default    { "未知狀態" }
}

# 支援正規
switch -Regex ($email) {
    '^.+@gmail\.com$'           { "Gmail 用戶" }
    '^.+@(yahoo|hotmail)\.com$' { "老牌信箱" }
    default                     { "其他" }
}

# 支援萬用字元
switch -Wildcard ($file) {
    "*.jpg" { "圖片" }
    "*.mp4" { "影片" }
    "*.md"  { "文件" }
}
```

---

## 六、函數

### 6.1 基本函數

```powershell
function Get-Greeting {
    param(
        [string]$Name = "World",
        [int]$Times = 1
    )

    for ($i = 0; $i -lt $Times; $i++) {
        "Hello, $Name!"
    }
}

Get-Greeting                         # Hello, World!
Get-Greeting -Name "Alice"           # Hello, Alice!
Get-Greeting -Name "Bob" -Times 3    # Hello, Bob! x3
```

### 6.2 進階函數(advanced function)

加 `[CmdletBinding()]` 讓函數擁有內建的 `-Verbose`、`-ErrorAction` 參數,還能支援 pipeline:

```powershell
function Test-EvenNumber {
    [CmdletBinding()]
    param(
        [Parameter(ValueFromPipeline=$true, Mandatory=$true)]
        [int]$Number
    )

    process {
        [PSCustomObject]@{
            Number = $Number
            IsEven = ($Number % 2 -eq 0)
        }
    }
}

1..5 | Test-EvenNumber
```

三個 block 的用途:
- `begin` → 整個 pipeline 開始前跑一次
- `process` → 每個 pipeline item 進來都跑
- `end` → 整個 pipeline 結束跑一次

### 6.3 回傳值:踩得最多的坑

PowerShell 函數的回傳**不是**只有 `return` 的那個東西。**所有沒被吞掉的輸出都會變回傳值**。

```powershell
function Bad-Example {
    $x = 10
    Write-Host "除錯訊息"   # OK,Write-Host 不進 pipeline
    "side effect"           # ⚠️ 這也會變回傳值!
    return $x               # 這也是
}

$result = Bad-Example
# $result = @("side effect", 10) — 不是 10 而已!
```

**安全習慣**:
- 除錯訊息用 `Write-Host`、`Write-Verbose`、`Write-Debug`
- 真的要回值,就用 `return` 或直接寫最後一行
- **別在函數中間留孤兒字串**

```powershell
function Good-Example {
    Write-Verbose "計算中..."
    $x = 10
    return $x
}
```

---

## 七、檔案、路徑、字串

### 7.1 讀寫檔案

```powershell
# 讀
$lines = Get-Content "file.txt"              # 字串陣列(每行一個)
$raw   = Get-Content "file.txt" -Raw         # 整份當一個字串
$json  = Get-Content "config.json" -Raw | ConvertFrom-Json

# 寫
"Hello" | Out-File "file.txt"
"Hello" | Set-Content "file.txt" -Encoding utf8
$data | ConvertTo-Json -Depth 10 | Set-Content "config.json"

# Append
"更多內容" | Add-Content "file.txt"
```

**編碼注意**:PowerShell 5.1 的 `Out-File` 預設是 UTF-16LE,會害下游工具讀不出中文。**永遠明確指定 `-Encoding utf8`**。PowerShell 7+ 預設 UTF-8,比較友善。

### 7.2 路徑操作

```powershell
Join-Path "C:\projects" "myapp"              # C:\projects\myapp
Join-Path "C:\projects" "myapp" -ChildPath "src"  # 多層

Split-Path "C:\projects\myapp\app.js"        # C:\projects\myapp
Split-Path "C:\projects\myapp\app.js" -Leaf  # app.js
Split-Path "C:\projects\myapp\app.js" -Extension  # .js

Test-Path "C:\projects"                      # $true / $false
Resolve-Path ".\config.json"                 # 轉絕對路徑
```

**跨平台**:一律用 `Join-Path`,別手動拼 `\`。Linux / macOS 是 `/`。

### 7.3 字串操作

```powershell
$s = "Hello, World"

# 方法(.NET 風格)
$s.ToUpper()                     # HELLO, WORLD
$s.Replace("World", "PS")        # Hello, PS
$s.Split(",")                    # @("Hello", " World")
$s.Trim()                        # 去頭尾空白
$s.StartsWith("Hello")           # $true

# PowerShell 運算子(支援正規)
$s -split ","                    # 跟 .Split 一樣,但支援正規
$s -replace "World", "PS"        # 正規版 replace
$s -match "W\w+"                 # $true,結果塞在 $matches
$matches[0]                      # World

# Here-string(多行字串)
$sql = @"
SELECT *
FROM users
WHERE id = $userId
"@
```

---

## 八、錯誤處理

### 8.1 try / catch / finally

```powershell
try {
    $response = Invoke-RestMethod "https://api.example.com/users"
    Write-Host "成功取得 $($response.Count) 筆資料"
}
catch {
    Write-Error "呼叫 API 失敗: $($_.Exception.Message)"
    exit 1
}
finally {
    Write-Host "清理工作"
}
```

`$_` 在 catch 裡是錯誤物件(`ErrorRecord`),常用屬性:
- `$_.Exception.Message` — 錯誤訊息
- `$_.ScriptStackTrace` — 堆疊
- `$_.InvocationInfo.Line` — 出錯那一行

### 8.2 ⚠️ 兩種錯誤:這是大坑

PowerShell 的錯誤分兩種:

| 類型                       | 行為                           | try/catch 抓得到?    |
| :------------------------- | :----------------------------- | :------------------- |
| **Terminating Error**      | throw、中斷執行                | ✅ 會                 |
| **Non-Terminating Error**  | 紅字印出、**繼續執行**         | ❌ 預設抓不到         |

**大部分 cmdlet 的錯誤是 non-terminating**。這害到超多人寫腳本:

```powershell
try {
    Remove-Item "nope.txt"      # 檔案不存在,會印紅字但繼續
    Write-Host "刪掉了"          # ⚠️ 這行還是會跑!
}
catch {
    Write-Host "有錯"            # 抓不到
}
```

### 8.3 怎麼讓 catch 真的抓到

**方法 A:個別指令加 `-ErrorAction Stop`**

```powershell
Remove-Item "nope.txt" -ErrorAction Stop
```

**方法 B:全域設定(腳本開頭)**

```powershell
$ErrorActionPreference = "Stop"
```

這一行是**寫穩健腳本的第一條預防針**。沒設的話,腳本會在錯誤中沉默失敗(看起來成功,其實一半沒做到)。

### 8.4 主動 throw

```powershell
if ($age -lt 0) {
    throw "年齡不能是負數: $age"
}

# 結構化 throw
throw [System.ArgumentException]::new("參數錯誤")
```

---

## 九、實戰範例

### 9.1 批次重新命名檔案

```powershell
# 當前目錄所有 .jpeg 改成 .jpg
Get-ChildItem -Filter *.jpeg |
  Rename-Item -NewName { $_.Name -replace '\.jpeg$', '.jpg' }
```

### 9.2 健康檢查多個服務

```powershell
function Test-ServiceHealth {
    param([string]$Url)

    try {
        $res = Invoke-WebRequest -Uri $Url -TimeoutSec 5 -UseBasicParsing
        [PSCustomObject]@{
            Url    = $Url
            Status = $res.StatusCode
            OK     = $res.StatusCode -eq 200
        }
    }
    catch {
        [PSCustomObject]@{
            Url    = $Url
            Status = "ERROR"
            OK     = $false
        }
    }
}

@(
    "http://localhost:5000/health",
    "http://localhost:8025",
    "http://localhost:5433"
) | ForEach-Object { Test-ServiceHealth $_ } | Format-Table -AutoSize
```

### 9.3 改 JSON 設定檔

```powershell
$path = "appsettings.json"
$config = Get-Content $path -Raw | ConvertFrom-Json
$config.Database.ConnectionString = "Host=localhost;Port=5433;..."
$config | ConvertTo-Json -Depth 10 | Set-Content $path -Encoding utf8
```

### 9.4 清掉 N 天前的 log

```powershell
param(
    [int]$Days = 30,
    [string]$LogDir = "C:\logs"
)

$cutoff = (Get-Date).AddDays(-$Days)
Get-ChildItem $LogDir -Filter *.log -Recurse |
  Where-Object { $_.LastWriteTime -lt $cutoff } |
  Remove-Item -WhatIf        # ⭐ 先跑 -WhatIf 看會刪什麼,確定後再拿掉
```

---

## 十、常見陷阱

### 陷阱 1:陣列只有一個元素時會塌成單值

```powershell
$files = Get-ChildItem "*.xyz"   # 只有一個符合
$files.Count                     # 噴錯!單一物件沒有 .Count
```

解法:

```powershell
@(Get-ChildItem "*.xyz").Count   # 強制當陣列
(Get-ChildItem "*.xyz" | Measure-Object).Count
```

### 陷阱 2:`$null` 比較要放左邊

```powershell
# 錯:如果 $user 是陣列,這個比較行為會怪
if ($user -eq $null) { ... }

# 對:官方推薦寫法
if ($null -eq $user) { ... }
```

### 陷阱 3:`Write-Host` 不是回傳

```powershell
function Get-Number {
    Write-Host 42    # 只印到螢幕,不是回傳
}
$x = Get-Number      # $x 是 $null!
```

### 陷阱 4:忘了 `$ErrorActionPreference = "Stop"`

前面講過,這是腳本穩健性的第一道防線,別忘。

### 陷阱 5:忘了 `-Raw` 就 `ConvertFrom-Json`

```powershell
# 錯:沒 -Raw,ConvertFrom-Json 拿到字串陣列會每行各自解析
$config = Get-Content "config.json" | ConvertFrom-Json

# 對
$config = Get-Content "config.json" -Raw | ConvertFrom-Json
```

### 陷阱 6:路徑含空白沒加引號

```powershell
$path = C:\Program Files\MyApp   # 錯,直接語法錯
$path = "C:\Program Files\MyApp" # 對
```

---

## 十一、寫腳本的最佳實踐清單

腳本開頭建議放這些:

```powershell
#Requires -Version 7.0          # 宣告需要的版本
[CmdletBinding()]                # 讓整個 script 支援 -Verbose
param(
    [Parameter(Mandatory=$true)]
    [string]$InputFile,
    [int]$Retries = 3
)

Set-StrictMode -Version Latest   # 未宣告變數 / 陣列越界會噴錯
$ErrorActionPreference = "Stop"  # cmdlet 錯誤變成 terminating

# 主邏輯
try {
    # ...
}
catch {
    Write-Error $_
    exit 1
}
```

這幾行是**寫穩健 PowerShell 腳本的起手式**,值得直接收進你的 template。

---

## 十二、心智地圖

```
寫 PowerShell 腳本三支柱
  │
  ├── 物件 Pipeline
  │    └── 不剖字串,用屬性過濾
  │
  ├── Verb-Noun Cmdlet + 進階函數
  │    └── [CmdletBinding()] + param + process block
  │
  └── 錯誤處理
       ├── $ErrorActionPreference = "Stop"(腳本起手式)
       ├── try / catch / finally
       └── 記住 non-terminating 預設抓不到

三件事一定要記
  │
  ├── 用 $null -eq $x(反的順序)
  ├── 函數所有未賦值輸出都會被回傳
  └── Write-Host 不進 pipeline,別拿來回傳
```

學到會自己寫 `.ps1` 大概能處理 90% 的 Windows 自動化。真的要進 module / DSC / remoting 再回官方文件翻就好。

---

## 延伸資源

- **官方文件**:<https://learn.microsoft.com/powershell>
- **查 cmdlet**:`Get-Help <name> -Online`
- **VS Code 擴充**:PowerShell (by Microsoft) — debugger + IntelliSense
- **PowerShell Gallery**:類似 npm,`Install-Module <name>`
