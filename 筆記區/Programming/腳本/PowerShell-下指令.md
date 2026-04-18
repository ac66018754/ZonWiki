# PowerShell(一):下指令與讀懂指令

這份筆記專注在「互動使用」——也就是你打開終端機、敲指令、看結果的這段。寫 `.ps1` 腳本那端請看 `PowerShell-寫腳本.md`。

**本篇核心目標**:
1. 看懂 PowerShell 在幹嘛,為什麼它跟 cmd / bash 設計上根本不同
2. 會下日常會用到的指令
3. **看到 AI 或別人丟出來的指令,能判斷該不該執行**

---

## 零、先澄清:Claude Code 到底用哪個 shell?

很多人(包括我自己)剛開始以為 AI 在 Windows 上會用 PowerShell,其實不然。

### 實際情況

Claude Code 在 Windows 上**預設使用 bash**(Git for Windows 附的 Git Bash)。你在 session 一開始看到的環境訊息會寫:

```
Shell: bash (use Unix shell syntax, not Windows — e.g., /dev/null not NUL, forward slashes in paths)
```

所以 AI 跳出來要你 Allow 的指令會長這樣:

```bash
ls -la
docker run -v "$(pwd):/app" ...
git log --oneline -20
```

而不是 PowerShell 風格的:

```powershell
Get-ChildItem
docker run -v "${PWD}:/app" ...
```

### 那為什麼還要學 PowerShell?

三個理由:

1. **你自己打指令管 Windows 的時候**:管 Windows 服務、登錄檔、AD、Exchange — 這些領域 PowerShell 是原生工具
2. **寫自動化腳本**:部署、定期任務、批次處理,PowerShell 寫起來比 bash 乾淨
3. **讀懂指令的技巧是通用的**:flag 的概念、pipeline、危險模式一樣,學一個通另一個

本篇會同時標注 **bash ↔ PowerShell 對照**,這樣不管 AI 用哪一邊你都能讀。

---

## 一、PowerShell 是什麼?設計哲學的差異

| 維度         | cmd                   | bash                    | PowerShell                        |
| :----------- | :-------------------- | :---------------------- | :-------------------------------- |
| **Pipeline** | 傳文字                | 傳文字                  | **傳物件**                        |
| **基礎建設** | Win32 API             | POSIX                   | **.NET**                          |
| **指令結構** | 簡短動詞              | 簡短動詞                | **Verb-Noun**(`Get-Process`)      |
| **跨平台**   | ❌                     | ✅                       | ✅(PowerShell 7+)                  |

### 關鍵差異:物件 vs 文字

bash 世界:
```bash
# 要列出 CPU 超過 10% 的 process,得用 awk 剖字串
ps aux | awk '$3 > 10 { print $11 }'
```

PowerShell 世界:
```powershell
# 直接用屬性過濾 — 每個 process 本身就是物件
Get-Process | Where-Object { $_.CPU -gt 10 } | Select-Object ProcessName
```

**不要想「剖字串」,開始想「過濾物件屬性」。** 這是使用 PowerShell 最重要的心態轉換。

### 兩種 PowerShell

| 名稱                   | 版本     | 執行檔           | 現況                   |
| :--------------------- | :------- | :--------------- | :--------------------- |
| **Windows PowerShell** | 5.1      | `powershell.exe` | Windows 內建,維護中   |
| **PowerShell**         | 7.x+     | `pwsh.exe`       | **主力,新功能在這**   |

裝新版:`winget install Microsoft.PowerShell`

---

## 二、Cmdlet 命名規則

PowerShell 指令叫 **Cmdlet**(念 "command-let"),一律是 `Verb-Noun`:

| Verb        | 意思             | 範例                                   |
| :---------- | :--------------- | :------------------------------------- |
| **Get-**    | 取得             | `Get-Process`、`Get-ChildItem`         |
| **Set-**    | 修改             | `Set-Location`、`Set-ItemProperty`     |
| **New-**    | 建立             | `New-Item`、`New-Object`               |
| **Remove-** | 刪除             | `Remove-Item`                          |
| **Start-**  | 啟動             | `Start-Service`、`Start-Process`       |
| **Stop-**   | 停止             | `Stop-Service`、`Stop-Process`         |
| **Invoke-** | 執行             | `Invoke-WebRequest`、`Invoke-Command`  |
| **Test-**   | 檢查(回傳 bool) | `Test-Path`、`Test-Connection`         |

