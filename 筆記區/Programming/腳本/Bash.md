# Bash 基礎:看懂 AI 在幹嘛

Bash 是 Claude Code 在你 Windows 機器上實際使用的 shell(透過 Git for Windows 附的 Git Bash)。也就是說,**AI 每次跳出 permission prompt,那段指令就是 Bash**。

這份筆記的主軸是「**看到指令能讀懂,決定要不要 Allow**」。互動式自己打指令、寫簡單腳本也會一併教,但讀懂 AI 的指令是最重要的目標。

---

## 零、先搞清楚環境

### Bash 是誰?

Bash = "Bourne Again SHell"。1989 年誕生,Linux / macOS 的傳統預設 shell(macOS 14+ 改用 zsh,但語法 99% 相容)。

### 你 Windows 上的 Bash 從哪來?

有幾種可能,搞清楚是哪一種:

| 來源                  | 位置                           | 特性                                     |
| :-------------------- | :----------------------------- | :--------------------------------------- |
| **Git Bash**          | `C:\Program Files\Git\bin\bash.exe` | 裝 Git for Windows 就有,Claude Code 預設用這個 |
| **WSL2**              | 透過 `wsl` 指令進入            | 完整 Linux,檔案系統獨立(在 `\\wsl$\...`) |
| **MSYS2 / Cygwin**    | 自己裝                         | 比較少見                                 |

你可以在 Git Bash 裡打 `uname -a` 看:

```
MINGW64_NT-10.0-26200 ... Msys
```

"MINGW64" = Git Bash / MSYS2。"Linux" = WSL2。

### Git Bash 的限制要知道

Git Bash **不是完整 Linux**,很多系統 API、process、網路行為跟真 Linux 有差。大部分日常指令(ls、grep、find、sed、awk、curl、git)都有,但偶爾會遇到某個 Linux 專屬的東西在 Git Bash 裡不存在。

---

## 一、指令的結構:程式 + flag + 參數

幾乎每個 Bash 指令都長這樣:

```
程式名稱    [flag / options]    [arguments]
   │              │                  │
   ls            -la                ~/projects
   │              │                  │
   程式         參數(開關)          位置參數
```

### Flag 的三種寫法

| 形式        | 範例                              | 說明                          |
| :---------- | :-------------------------------- | :---------------------------- |
| 短旗標       | `-l`、`-a`、`-v`                  | 可以合併:`-la` = `-l -a`     |
| 長旗標       | `--long`、`--help`、`--verbose`   | 可讀性高                      |
| 帶值        | `-p 8080`、`--port=8080`          | 有的用空白,有的用 `=`        |

### 看 help 最穩

**不認識一個指令?先看它的 help**:

```bash
ls --help               # 大部分 GNU 工具都支援
man ls                  # manual page,更詳細(Git Bash 可能沒有)
tldr ls                 # 人類友善的範例集(需另裝)
```

**這是讀 AI 指令的第一招**:看到不認識的 flag,丟 `--help` 查清楚再 Allow。

---

## 二、日常會看到的指令

### 2.1 檔案與目錄

```bash
ls                      # 列目錄
ls -la                  # -l 詳細格式,-a 含隱藏檔
ls -lh                  # -h 人類可讀大小(KB / MB)

cd /path                # 切目錄
cd ..                   # 上一層
cd ~                    # 回 home
cd -                    # 回上一次的目錄

pwd                     # 目前目錄
```

### 2.2 看檔案內容

```bash
cat file.txt            # 整份印出來
less file.txt           # 分頁看(q 離開,/搜尋)
head -20 file.txt       # 前 20 行
tail -20 file.txt       # 後 20 行
tail -f log.txt         # 持續追蹤新內容(log 必備)
wc -l file.txt          # 算行數
```

### 2.3 建立 / 複製 / 刪除

```bash
mkdir newdir            # 建資料夾
mkdir -p a/b/c          # -p 一次建多層

touch file.txt          # 建空檔 或 更新時間戳

cp a.txt b.txt          # 複製檔
cp -r dirA dirB         # -r 複製整個資料夾

mv a.txt b.txt          # 移動 / 改名

rm file.txt             # 刪檔(⚠️ 沒有回收站!)
rm -r dir               # 刪整個資料夾
rm -rf dir              # 🔴 強制 + 遞迴 + 不問
```

