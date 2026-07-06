# AI 後援鏈（Provider Fallback Chain）＋階段顯示 — 設計與測試計畫

> 分支：`feature/ai-fallback-chain`（從 `feature/ux-batch-improvements` HEAD 開，完成後合併回 ux-batch）
> 日期：2026-07-01

## 1. 背景與目標

ZonWiki 目前「大家都一樣」的 AI 動作（筆記問答／美化／排版／精煉）一律走全站共用預設 `banana-gemini-lite`（Gemini relay）。當 banana 故障（曾發生 503）時整批 AI 失能。

**目標**：把「會走共用預設」的所有路徑改成**有序後援鏈**，依序嘗試、自動換家，並讓使用者在 AI 佇列（小窗＋完整頁）**即時看到目前在用哪家、第幾次、以及每次失敗的錯誤**。

### 後援順序（所有使用者帳號一致）
1. **Claude Code CLI**（`claude -p`，VM host 登入的 Max 帳號，已掛進 api 容器）— `ClaudeCliProvider`
2. **Google AI Studio**（Gemini 直連，OpenAI 相容端點，最便宜 `gemini-2.0-flash-lite`）— `OpenAiCompatibleStreamingProvider`
3. **banana**（既有 Gemini relay 共用預設）— `OpenAiCompatibleStreamingProvider`

### 重試規則
- 每一家**失敗後再重試 1 次**（共 2 次），仍失敗才換下一家。
- 3 家 × 2 次 = **最多 6 次嘗試**。
- 任一次成功即停止、串流該家輸出。
- 6 次全失敗 → 整體失敗，錯誤訊息保留**每次嘗試**的摘要供使用者檢視。

### 失敗的定義（任一即算一次失敗）
- 供應者拋例外
- 子程序非零退出（claude）／HTTP 非 2xx（OpenAI 相容）
- 逾時（沿用各 provider 既有 timeout）
- 回應為空白（whitespace-only completion 且無 Delta）

## 2. 範圍：改哪、不改哪

| # | 功能 | 進入點 | 處置 |
|---|------|--------|------|
| 1 | 開問啦節點提問（**有選模型**） | `AskOrchestrator`（`askFrom.Model` 非空） | **不變**（用所選單一模型） |
| 1' | 開問啦節點提問（**沒選模型＝預設**） | `AskOrchestrator`（`askFrom.Model` 空） | **改走鏈** |
| 2 | 筆記框選提問 | `AskQueueService.ExecuteAskSelectionAsync`→`INoteAiService.AskAboutAsync` | **改走鏈** |
| 3 | 便利貼「繼續問」/通用提問 | `/api/ai/ask`→`AskAboutAsync` | **改走鏈** |
| 4 | 筆記美化 Beautify | `INoteAiService.BeautifyAsync` | **改走鏈** |
| 5 | 筆記排版 Reformat | `INoteAiService.ReformatAsync` | **改走鏈** |
| 6 | 精煉成筆記 note-gen | `RefineService`（原走 Groq） | **改走鏈**（使用者選 b） |
| 7 | 精煉轉錄（音訊→字幕） | Groq/Gemini Whisper | 不變（非問答） |
| 8 | 圖片生成 | `ResolveImageGeneratorAsync` | 不變（使用者自選） |

**統一判準**：凡「系統原本會 fallback 到共用預設」之處 → 改走鏈；「明確選定特定模型」→ 維持單一供應者。

## 3. 後端設計

### 3.1 串流事件：新增 `Stage`（含明確簽名）
`AiStreamEventType` 增加 `Stage`；`AiStreamEvent` record 擴充可空欄位（保持既有位置參數相容）：
```csharp
public enum AiStreamEventType { Delta, Completed, Error, Stage }

public readonly record struct AiStreamEvent(
    AiStreamEventType Type,
    string Text,                       // Stage：失敗時為去敏錯誤摘要，AttemptStart 時為空
    string? RawLine = null,
    string? SessionId = null,
    // ↓ 僅 Stage 事件使用
    string? StageKind = null,          // "AttemptStart" | "AttemptFailed"
    string? ProviderLabel = null,      // "Claude CLI" | "Google AI Studio" | "banana"
    int? ProviderIndex = null,         // 第幾家 1..3
    int? AttemptInProvider = null,     // 該家第幾次 1..2
    int? AttemptInChain = null);       // 全鏈第幾次 1..6
```
> 相容性：既有消費者（只 switch Delta/Completed/Error）對 `Stage` 走 default 分支＝忽略，行為不變；終局仍是 Completed 或 Error。新消費者額外處理 `Stage`（reset + 寫佇列）。

