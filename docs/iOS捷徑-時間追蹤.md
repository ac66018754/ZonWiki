# iOS 捷徑 × 時間追蹤 — 在 iPhone 主畫面一鍵「開始／結束」計時

> 目標：**不用打開 ZonWiki**，在 iPhone（iOS 17+，iPhone 16 適用）主畫面點一下就能
> 「新增計時項目」與「結束計時」。原理：iOS「捷徑」App 以你的 **API 權杖（PAT）**
> 直接呼叫 ZonWiki 的時間追蹤 API（與網頁操作同一批資料，首頁面板即時可見）。

---

## 步驟 0：取得 API 權杖（一次性）

1. 用瀏覽器登入 ZonWiki → 右上角頭像 → **個人頁面** → 左側「**API 權杖**」。
2. 點「產生權杖」，名稱填例如 `iphone-shortcuts`，到期時間自訂（也可永不過期）。
3. **權杖明碼只會顯示這一次**，先複製下來（形如 `zwk_xxxxxxxx...`）。
   之後若外洩，回同一頁隨時可撤銷。

> 以下把你的站台網址記為 `https://zonwiki.pee-yang.com`（自架者換成自己的網址）、
> 權杖記為 `<PAT>`。

---

## 捷徑 A：「⏱ 開始計時」

在「捷徑」App → 右上「＋」新增捷徑，依序加入動作：

1. **要求輸入**（Ask for Input）
   - 提示：`做什麼？`、輸入類型：文字 → 結果＝**項目名稱**。
2. （可選）**從選單選擇**（Choose from Menu）
   - 選項填你常用的分類：`工作`、`學習`、`運動`、`雜事`…（每個選項不需子動作）→ 結果＝**分類**。
   - 不想每次選分類的話，跳過此步、body 裡拿掉 category 即可。
3. **取得 URL 內容**（Get Contents of URL）
   - URL：`https://zonwiki.pee-yang.com/api/time-entries`
   - 方法：**POST**
   - 標頭（Headers）：
     - `Authorization`：`Bearer <PAT>`
     - `Content-Type`：`application/json`
   - 要求本文（Request Body）：**JSON**
     - `title` = 〔步驟 1 的「提供的輸入」變數〕
     - `category` = 〔步驟 2 的「選單結果」變數〕（沒做步驟 2 就不填這個鍵）
4. **顯示通知**（Show Notification）
   - 內容：`已開始計時 ⏱`（也可插入步驟 1 的變數：`已開始：〔提供的輸入〕`）。

命名捷徑為「⏱ 開始計時」→ 分享 → **加入主畫面**。

> 開始時間＝按下的當下（伺服器 UTC 記錄、顯示時自動轉你的時區）。
> 忘了按也沒關係——之後在 ZonWiki 首頁面板點「✎」可以**補改開始/結束時間**。

---

## 捷徑 B：「⏹ 結束計時」（一鍵結束最近開始的項目）

1. **取得 URL 內容**
   - URL：`https://zonwiki.pee-yang.com/api/time-entries/stop-latest`
   - 方法：**POST**
   - 標頭：`Authorization`：`Bearer <PAT>`
   - 本文：不用填。
2. **取得字典值**（Get Dictionary Value）：鍵 `data.title` ← 來源＝上一步結果。
3. （可選）再加一個**取得字典值**：鍵 `data.durationSeconds`，接一個**計算**動作 `÷ 60`
   ＋**四捨五入**，得到分鐘數。
4. **顯示通知**：`已結束：〔title〕（〔分鐘〕分）`。

命名「⏹ 結束計時」→ 加入主畫面。

> 若同時掛著多個計時，stop-latest 會結束「**最近開始**」的那一個
> （完全同時開始時以建立時間較晚者優先，行為固定）。
> 沒有任何進行中項目時會回 404，通知會顯示錯誤——屬正常。

---

## 進階捷徑 B'：「⏹ 選一個結束」（多項並行時用）

1. **取得 URL 內容**：GET `https://zonwiki.pee-yang.com/api/time-entries/running`
   （標頭同上）。
2. **取得字典值**：鍵 `data` → 得到進行中清單。
3. **從清單選擇**（Choose from List）：來源＝上一步；每一項顯示其 `title`。
4. **取得字典值**：鍵 `id` ← 來源＝選中的項目。
5. **取得 URL 內容**：POST `https://zonwiki.pee-yang.com/api/time-entries/〔id〕/stop`
   （標頭同上，本文不用填）。
6. **顯示通知**：`已結束 ✅`。

---

## API 速查（給想自訂的人）

所有端點都吃 `Authorization: Bearer <PAT>`，回應格式 `{ success, data, error, statusCode }`：

| 動作 | 方法與路徑 | Body |
|---|---|---|
| 開始計時 | `POST /api/time-entries` | `{ "title": "讀書", "category": "學習", "startedDateTime": "2026-07-15T14:00:00+08:00" }`（後兩者可省略；時間可帶時區 offset，會正確轉 UTC） |
| 一鍵結束最近項目 | `POST /api/time-entries/stop-latest` | 無 |
| 結束指定項目 | `POST /api/time-entries/{id}/stop` | `{ "endedDateTime": "..." }`（可省略＝當下） |
| 進行中清單 | `GET /api/time-entries/running` | — |
| 區間清單 | `GET /api/time-entries?from=...&to=...` | —（UTC ISO；`[from, to)`，依開始時間歸組） |
| 編輯 | `PUT /api/time-entries/{id}` | 欄位皆選擇性 |
| 刪除（軟刪除） | `DELETE /api/time-entries/{id}` | —（可在垃圾桶還原） |

> 限流：寫入端點以使用者為單位限流（令牌桶 30、每分鐘補 15）——正常使用不會碰到；
> 若捷徑迴圈打爆會收到 429，稍等即可。