### 2.4 找檔案 / 找內容

```bash
find . -name "*.md"                 # 找當前目錄下所有 .md
find . -type f -mtime -7            # 7 天內修改的檔案
find . -name "*.log" -delete        # 🔴 找到就刪(危險)

grep "error" log.txt                # 找含 "error" 的行
grep -r "TODO" src/                 # 遞迴找
grep -i "error"                     # -i 不區分大小寫
grep -n "error"                     # -n 顯示行號
grep -v "error"                     # -v 反向(不含的)
```

**比 grep 更快更好的**:`rg`(ripgrep)。現代工具,預設跳過 `.gitignore` 內的東西:

```bash
rg "TODO"                           # 遞迴、自動忽略 node_modules / .git
rg -t py "import"                   # 只搜 python
```

### 2.5 process 與系統

```bash
ps                                  # 當前 shell 的 process
ps aux                              # 全系統
ps aux | grep node                  # 找 node 相關

kill 1234                           # 送 SIGTERM 給 PID 1234
kill -9 1234                        # SIGKILL(強制,不可擋)
pkill chrome                        # 按名字砍

top                                 # 即時監看(q 離開)
htop                                # 比 top 好看(需另裝)
```

### 2.6 網路

```bash
curl https://api.github.com                   # GET
curl -X POST -d '{"a":1}' https://...         # POST
curl -o output.html https://...               # 存到檔
curl -H "Authorization: Bearer $TOKEN" ...    # 加 header

wget https://xxx.zip                          # 下載
ping google.com                               # 測連通
```

### 2.7 環境變數

```bash
echo $HOME                          # 看值
echo $PATH                          # 看 PATH
export MY_KEY="secret"              # 設定(當前 shell)
env                                 # 看所有環境變數
unset MY_KEY                        # 移除
```

---

## 三、Pipeline 與重導向

### 3.1 Pipeline `|`

把前一個程式的輸出,當下一個程式的輸入。**這是 Unix 哲學的精髓**——小工具串起來完成大事:

```bash
# 找 chrome 相關的 process
ps aux | grep chrome

# 算專案有幾個 .cs 檔
find . -name "*.cs" | wc -l

# 看最大的 5 個檔
du -h * | sort -h | tail -5
```

Bash 的 pipeline 傳的是**文字**(跟 PowerShell 的物件 pipeline 不同)。所以你常會看到 `awk`、`sed`、`cut` 這些「把文字切來切去」的工具。

### 3.2 重導向

| 符號   | 意思                          | 範例                                |
| :----- | :---------------------------- | :---------------------------------- |
| `>`    | 把 stdout 寫到檔(**覆蓋**)  | `echo hello > file.txt`             |
| `>>`   | 把 stdout 追加到檔            | `echo more >> file.txt`             |
| `<`    | 把檔當 stdin                  | `sort < names.txt`                  |
| `2>`   | 把 stderr 寫到檔              | `cmd 2> errors.log`                 |
| `2>&1` | 把 stderr 併到 stdout         | `cmd > out.log 2>&1`                |
| `&>`   | stdout + stderr 都寫到同一檔  | `cmd &> all.log`                    |
| `/dev/null` | 黑洞,丟進去就消失         | `cmd > /dev/null 2>&1`              |

**常見模式**:

```bash
# 把所有輸出都吞掉(只關心成功或失敗)
do_something > /dev/null 2>&1

# 存正常輸出,錯誤另外存
my_script > out.log 2> err.log
```

---

## 四、變數與命令替換

### 4.1 變數

```bash
name="Alice"            # ⚠️ = 兩邊不能有空白!
echo $name              # Alice
echo "${name}"          # 建議用 ${} 包,遇到後面接字元才不會搞混
echo "${name}_suffix"
```

### 4.2 命令替換

把某個指令的輸出塞進變數:

```bash
today=$(date +%Y-%m-%d)
echo "Today is $today"

# 舊寫法(少用)
today=`date +%Y-%m-%d`
```

### 4.3 內建變數

| 變數       | 意義                                   |
| :--------- | :------------------------------------- |
| `$HOME`    | 使用者家目錄                           |
| `$USER`    | 當前使用者                             |
| `$PWD`     | 當前目錄(= `pwd`)                     |
| `$?`       | 上一個指令的 exit code(0 = 成功)      |
| `$0`       | 腳本名稱                               |
| `$1` `$2`  | 腳本第 1、第 2 個參數                  |
| `$@`       | 所有參數                               |
| `$$`       | 當前 shell 的 PID                      |