### 3.2 `FallbackChainProvider : IAiProvider`（逐字直送 + 失敗清空重試）
> **決策（使用者拍板）**：採「**逐字直送 + 某家失敗就 reset 清空、換下一家重來**」，**不採緩衝**。保留開問啦逐字即時感；中途失敗也算失敗並乾淨換家。

- 建構子收一個**有序清單** `IReadOnlyList<ChainLink>`，每個 `ChainLink = { Label, IAiProvider, Model }`。
- `StreamAsync` 流程（對每個 link、每次 attempt，最多 2）：
  1. `yield Stage(StageKind=AttemptStart, ProviderLabel, ProviderIndex, AttemptInProvider, AttemptInChain)`。
     - **消費端語意**：收到 AttemptStart 時，若先前已串出過該工作的 Delta（前一次嘗試的殘留）→ **清空**（節點廣播 reset、字串累積器歸零）。
  2. 呼叫 `link.Provider.StreamAsync(...)`，**逐字轉發** Delta（即時送前端）。
  3. 該次結果判定：
     - 失敗（`Error` / 例外 / 逾時 / 空白完成）→ `yield Stage(StageKind=AttemptFailed, ProviderLabel, ..., Text=去敏錯誤摘要)`，進下一 attempt/家（下一個 AttemptStart 會觸發消費端清空已串內容）。
     - 成功（有非空 Completed，或有非空白 Delta 累積且正常結束）→ 轉發該家 `Completed` 並**結束整鏈**。
  4. 6 次全失敗 → `yield Error(彙整每次嘗試的去敏摘要)`。
- **「成功 vs 失敗」邊界（精確定義）**：該次嘗試結束時，若 `Completed.Text` 去除空白後為空字串、**且**整段未累積任何「非空白字元」的 Delta → 視為失敗（空白回應）；否則為成功。`Error` 事件、StreamAsync 拋例外、`CancellationToken` 以外的逾時 → 一律失敗。
- **取消**：外部 `CancellationToken` 取消時，立即停止、不再嘗試下一家、不吐 Completed（轉拋 `OperationCanceledException` 由呼叫端處理，與既有行為一致）。
- **空白判定的 provider 差異**：ClaudeCli 空輸出 → Completed("")（ClaudeCliProvider.cs:111）；OpenAiCompatible 空輸出 → Completed("")（OpenAiCompatibleStreamingProvider.cs:135）。兩者皆落入上述「空白回應」規則。

### 3.3 鏈的組裝：`AiProviderFactory.ResolveChainAsync()`
- 新方法回傳上述 3 家的 `FallbackChainProvider`：
  - link1：注入的預設 `ClaudeCliProvider`（`_default`），model = `null`（用 settings.json 的 sonnet）或共用 ClaudeCli 列的 ModelId。
  - link2：Google AI Studio 共用 AiModel（見 3.5）。
  - link3：banana 共用 AiModel（既有 `SharedModelUserId` 那列）。
  - 任一家缺設定則略過該家（鏈自動縮短，不報錯）。
- `GeminiNoteAiService` 改呼叫 `ResolveChainAsync()`（取代 `ResolveAsync(Guid.Empty, null)`）。
- `AskOrchestrator`：`askFrom.Model` 空 → `ResolveChainAsync()`；非空 → 維持 `ResolveAsync(userId, model)`。
- **RefineService（決策：使用者選 b）**：note-gen（文字整理/分類）由原本的 `GenerateViaGroqAsync` 改走 `ResolveChainAsync()`（Claude→AIStudio→banana）；**`GenerateViaGroqAsync` 與 Groq 常數保留給「音訊轉錄」用，不刪**（轉錄 #7 不在鏈內，Claude/Gemini 不擅長）。
- 測試模式（`FakeAiProvider`）仍短路為單一 Fake，保持 E2E 決定性。

### 3.4 階段／錯誤寫入 AiSession / AiMessage（佇列可見）＋ 串流 reset
**並行安全做法（取代審查者擔心的 channel）**：消費端的 `await foreach (evt in chain.StreamAsync())` 是**循序**處理；事件之間沒有並行 EF 操作、也沒有開著的 EF DataReader（AI 串流來自外部行程/HTTP，非 EF 查詢）。故「在事件迴圈內，遇到 `Stage` 時循序 `SaveChangesAsync`」是 **EF 安全**的（無需 channel／無需另一個 DbContext）。以整合測試證明之。