這套命名讓你**幾乎能用猜的**找到指令。想刪?`Remove-Item`。想測網路?`Test-Connection`。

---

## 三、別名:為什麼 `ls` 在 PowerShell 也能用

PowerShell 保留了常用的 cmd 跟 bash 別名,讓你從別的 shell 過來不用重學:

| 你打的            | 實際是              |
| :---------------- | :------------------ |
| `ls`、`dir`       | `Get-ChildItem`     |
| `cd`              | `Set-Location`      |
| `pwd`             | `Get-Location`      |
| `cat`、`type`     | `Get-Content`       |
| `cp`、`copy`      | `Copy-Item`         |
| `mv`、`move`      | `Move-Item`         |
| `rm`、`del`       | `Remove-Item`       |
| `echo`            | `Write-Output`      |
| `cls`、`clear`    | `Clear-Host`        |
| `ps`              | `Get-Process`       |
| `kill`            | `Stop-Process`      |
| `curl`、`wget`    | `Invoke-WebRequest`(**注意!** 不是真 curl)|

查某別名:`Get-Alias ls`

**重要陷阱**:`curl` 在 PowerShell 裡是 `Invoke-WebRequest` 的別名,行為跟真正的 curl 不一樣!想用真 curl:

```powershell
curl.exe https://example.com        # 明確加 .exe 才會用系統 curl
```

---

## 四、日常會用到的互動指令

### 4.1 查資訊

```powershell
Get-Help Get-Process -Examples          # 看指令範例(學新 cmdlet 神器)
Get-Command *service*                    # 找名字含 service 的所有 cmdlet
Get-Process | Get-Member                 # 看物件有哪些屬性跟方法
$PSVersionTable                          # 看自己 PowerShell 版本
```

`Get-Member` 是神器 — 任何物件後面接 `| Get-Member` 就能知道「我能對這個物件做什麼」。

### 4.2 檔案與目錄

```powershell
Get-ChildItem                            # 列目錄(= ls)
Get-ChildItem -Recurse -Filter *.md      # 遞迴找 .md
Get-ChildItem -Force                     # 含隱藏檔

Set-Location C:\Projects                 # cd
Get-Location                             # pwd

Get-Content file.txt                     # cat,回傳字串陣列(每行一個)
Get-Content file.txt -Tail 20            # 最後 20 行(= tail -20)
Get-Content file.txt -Wait               # 持續追蹤(= tail -f)

New-Item -ItemType Directory newfolder   # mkdir
New-Item file.txt                        # touch
Copy-Item a.txt b.txt                    # cp
Move-Item a.txt folder/                  # mv
Remove-Item file.txt                     # rm(⚠️ 危險用法見第六章)

Test-Path C:\Projects\app                # 檢查路徑存不存在
```

### 4.3 Process 與服務

```powershell
Get-Process                              # 列所有 process
Get-Process -Name chrome                 # 只看 chrome
Get-Process | Sort-Object CPU -Descending | Select-Object -First 5

Stop-Process -Name chrome                # 砍 chrome
Stop-Process -Id 1234                    # 按 PID 砍

Get-Service                              # 列服務
Get-Service -Name Docker*                # 跟 docker 有關的
Start-Service Docker                     # 啟動服務(通常要系統管理員)
Stop-Service Docker
Restart-Service Docker
```

### 4.4 網路

```powershell
Test-Connection google.com               # 跟 ping 類似
Test-NetConnection google.com -Port 443  # 測特定 port 通不通

Invoke-WebRequest https://api.github.com -UseBasicParsing
Invoke-RestMethod https://api.github.com # 會自動把 JSON 轉成物件

# 下載檔案
Invoke-WebRequest -Uri https://xxx.zip -OutFile xxx.zip
```

### 4.5 環境變數

```powershell
$env:PATH                                # 看 PATH
$env:PATH += ";C:\MyTools"               # 加一個(只在這個 session 有效)
$env:MY_KEY = "secret"                   # 設一個
Remove-Item Env:\MY_KEY                  # 刪掉

# 永久設定(寫進使用者環境)
[Environment]::SetEnvironmentVariable("MY_KEY", "secret", "User")
```

### 4.6 Pipeline 實戰