`$?` 超常用:

```bash
some_command
if [ $? -eq 0 ]; then
    echo "成功"
fi
```

---

## 五、⭐ 讀 AI 指令的生存指南

這是本篇**最重要**的一章。Claude Code 跳 permission prompt 時,多花 10 秒看清楚指令,就能避免 99% 的意外。

### 5.1 風險分級

| 風險      | 特徵                           | 範例                                              | 反應               |
| :-------- | :----------------------------- | :------------------------------------------------ | :----------------- |
| 🟢 低      | 只讀、只查                     | `ls`、`cat`、`git status`、`grep ...`             | 直接 Allow         |
| 🟡 中      | 改本機檔,範圍明確              | `git add`、`npm install`、`sed -i file`           | 看清楚路徑後 Allow |
| 🟠 高      | 網路下載、改遠端               | `curl -O`、`git push`、`gh pr create`             | 先問用途           |
| 🔴 極高    | 不可逆 / 執行未知程式          | `rm -rf`、`git reset --hard`、`curl \| sh`        | **Deny 或先檢查**  |

### 5.2 看到這些模式要警覺

#### 🚨 會直接刪資料

```bash
rm -rf path                    # 遞迴 + 強制,沒救援
rm -rf $VAR/*                  # ⚠️⚠️ 如果 $VAR 空的 = rm -rf /*!
git clean -fd                  # 砍所有未追蹤檔
git reset --hard               # 丟掉所有未 commit 改動
git checkout .                 # 丟掉所有未 staged 改動
docker compose down -v         # -v 把 volume 一起砍(資料沒了)
docker volume prune -f         # 清所有沒在用的 volume
find . -name "xxx" -delete     # 找到就刪
```

**關鍵字警報表**:看到這些要暫停看清楚。

| 關鍵字                  | 為什麼危險                                    |
| :---------------------- | :-------------------------------------------- |
| `-r` / `-R` / `--recursive` | 遞迴,範圍可能比你想的大                   |
| `-f` / `--force`        | 跳過確認                                      |
| `-rf` / `-fr`           | **雙倍警戒**                                  |
| `--hard`                | `git reset --hard` 毀掉未 commit              |
| `$UNDEFINED/*`          | 變數沒定義 = 根目錄全砍                       |
| `/` 當路徑              | 根目錄                                        |
| `~` 當路徑              | 家目錄                                        |

#### 🚨 會影響遠端

| 指令                           | 結果                                    |
| :----------------------------- | :-------------------------------------- |
| `git push --force`             | 覆寫遠端歷史,別人會爆炸                |
| `git push --force-with-lease`  | 安全一點,但還是改遠端                  |
| `gh pr merge`                  | 合進去,回不去                          |
| `npm publish`                  | **發到公開 registry,撤不回**           |
| `docker push`                  | 推到 registry                           |

#### 🚨🚨 下載後直接執行:最危險的模式

```bash
curl https://x.com/install.sh | sh               # ⚠️ 下載 + 直接跑
curl https://x.com/install.sh | bash             # 同上
wget -O- https://x.com/x.sh | sh                 # 同上
bash <(curl -s https://x.com/x.sh)               # 同上變形
eval "$(curl -s https://x.com)"                  # 變本加厲
```

為什麼致命:
1. 你**完全沒審過**那段腳本
2. 網址內容**下次可能被換掉**(供應鏈攻擊)
3. 腳本拿到跟你一樣的權限 — 能刪你檔、偷你 SSH key、裝後門

**安全替代**:

```bash
curl -O https://x.com/install.sh    # 先下載
less install.sh                     # 自己看
./install.sh                        # 確定沒問題再跑
```

#### 🚨 會動權限 / 系統設定

```bash
chmod 777 file                    # 所有人可讀寫執行
chmod -R 777 dir                  # 遞迴(災難模式)
sudo ...                          # 提權,後果放大
```

#### 🚨 會碰機敏資訊

看到指令在動這些路徑,多問一句「為什麼要碰?」:

- `~/.ssh/` — SSH 私鑰
- `~/.aws/credentials`、`~/.config/gcloud/` — 雲端金鑰
- `~/.git-credentials`、`~/.netrc` — Git 認證
- `.env`、`*.pem`、`*.key` — 應用程式 secret