- 透過「**Stage 回呼**」把鏈與「擁有 AiSession 的那層」接起來（避免大改各 provider 介面）：
  - `AskQueueService.TrackAiAsync` / `ExecuteAskSelectionAsync` / `RefineService` 在 aiCall 內取得 `onStage`，往下傳給 `INoteAiService`／`AskOrchestrator` 的事件迴圈。
  - `INoteAiService` 各方法（AskAboutAsync/Beautify/Reformat/Generate）新增可選參數 `Func<AiStreamEvent,Task>? onStage`；TransformAsync 的迴圈遇 `Stage` 即呼叫，並在 `AttemptStart` 時把累積字串歸零（清空重試）。
- `onStage` 行為：
  - `AttemptStart`：更新 `AiSession.AiProvider` / `AiModelId` 為「目前這家」、`SaveChanges`（小窗即時顯示「目前：Claude (1/2)」）；新增一筆 `AiMessage(Role="stage", Content="▶ 嘗試 Claude (1/2)")`。
  - `AttemptFailed`：新增一筆 `AiMessage(Role="stage", Content="✗ Claude (1/2) 失敗：<去敏錯誤>")`。
- **串流節點（AskOrchestrator）的 reset**：事件迴圈遇 `AttemptStart` 且已廣播過 Delta → 廣播一個 reset（`NodeStreaming` 帶 `Reset=true` 或新事件 `NodeStreamReset`），前端 canvas 收到即清空該節點已串內容，再接續逐字。`accumulated` 同步歸零。
- 終局失敗：`AiSession.ErrorText` = 去敏彙整（沿用 `ApplyFailed` 的首行 + 500 字截斷）。
- **去敏**：擷取每家錯誤摘要時，先用正則移除可能的金鑰（如 `key=...`、`Bearer ...`、`sk-...`、`AIza...`、`AQ\.\S+`）與檔案路徑，再寫入 `AiMessage`/`ErrorText`。

### 3.5 Google AI Studio 共用模型（DB）
- 新增一筆 `AiModel`（`UserId = SharedModelUserId`，Provider=`OpenAiCompatible`）：
  - `BaseUrl = https://generativelanguage.googleapis.com/v1beta/openai/`
  - `ModelId = gemini-2.0-flash-lite`
  - `ApiKeyEncrypted`：用 DataProtection 加密存（**金鑰不落地於 repo**）；以環境變數 / seed 佔位帶入（比照 `${GEMINI_API_KEY}`）。
- **已知狀況（實測）**：目前提供的金鑰可認證（列模型 200）但生成回 **429 free-tier limit:0**（該 Google 專案無免費額度/未開計費）。→ 在鏈中會被當失敗、自動換 banana。需使用者為該專案開計費或換有額度的 key，AI Studio 這棒才會真正服務。**架構不受影響**，且此 429 正好用於測「失敗→換家」。

## 4. 前端設計

### 4.1 DTO 擴充
- `AskQueueItemDto`（小窗）：加 `CurrentProvider`（Running 時顯示目前哪家）、可選 `AttemptInChain`。
- `AskQueueDetailDto`（完整頁）已有 `Messages` → 渲染 `stage` 訊息為「嘗試歷程」時間線（哪家／第幾次／成功或錯誤）。

### 4.2 小窗 `AiProcessingMenu.tsx`
- Running 項目：在狀態徽章旁顯示「目前：Claude (1/2)」之類；資料來自 `CurrentProvider`/`AttemptInChain`。
- 沿用既有事件驅動刷新（`AI_QUEUE_CHANGED_EVENT`）＋展開時刷新；Running 進行中時可加一個輕量輪詢（僅在有 Running 時、間隔較長，避免長期打 DB——遵守既有「移除定時輪詢」精神，只在有進行中工作時短期輪詢）。

### 4.3 完整頁 `ai-queue/page.tsx`
- 明細區新增「嘗試歷程」區塊：依序列出每次 `stage`（provider／第幾次／結果／錯誤摘要）。
- 失敗時清楚呈現「6 次都失敗」與每家錯誤，讓使用者看得到是什麼錯（使用者明確要求）。

## 5. 關鍵設計決策與理由（寫給後人）

1. **以 `FallbackChainProvider` 實作 `IAiProvider`**：消費端（GeminiNoteAiService / AskOrchestrator）幾乎不改，只是「拿到的 provider 變成一條鏈」；Stage 事件沿用既有串流管線傳遞。
2. **先緩衝、確認成功才吐**：因使用者要求「吐字後才失敗也算失敗、要能換家」，故不能邊吐邊送。代價是失去逐字即時感，但保證 UI 乾淨且可乾淨換家。
3. **鏈只套用在「共用預設」路徑**：尊重既有 per-node 選模型功能（開問啦有選 → 不變）。
4. **Google AI Studio 用 OpenAI 相容端點**：直接重用 `OpenAiCompatibleStreamingProvider`，零新 HTTP code。
5. **金鑰加密存 DB、不落地**：比照既有 AiModel 金鑰處理與全域安全鐵則。

