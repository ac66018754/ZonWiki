# iOS 捷徑 × Scriptable 小工具 — 在 iPhone 主畫面玩轉時間追蹤

> 目標：**不打開 ZonWiki 網頁**，在 iPhone（iOS 17+，iPhone 16 適用）主畫面就能
> 開始／結束計時、還能被動看到今日／本週統計。原理：
> - **捷徑（Shortcuts）**＝按一下「觸發一個動作」（開始／結束），直接打 ZonWiki 的 HTTP API。
> - **Scriptable 小工具**＝在桌面「被動顯示」你的資料（今日／本週統計、進行中清單）。
>
> 兩者都以你的 **API 權杖（PAT）** 認證，和你在網頁上的操作是同一批資料。

---

## 步驟 0：取得 API 權杖（一次性）

1. 瀏覽器登入 ZonWiki → 右上角頭像 → **個人頁面** → 左側「**API 權杖**」。
2. 「產生權杖」，命名如 `iphone`，到期自訂。**明碼只顯示一次**，先複製。
3. 之後以下都把你的網址記為 `https://zonwiki.pee-yang.com`、權杖記為 `<PAT>`。

> ⚠️ **安全**：這把權杖等於你的身分。別貼進聊天室、別提交到公開 repo；Scriptable 腳本裡雖然會內嵌它（個人自用可接受），但那份 `.js` 請只放自己手機、勿上傳。若不慎外洩，回同一頁撤銷重生。

---

# Part A：捷徑（觸發動作）

## 捷徑 A：⏱ 開始計時（新增 or 選既有 + 可選備註）

在「捷徑」App 新增捷徑，加入以下動作（由上而下）：

1. **從選單選擇（Choose from Menu）** → 兩個選項：`選既有`、`新增`。
   下面分兩個分支填動作：

   **分支「選既有」**：
   - **取得 URL 內容**：`GET https://zonwiki.pee-yang.com/api/time-entries/recent-items`，標頭 `Authorization` = `Bearer <PAT>`。
   - **取得字典值** → 鍵 `data`（得到既有項目清單）。
   - **從清單選擇** → 來源為上一步；每項顯示 `title`（挑「打LOL」那種）。
   - 把選中項目分別 **取得字典值** `title`、`category`，各存成變數「項目名稱」「分類」。

   **分支「新增」**：
   - **要求輸入** → 「做什麼？」→ 存成「項目名稱」。
   - （可選）**要求輸入** 或 **從選單選擇** → 「分類」。

2. **要求輸入（Ask for Input）** → 提示「備註（可略）」，**允許空白** → 存成「備註」。
   （例：選了「打LOL／休閒娛樂」後，備註填「玩隨機單中一場」。）

3. **取得 URL 內容**：
   - URL：`https://zonwiki.pee-yang.com/api/time-entries`
   - 方法：**POST**
   - 標頭：`Authorization` = `Bearer <PAT>`
   - 要求本文：**JSON**，三個欄位——`title`＝項目名稱、`category`＝分類、`note`＝備註。

4. **顯示通知** → 「已開始：〔項目名稱〕」。

命名「⏱ 開始計時」→ 加入主畫面。

## 捷徑 B：⏹ 結束計時（從進行中清單挑一個）

1. **取得 URL 內容**：`GET https://zonwiki.pee-yang.com/api/time-entries/running`（標頭帶 `Bearer <PAT>`）。
2. **取得字典值** → 鍵 `data`。
3. **從清單選擇** → 每項顯示 `title`。
4. **取得字典值** → 從選中項目取 `id`。
5. **取得 URL 內容**：`POST https://zonwiki.pee-yang.com/api/time-entries/〔id〕/stop`（標頭帶 `Bearer <PAT>`，本文可不填）。
6. **顯示通知** → 「已結束 ✅」。

命名「⏹ 結束計時」→ 加入主畫面。

> 想要「一鍵結束最近開始的那筆、免挑清單」？把步驟 1–4 換成單一 **取得 URL 內容** `POST /api/time-entries/stop-latest`（不用 body）即可。

## 捷徑 C：結束計時（確認）— 給進行中小工具用的「二次確認」捷徑

這支是給下面 Part B 的「進行中小工具」點列時呼叫的。它接收一個項目 id、跳確認框、確定後才結束（**防手誤**）：