搭配 `curl -X POST -d @file ...` / `| nc host port` / `base64 | curl ...` 這類**外送**語法 = **紅色警報**。

### 5.3 自保技巧

#### 技巧 1:要求先 dry-run / `-n`

| 指令              | dry-run 版                |
| :---------------- | :------------------------ |
| `rm`              | 沒 dry-run,但可以 `ls` 一次確認範圍 |
| `git clean -fd`   | `git clean -nd`           |
| `rsync ...`       | `rsync --dry-run ...`     |
| `npm publish`     | `npm publish --dry-run`   |
| `find ... -delete` | 先拿掉 `-delete` 看會撈到什麼 |

看到破壞性指令,**可以要求 AI 先跑 dry-run 版給你看**。

#### 技巧 2:追問變數值

AI 丟這種:

```bash
rm -rf "$BUILD_DIR"/*
```

先問「`$BUILD_DIR` 是什麼值」。如果 AI 不知道、或它是空的 → **絕對 Deny**。

#### 技巧 3:Deny 不會扣分

Permission prompt 不是考試。**不確定就 Deny**,AI 會跟你解釋它想幹嘛,你看懂了再決定。

#### 技巧 4:白名單 + 黑名單

專案 `.claude/settings.json` 可以設:

```json
{
  "permissions": {
    "allow": [
      "Bash(ls:*)",
      "Bash(cat:*)",
      "Bash(git status:*)",
      "Bash(git log:*)",
      "Bash(git diff:*)"
    ],
    "deny": [
      "Bash(rm -rf:*)",
      "Bash(git push --force:*)",
      "Bash(curl *| sh:*)",
      "Bash(sudo:*)"
    ]
  }
}
```

### 5.4 「要不要 Allow」決策樹

```
跳 Permission Prompt
    │
    ├── 是「讀、查、列、看」嗎?
    │   └── 是 → Allow ✅
    │
    ├── 會改本機檔?
    │   ├── 路徑明確、可預期   → Allow ✅
    │   └── 路徑是 $變數 / wildcard → 追問變數值 ❓
    │
    ├── 會改遠端(push, publish, merge)?
    │   └── 先搞清楚「改到哪、對誰有影響」→ OK 才 Allow
    │
    ├── 會下載網路內容 + 執行(| sh)?
    │   └── Deny ❌,改手動下載、審過、再跑
    │
    └── 含 -rf / --force / reset --hard?
        └── 先看 dry-run 或逐項檢查,不急 Allow
```

### 5.5 一個真實對照

**看起來一樣、實際差很多**:

```bash
rm -rf build                  # 刪當前目錄的 build/,OK
rm -rf /build                 # 刪根目錄的 /build/,多半沒這個,無害
rm -rf / build                # 🔴🔴🔴 中間那個空白 = 從根開始砍!
rm -rf $BUILD                 # 如果 $BUILD 沒定義 = rm -rf(什麼都不會砍,但還是壞習慣)
rm -rf "$BUILD/"              # 如果 $BUILD 沒定義 = rm -rf "/" = 死刑
```

**一個空白字元就是生與死的差別**。讀指令慢一點,不要急。

---

## 六、簡單的腳本寫法

AI 偶爾會丟「一次跑好幾行」的指令,基本結構長這樣。

### 6.1 條件

```bash
if [ -f "file.txt" ]; then
    echo "檔案存在"
elif [ -d "dir" ]; then
    echo "是資料夾"
else
    echo "都不是"
fi
```

常用檢查:

| 寫法        | 意思              |
| :---------- | :---------------- |
| `-f file`   | 是普通檔案        |
| `-d dir`    | 是資料夾          |
| `-e path`   | 存在(任何類型)   |
| `-z "$s"`   | 字串是空          |
| `-n "$s"`   | 字串非空          |
| `"$a" = "$b"` | 字串相等(一個 =)|
| `"$a" -eq 5`| 整數相等          |

⚠️ Bash 的 `=` 兩邊**需要空白**,變數要**加雙引號**,這些都跟別的語言不太一樣。

### 6.2 迴圈

```bash
for f in *.md; do
    echo "$f"
done

for i in 1 2 3 4 5; do
    echo $i
done

while read line; do
    echo "$line"
done < file.txt
```