## 6. 測試計畫（TDD，先寫測試）

### 6.1 單元測試 `FallbackChainProvider`
- `第一家成功 → 只嘗試一次、輸出該家結果、不碰後面`
- `第一家失敗一次後第二次成功 → 共兩次、輸出第一家、發兩個 Stage`
- `第一家兩次都失敗 → 換第二家、第二家成功 → 輸出第二家、共 3 次`
- `三家各兩次全失敗 → 最終 Error、含 6 次摘要、發 6 個失敗 Stage`
- `空白回應視為失敗 → 觸發換家`
- `逾時/例外視為失敗 → 觸發換家`
- `中途吐字後失敗 → 不把半截內容當成功、續換家`
- `鏈中某家未設定（null）→ 自動略過該家、不報錯`
- `成功家的 Delta/Completed 完整轉發；Stage 事件序正確`

### 6.2 單元測試 `AiProviderFactory.ResolveChainAsync`
- `回傳順序＝Claude→AIStudio→banana`
- `缺 AIStudio 設定 → 鏈為 Claude→banana`
- `FakeAiProvider（測試模式）→ 仍回單一 Fake`

### 6.3 整合測試（WebApplicationFactory + Fake/可控 provider）
- `框選提問：第一家失敗→第二家成功 → AiSession.Messages 有 stage log、AiProvider＝第二家、最終 Completed`
- `全部失敗 → AiSession.Status=Failed、ErrorText 含彙整、Messages 有 6 筆 stage`
- `開問啦：有選模型 → 不走鏈（單一 provider 被呼叫一次）`
- `開問啦：沒選模型 → 走鏈`
- `佇列 API（GetQueue/GetDetail）回傳 CurrentProvider 與 stage 訊息`

### 6.4 E2E（Playwright，本機）
- 觸發框選提問（用可控失敗注入或真打）→ 小窗顯示「目前：某家 (n/2)」→ 完成顯示「已答」。
- 完整頁顯示嘗試歷程與（若有）失敗錯誤。
- 用 429 的 AI Studio 真實驗證「Claude 成功」或「AI Studio 失敗→banana 成功」的歷程顯示。

### 6.5 覆蓋率
- 後端新增類別目標 ≥ 80%；鏈的「成功/失敗/換家/全敗/略過」分支全覆蓋。

### 6.6 對抗式審查補充案例（必測）
- `取消權杖取消 → 立即停止、不再換家、轉拋 OperationCanceledException`
- `第一家 Completed("") 無非空白 Delta → 視為失敗、換家`
- `第一家串了非空白 Delta 後正常結束（Completed 為空）→ 視為成功（不換家）`
- `Stage 事件序：AttemptStart → Delta* →（成功 Completed | AttemptFailed→下一 AttemptStart）`
- `串流節點：某家中途失敗 → 廣播 reset、accumulated 歸零、下一家重新逐字`
- `AiProviderFactory.IsBaseUrlSafe('https://generativelanguage.googleapis.com/v1beta/openai/') == true`
- `背景工作以 SharedModelUserId 解析 → IgnoreQueryFilters 能取到共用 AIStudio/banana 列（不被使用者隔離過濾器擋）`
- `去敏：含 'Bearer xxx' / 'key=xxx' / 'AIza...' / 'AQ.xxx' 的錯誤訊息寫入前被遮蔽`
- `並發兩個 AI 工作 → 各自 AiSession 的 stage 訊息/AiProvider 不互相污染`
- `stale Running（>門檻）→ GetQueueAsync 標為 Failed`
- `金鑰解密失敗（ResolveApiKey 回 null/空）→ 該家算失敗、換下一家（不整體崩潰）`
- `整合：開問啦「有選模型」→ 只呼叫單一 provider 一次、不走鏈、保留逐字直送（無 reset 事件）`
- `整合：開問啦「沒選模型」→ 走鏈；失敗換家時前端收到 reset`
- `整合：框選提問/美化/精煉 → AiMessage 出現 Role='stage' 歷程、AiProvider=最終成功那家`

## 7. 風險與回滾
- **逐字即時感下降**（先緩衝才吐）：若開問啦節點在意，後續可對「有選模型的單一供應者」保留逐字、只有「走鏈」才緩衝（本設計已是如此——有選模型不走鏈）。
- **AI Studio 429**：不影響流程（自動換家）；待使用者修額度。
- **回滾**：本功能集中在新類別 + 少數呼叫點切換，回滾即把 `ResolveChainAsync` 換回 `ResolveAsync(...,null)`。
- **部署**：需重建 api + web image（使用者負責），本機驗證通過後交付。