```powershell
# 找出記憶體用最多的前 5 個 process
Get-Process |
  Sort-Object WorkingSet -Descending |
  Select-Object -First 5 ProcessName, @{Name='Memory(MB)'; Expression={[math]::Round($_.WorkingSet/1MB, 2)}}

# 找最近 7 天內修改的 .cs 檔,按修改時間排序
Get-ChildItem -Recurse -Filter *.cs |
  Where-Object { $_.LastWriteTime -gt (Get-Date).AddDays(-7) } |
  Sort-Object LastWriteTime -Descending
```

`$_` 代表 pipeline 傳進來的當前物件(PowerShell 7 也可以寫 `$PSItem`)。

---

## 五、bash ↔ PowerShell 對照表(讀 AI 指令用)

AI 在你機器上預設丟 bash,但你平常自己打可能用 PowerShell。這張表讓你讀跨邊的指令時不會卡住。

### 5.1 基本操作

| 做什麼            | bash                    | PowerShell                          |
| :---------------- | :---------------------- | :---------------------------------- |
| 列目錄            | `ls -la`                | `Get-ChildItem -Force` / `ls`       |
| 切目錄            | `cd /path`              | `cd C:\path`                        |
| 當前目錄          | `pwd`                   | `pwd` / `Get-Location`              |
| 看檔案            | `cat file`              | `Get-Content file` / `cat file`     |
| 看結尾            | `tail -f log.txt`       | `Get-Content log.txt -Wait -Tail 10`|
| 複製              | `cp a b`                | `Copy-Item a b` / `cp a b`          |
| 移動/改名         | `mv a b`                | `Move-Item a b` / `mv a b`          |
| 刪除              | `rm file`               | `Remove-Item file` / `rm file`      |
| 遞迴刪除          | `rm -rf dir`            | `Remove-Item dir -Recurse -Force`   |
| 新建目錄          | `mkdir -p a/b/c`        | `New-Item -ItemType Directory -Force a\b\c` |
| 管線過濾          | `grep pattern`          | `Select-String pattern` / `? {...}` |

### 5.2 變數與替換

| 做什麼            | bash                       | PowerShell                  |
| :---------------- | :------------------------- | :-------------------------- |
| 設變數            | `x=5`                      | `$x = 5`                    |
| 讀變數            | `$x`                       | `$x`                        |
| 環境變數          | `$HOME`、`$PATH`           | `$env:USERPROFILE`、`$env:PATH`|
| 命令替換          | `$(date)` 或 `` `date` ``  | `$(Get-Date)`               |
| 當前目錄          | `$(pwd)`                   | `${PWD}` 或 `$PWD`          |

### 5.3 流程控制(one-liner)

| 做什麼              | bash                       | PowerShell                        |
| :------------------ | :------------------------- | :-------------------------------- |
| 迴圈每個檔           | `for f in *.txt; do ...; done` | `Get-ChildItem *.txt \| ForEach-Object { ... }` |
| 前一個成功才做下一個 | `a && b`                   | `a; if ($?) { b }`                |
| 任一成功             | `a \|\| b`                 | `a; if (-not $?) { b }`           |

### 5.4 組合指令

| 做什麼              | bash                          | PowerShell                        |
| :------------------ | :---------------------------- | :-------------------------------- |
| 多行指令            | `\` 換行                      | `` ` `` (反引號) 換行              |
| 指令串起來          | `;`                           | `;`                                |
| 導向輸出到檔        | `>` / `>>`                    | `>` / `>>`(但建議 `Out-File`)    |
| 背景執行            | `command &`                   | `Start-Job { command }`           |

---

## 六、⭐ 核心:讀懂指令再決定 Allow 或 Deny

這是這份筆記**最重要**的一章。AI 跳 permission prompt 時,你多花 10 秒看清楚指令,就能避免 99% 的意外。

### 6.1 風險分級光譜

| 風險  | 特徵                                    | 範例                                     | 預設反應 |
| :---- | :-------------------------------------- | :--------------------------------------- | :------- |
| 🟢 低 | 只讀、只查                              | `ls`、`cat`、`git status`、`Get-Process` | 直接 Allow |
| 🟡 中 | 會改檔,但範圍明確、可逆                | `git add`、`Edit file`、`npm install`    | 看清楚路徑後 Allow |
| 🟠 高 | 網路下載、進 production                 | `npm publish`、`gh pr create`、`curl \| sh` | 先問清楚用途 |
| 🔴 極高 | 不可逆、影響範圍大、執行未知程式     | `rm -rf`、`git reset --hard`、`git push --force`、`pipe to sh` | **Deny 或先手動檢查** |