1. 捷徑最上方會自動有「**捷徑輸入（Shortcut Input）**」＝被帶進來的項目 id。
2. **取得 URL 內容**：`GET https://zonwiki.pee-yang.com/api/time-entries/〔捷徑輸入〕`（其實可略；若想在確認框顯示名稱，可先 GET 這筆拿 `title`）。
3. **如果（If）** 你想顯示名稱——把上一步的 `title` 取出。
4. **顯示提醒（Show Alert）**（這一步就是二次確認）：標題「確定結束？」、內文可帶名稱、按鈕「結束／取消」。使用者按「取消」時捷徑會中止。
5. **取得 URL 內容**：`POST https://zonwiki.pee-yang.com/api/time-entries/〔捷徑輸入〕/stop`（標頭帶 `Bearer <PAT>`）。
6. **顯示通知** → 「已結束 ✅」。

命名務必為「**結束計時（確認）**」（要和小工具腳本裡的 `STOP_SHORTCUT_NAME` 一字不差）。**不用**加到主畫面——它是被小工具呼叫的。

---

# Part B：Scriptable 小工具（被動顯示）

主畫面的「捷徑」小工具只會顯示一顆按鈕、不會顯示資料。要在桌面**被動看到數字**，用免費的 **Scriptable** App 跑一段 JS 打 API、自繪小工具。

## 安裝

1. App Store 裝 **Scriptable**（免費）。
2. 本專案已附兩個腳本（在 [docs/ios-widgets/](./ios-widgets/)）：
   - [`zonwiki-time-summary.js`](./ios-widgets/zonwiki-time-summary.js)：今日／本週統計（總時長、進行中、依分類）。
   - [`zonwiki-time-running.js`](./ios-widgets/zonwiki-time-running.js)：進行中清單，**點列＝結束**（走上面捷徑 C 二次確認）。
3. 開 Scriptable → 右上「＋」新增腳本 → 把對應 `.js` 內容整段貼上。
4. 每個腳本最上方有 `BASE`、`PAT`（running 的還有 `STOP_SHORTCUT_NAME`）要填成你自己的值。
5. 各存成一個腳本（名稱隨意，例如「時間-今日」「時間-進行中」）。

## 加到主畫面

1. 回主畫面 → 長按空白 → 左上「＋」→ 搜尋 **Scriptable** → 選尺寸（**建議中或大**）→ 加入。
2. 長按剛加的小工具 → **編輯小工具**：
   - **Script**：選你貼的腳本。
   - **When Interacting**：`Run Script`（進行中小工具要能點列結束，必須設這個）。
   - **Parameter**（只有 summary 腳本要填）：`day` 或 `week`——想同時看今日和本週，就加兩個小工具、各填一個。

## 這些小工具能做到／做不到什麼（先講清楚）

- **今日／本週統計**：完全 OK，桌面被動顯示總時長、進行中數、依分類小計。**但不是即時碼表**——進行中項目的秒數只在 iOS 刷新小工具時（通常數分鐘一次）才更新。
- **進行中「點列結束」**：可以，但點下去是「跳去捷徑跑結束、再跳回」，不是留在桌面原地完成；而且點完清單要等下次刷新才更新。防手誤走捷徑 C 的**確認框**（點錯了在確認框按「取消」即可）。
- 小工具**尺寸限制**：小尺寸只允許單一點擊區，逐列點結束**需要中或大尺寸**。

---

## API 速查（自訂用）

所有端點帶 `Authorization: Bearer <PAT>`，回傳 `{ success, data, error }`：

| 想做的事 | 方法 · 路徑 | Body / 回傳重點 |
|---|---|---|
| 開始計時 | `POST /api/time-entries` | `{"title","category?","note?","startedDateTime?"}`（時間可帶 `+08:00`，後端轉 UTC） |
| 一鍵結束最近的 | `POST /api/time-entries/stop-latest` | 無 |
| 結束指定一筆 | `POST /api/time-entries/{id}/stop` | 可省略 |
| 進行中清單 | `GET /api/time-entries/running` | `data[]`：id/title/category/note/startedDateTime |
| 既有項目（選既有） | `GET /api/time-entries/recent-items` | `data[]`：distinct {title, category}，最近用過在前 |
| 今日／本週彙總 | `GET /api/time-entries/summary?scope=day\|week` | `data`：totalSeconds/runningCount/items[]/byCategory[]（依使用者時區歸日週） |
| 編輯 | `PUT /api/time-entries/{id}` | 欄位皆選擇性（含 note） |

> 限流：寫入端點以使用者為單位限流（令牌桶 30、每分鐘補 15），正常使用不會碰到；捷徑迴圈打爆會收到 429，稍等即可。GET（清單／彙總）不限流。