### 6.3 把指令串起來

| 符號    | 意思                                       |
| :------ | :----------------------------------------- |
| `;`     | 不管前面成功失敗,都跑後面                 |
| `&&`    | 前面**成功**才跑後面                       |
| `\|\|`  | 前面**失敗**才跑後面                       |
| `&`     | 前面丟背景跑,繼續後面                     |

```bash
mkdir build && cd build && cmake ..
# 任一步失敗就中止,這是最常見的「乖乖鏈」
```

---

## 七、常見陷阱

### 陷阱 1:變數沒加引號

```bash
file="my file.txt"
rm $file                   # ❌ 會變成 rm "my" "file.txt"
rm "$file"                 # ✅
```

### 陷阱 2:`=` 左右多了空白

```bash
name = "Alice"             # ❌ 語法錯
name="Alice"               # ✅
```

### 陷阱 3:單引號 vs 雙引號

```bash
name="Alice"
echo "$name"               # Alice(雙引號會展開變數)
echo '$name'               # $name(單引號原樣輸出)
```

### 陷阱 4:Windows 行尾(CRLF)害 script 失敗

從 Windows 編輯器存的 `.sh` 檔可能帶 `\r\n`,在 bash 裡會看到詭異錯誤。解法:

```bash
dos2unix script.sh
# 或在 VS Code 右下角把 "CRLF" 改成 "LF"
```

### 陷阱 5:忘了 `set -e` 的腳本會沉默失敗

寫腳本時的起手式:

```bash
#!/usr/bin/env bash
set -euo pipefail     # e: 任一指令失敗就退;u: 用到未定義變數就錯;o pipefail: pipe 中間失敗不會被遮
```

沒這行的話,腳本會在錯誤中繼續跑,很容易「看起來成功其實一半沒做到」。

---

## 八、bash ↔ PowerShell 對照(快速切換用)

| 做什麼          | Bash                       | PowerShell                       |
| :-------------- | :------------------------- | :------------------------------- |
| 列目錄          | `ls -la`                   | `Get-ChildItem -Force` / `ls`    |
| 看檔            | `cat file`                 | `Get-Content file` / `cat`       |
| 追日誌          | `tail -f log`              | `Get-Content log -Wait -Tail 10` |
| 複製            | `cp a b`                   | `Copy-Item a b` / `cp`           |
| 刪整個資料夾    | `rm -rf dir`               | `Remove-Item dir -Recurse -Force`|
| 找檔            | `find . -name "*.cs"`      | `Get-ChildItem -Recurse -Filter *.cs` |
| 搜內容          | `grep "x" file`            | `Select-String "x" file`         |
| 變數            | `x=5` / `$x`               | `$x = 5` / `$x`                  |
| 環境變數        | `$HOME` / `$PATH`          | `$env:USERPROFILE` / `$env:PATH` |
| 命令替換        | `$(cmd)` / `` `cmd` ``     | `$(cmd)`                         |
| 當前目錄        | `$(pwd)` / `$PWD`          | `$PWD` / `${PWD}`                |
| 換行連接        | `\`                        | `` ` `` (反引號)                  |
| 成功才下一個    | `a && b`                   | `a; if ($?) { b }`               |

---

## 九、帶走這些重點

1. **Bash pipeline 傳文字**,所以會看到一堆 `awk / sed / cut / grep` 在剖字串
2. **Allow 前先讀指令**:有沒有 `-rf`?變數值是什麼?有沒有 pipe 到 sh?
3. **最危險模式**:`curl ... | sh`、`rm -rf $variable/*`、`git push --force`
4. **不確定就 Deny**,不會被扣分
5. 寫腳本起手式:`set -euo pipefail`

讀懂 AI 的 80% 指令大概就這些。剩下 20% 遇到查 `man` 或問 AI 本人解釋。

---

## 延伸資源

- **查指令**:`man <name>`(Git Bash 可能沒裝)、`tldr <name>`(範例)
- **線上速查**:<https://explainshell.com/> — 貼整串 bash 指令,會**逐段標記每個 flag 做什麼**,讀 AI 指令的神器
- **進階學習**:<https://www.gnu.org/software/bash/manual/>
- **shell 語法檢查**:<https://www.shellcheck.net/> — 貼腳本會幫你抓 bug