### 6.2 看到這些關鍵字要提高警覺

#### 🚨 會直接刪資料

| bash                                    | PowerShell                              | 什麼意思                         |
| :-------------------------------------- | :-------------------------------------- | :------------------------------- |
| `rm -rf path`                           | `Remove-Item path -Recurse -Force`      | 遞迴、強制刪整個目錄,**沒有回收站** |
| `git clean -fd`                         | (同名)                                  | 砍所有未追蹤檔(包含你的新檔!) |
| `git reset --hard`                      | (同名)                                  | 丟掉所有未 commit 的改動         |
| `git checkout .`                        | (同名)                                  | 丟掉所有未 staged 的改動         |
| `docker volume prune`                   | (同名)                                  | 清所有沒在用的 volume(資料沒了) |
| `docker compose down -v`                | (同名)                                  | **`-v` 會連 volume 一起砍**       |

**判斷要點**:
- `-rf` / `-Recurse -Force` = **沒救援機會**
- 路徑是變數(`$var`)、wildcard(`*`) — **變數值到底是啥?**
- 特別怕 `rm -rf /` / `rm -rf $HOME` / `rm -rf $UNDEFINED/*` (變數沒定義變成 `rm -rf /*`,整台機器掰)

#### 🚨 會改遠端狀態

| 指令                                    | 會發生什麼                                                        |
| :-------------------------------------- | :---------------------------------------------------------------- |
| `git push --force`                      | 覆寫遠端歷史,別人 pull 會爆炸                                    |
| `git push --force-with-lease`           | 稍微安全一點,但還是在改遠端                                      |
| `gh pr merge`                           | 合進去了                                                          |
| `npm publish`                           | **發布到公開 registry,撤不回來**                                 |
| `docker push`                           | 推到 registry                                                     |

**這類都是**「做了就回不去」,看到先暫停。

#### 🚨 從網路下載東西再直接執行

**這是最危險的模式**。

```bash
curl https://example.com/install.sh | sh          # 把網路來的腳本直接跑
curl https://example.com | bash                   # 同上
wget -O- https://example.com/x.sh | sh            # 同上
iex (irm https://example.com/x.ps1)               # PowerShell 版本
Invoke-Expression (Invoke-RestMethod https://...) # 同上
```

為什麼危險:
1. 網址內容**下次可能就不一樣**(供應鏈攻擊)
2. 你**完全沒審過**那段腳本做什麼
3. 它拿到跟你一樣的權限 — 能刪你的檔、偷你的 SSH key、裝後門

**替代做法**:

```bash
# 先下載、看過、再執行
curl -O https://example.com/install.sh
cat install.sh            # 自己看
less install.sh           # 或用 less 翻
./install.sh              # 看完覺得沒問題再跑
```

#### 🚨 會動系統設定

| 指令                                          | 影響                            |
| :-------------------------------------------- | :------------------------------ |
| `Set-ExecutionPolicy Unrestricted`            | 關掉 PowerShell 腳本安全機制    |
| `chmod 777`                                   | 把檔案設成所有人可讀寫執行      |
| `sudo ...`                                    | **以 root 權限執行**,後果放大 |
| `netsh` / `Set-NetFirewallRule`               | 改防火牆                        |
| `reg add` / `Set-ItemProperty HKLM:...`       | 改登錄檔                        |

#### 🚨 會碰機敏資訊

看到指令在動這些路徑,要特別小心是不是在**讀走 / 傳出**敏感資料:

- `~/.ssh/` / `C:\Users\你\.ssh\` — SSH 私鑰
- `~/.aws/credentials` / `~/.config/gcloud/` — 雲端金鑰
- `~/.git-credentials` — Git 認證
- `.env`、`appsettings.Production.json` — 應用程式 secret
- `%APPDATA%\Microsoft\Credentials` — Windows Credential Manager

搭配 `curl -X POST ... -d @file` 或 `| nc host port` 那類**外送**的指令 = **超紅色警報**。

### 6.3 實用自保技巧

#### 技巧 1:先 dry-run

| 指令            | dry-run 版本              | 效果                |
| :-------------- | :------------------------ | :------------------ |
| `Remove-Item x` | `Remove-Item x -WhatIf`   | 只說會刪什麼,不真刪 |
| `git clean -fd` | `git clean -nd`           | `-n` = 只列出       |
| `rsync ...`     | `rsync --dry-run ...`     | 只報告              |
| `npm publish`   | `npm publish --dry-run`   | 只打包不上傳        |

看到 AI 要跑破壞性指令,**可以要求他先跑 dry-run 給你看**。

#### 技巧 2:要求先看變數值

AI 丟這種:

```bash
rm -rf $BUILD_DIR/*
```

你的反應應該是:「**先告訴我 `$BUILD_DIR` 是什麼值**」。如果 AI 說不知道或是空的,絕對不要 Allow — 會變成 `rm -rf /*`。

#### 技巧 3:Deny 了再談

Permission prompt 不是考試,**Deny 不會被扣分**。不確定就 Deny,AI 會跟你解釋它想幹嘛,你理解了再手動執行或再給 Allow。

#### 技巧 4:設白名單

Claude Code 的 `~/.claude/settings.json` 或專案 `.claude/settings.json` 可以把**確定安全**的指令加進 `allow` list,之後就不跳 prompt:

```json
{
  "permissions": {
    "allow": [
      "Bash(ls:*)",
      "Bash(cat:*)",
      "Bash(git status:*)",
      "Bash(git log:*)",
      "Bash(docker ps:*)"
    ]
  }
}
```

**絕對不要**把 `rm`、`git push`、`curl | sh` 這類進白名單。

### 6.4 一張「要不要 Allow」的決策樹

```
跳出 Permission Prompt
    │
    ├── 指令是「讀、查、列、看」嗎?
    │   └── 是 → Allow ✅
    │
    ├── 指令會改本機檔案嗎?
    │   ├── 路徑明確、可預期 → Allow ✅
    │   └── 路徑是變數/wildcard → 先問變數值 ❓
    │
    ├── 指令會改遠端(push, publish, merge)嗎?
    │   └── 先確認「改到哪」「對誰有影響」→ 確定才 Allow
    │
    ├── 指令會下載+執行網路內容(curl | sh)嗎?
    │   └── Deny ❌,改成先下載、手動看、再執行
    │
    └── 指令有 -rf / --force / reset --hard / 刪 volume?
        └── **先看 dry-run 或逐行拆解,不急著 Allow**
```

---

## 七、常見陷阱(互動使用時)

### 陷阱 1:`curl` 在 PowerShell 裡不是 curl

```powershell
curl https://example.com -o file.html    # ❌ 這用的是 Invoke-WebRequest,-o 不是那個意思
curl.exe https://example.com -o file.html # ✅ 明確用系統 curl
```

### 陷阱 2:路徑有空白沒加引號

```powershell
cd C:\Program Files         # ❌ 會被拆成兩個參數
cd "C:\Program Files"       # ✅
```

### 陷阱 3:`>` 的編碼問題(PowerShell 5.1)

```powershell
"中文" > out.txt            # PowerShell 5.1 預設 UTF-16LE,別的工具可能讀不出來
"中文" | Out-File out.txt -Encoding utf8   # ✅ 明確指定
```

PowerShell 7+ 預設已經是 UTF-8,所以這問題少很多。

### 陷阱 4:`Select-String` 不是 grep(小心不同)

```powershell
Select-String "error" log.txt     # 大致等同 grep,但回傳是 MatchInfo 物件
```

物件導向的好處是你可以 `| Select-Object LineNumber, Line`,但跟 bash 的 grep 不是 1:1 等價。

---

## 八、下一步

- 要寫 `.ps1` 腳本?去看 `PowerShell-寫腳本.md`
- 查官方文件:`Get-Help <cmdlet> -Online` 會直接開對應頁面
- 日常查詢:<https://learn.microsoft.com/powershell>

**本篇帶走三件事**:
1. Claude Code 在你機器上用的是 bash,但學 PowerShell + 讀指令技巧仍然值得
2. Cmdlet 是 Verb-Noun,pipeline 傳物件不傳文字
3. Allow 前永遠看清楚:**刪什麼路徑、改什麼狀態、有沒有跨網路**
