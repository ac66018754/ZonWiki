# 測試計畫：Enter 硬換行（全域）＋ 表格 `<br>` 編輯視圖層 ＋ 直編換行對稱

> 分支：`feat/enter-hard-break-and-table-br-view`（2026-08-13）
> 使用者裁示（本次對話）：
> 1. 全域「單一換行＝硬換行」（Notion 式），既有筆記 reflow 視為修正、不需影響面掃描。
> 2. 表格儲存格換行**維持 `<br>` 單行儲存**（跨平台互通），編輯頁以「顯示層」把表格列內
>    `<br>` 展開成換行＋對齊，Shift+Enter 在儲存格內插入 `<br>`（使用者看不到字面標籤）。
> 3. 讀模式直編補對稱：開啟儲存格編輯器時 `<br>` 還原成真實換行。

---

## A. 功能設計摘要（測試對象）

### A1. 後端：軟換行→硬換行
- `NoteContentHelpers.CreateMarkdownPipeline()` 加 `.UseSoftlineBreakAsHardlineBreak()`（Markdig 0.42.0 內建）。
- **`CurrentRenderVersion` 2 → 3**：ContentHtml 有 DB 快取，不 bump 舊筆記永遠是舊渲染
  （lazy 重渲染＋`NoteRenderMigrationService` 既有機制負責收斂）。

### A2. 前端：remark-breaks
- `pnpm add remark-breaks`（v4，remark 15/react-markdown 9 相容）。
- 三個 ReactMarkdown 渲染點全部加入（與後端行為對齊）：
  - `MarkdownPreview.tsx:198`：`[remarkGfm, remarkBreaks, remarkHtmlLineBreak, remarkMarkFenced]`
  - `overlay/StickyBody.tsx:197`：`[remarkGfm, remarkBreaks]`
  - `canvas/kaiwen-components/NodeContent.tsx:120`：`[remarkGfm, remarkBreaks]`

### A3. 讀模式直編對稱（tableSpec + readingTableInteractive）
- 新函式 `unescapeCellBr(value): string`（tableSpec.ts）：把儲存格值內的 `<br>` 家族
  （`<br>`/`<br/>`/`<br />`，大小寫不敏感、容許內部空白——與後端白名單同款）轉成 `\n`。
- `openCellEditor`：`editor.value = unescapeCellBr(raw)`；「無變更」比較改成
  `editor.value === unescapeCellBr(raw)`（存檔仍走既有 `escapeCellText` 把 `\n`→`<br>`）。
- 已知顯示不精確（可接受、要文件化）：儲存格 inline code 內的字面 `<br>` 也會被還原顯示成換行，
  但存檔 round-trip 後原文不變（`\n` 會被 escape 回 `<br>`）。

### A4. 編輯頁「表格 `<br>` 視圖層」（新 lib：`tableBreakView.ts`）
架構沿用摺疊層先例：textarea 顯示 display 文字，`applyEdit` 收斂回完整文字對外。

- **展開 `expandTableRowBreaks(full)`**：逐行掃描（fence 狀態機沿用 `toggleBlocks.FENCE_PATTERN`
  語意，與 editorFolding 一致）。行滿足「不在圍欄內 && `splitTableRowLine(line).valid` &&
  含正規形 `<br>`」→ 每個 `<br>` 換成 `"\n" + 空白墊片 + "↳ "`。
  - **只認正規形 `<br>`**（小寫、無空白）：變體（`<br/>` 等）展開後 collapse 會正規化成 `<br>`
    造成「沒編輯卻整篇被改」的幽靈 diff；正規形是系統自己寫入的形（escapeCellText）。
    變體維持字面顯示（與現行行為相同）。
  - 墊片寬度＝該 `<br>` 所在儲存格的內容起始欄（視覺寬 heuristic：char code > 0xFF 算 2 欄），
    `↳ ` 佔 2 欄 → 前導空白 = max(0, 起始欄 − 2)。對齊是「盡力」性質（非等寬字型下會偏）。
  - 行尾帶 `\r`（CRLF 檔）的表格列**不展開**（保守跳過，避免 `\r` 卡進列中）。
- **收斂 `collapseTableRowBreaks(display)`**：行匹配 `^( *)↳ ?(.*)$` 且「前一（已累積）行」
  `splitTableRowLine(...).valid` 且不在圍欄內 → 併回前行，接合符為 `<br>`。
  寬鬆文法（`↳` 後空白可缺）讓「使用者刪到一半的標記」也能收斂、不外漏 `↳` 進完整文字。
  孤兒 `↳` 行（前一行非表格列）維持字面。
- **安全網 `safeExpandTableRowBreaks(full)`**：展開後驗證 `collapse(expand(full)) === full`，
  不相等（病態內容，例如原文本來就有「表格列下一行行首是 `↳`」）→ 回傳原文（該筆記停用視圖層）。
- **雙向座標映射 `mapExpandedOffsetToCollapsed` / 區間版**：供「局部排版」的
  `mapSelectionToFull` 組合。**順序（v2 修訂，復審 C-1）**：分層是
  full →（表格展開）→ expandedFull →（摺疊收合）→ display，故 display→full 必須
  **先過徽章映射**（display → expandedFull，沿用 `mapDisplayRangeToFull`）**再過 join 收斂映射**
  （expandedFull → full）。端點落在 join 區內→貼齊 join 起點。

### A5. MarkdownEditor 整合
- 初始化／外部變更（`value !== lastSyncedFull` 分支）：`display = safeExpandTableRowBreaks(value)`。
- `applyEdit`：`full = collapseTableRowBreaks(expandDisplay(newDisplay, state))`
  （順序不可反：hiddenText 內可能藏著已展開的表格列，必須先展徽章再收斂表格）。
- **Shift+Enter**（keydown，`isComposing` 防護）：游標所在 display 行是「表格列或其續行」且
  不在圍欄內 → `preventDefault`，插入 `"\n" + 墊片 + "↳ "`（續行沿用該行既有墊片；表格列則
  按游標所在儲存格計算），游標移到插入後。其餘情境放行預設（全域 Enter=硬換行已覆蓋）。
- **Backspace/Delete 於 join 邊界**：游標位於「續行的內容起點（或標記/墊片區內）」按 Backspace、
  或位於前一行行尾按 Delete 且下一行是續行 → 一次刪除整個 join（`\n+墊片+↳+空白`）＝移除該 `<br>`。
- **onCopy/onCut**：把複製文字內 `/\n *↳ ?/g` 轉回 `<br>`（貼到外部平台是合法 GFM 單行）；
  cut 同時透過 applyEdit 移除選取。
- 已知邊界（文件化、不阻擋 v1）：
  - 使用者手動貼上/輸入「行首 `↳`」且上一行恰為表格列 → 會被收斂成 `<br>`（safeExpand 只保護初始化）。
  - 刪除表格列本體、遺留續行 → 續行會 join 到上一行（可能是分隔列），渲染變醜但無資料遺失，Ctrl+Z 可救。
  - 編輯中貼入字面 `<br>` → 維持字面顯示，直到下次載入才展開（fold 層同款行為：display 不在編輯中重推導）。

### A6. 讀模式：儲存格內多 checkbox（2026-08-13 使用者追加：「一格多 checkbox，像 OneNote」）
- 範圍：**讀模式**表格儲存格（互動集中讀模式＝既有決策，MarkdownPreview.tsx:118 註解）。
- 判定：儲存格 raw 值以 `<br>` 切成邏輯行，行首匹配 `[ ] `／`[x] `（含大寫 X）→ 該行渲染成
  可點擊 checkbox＋文字（DOM 端替換，非 raw HTML，零注入面）。
- 寫回：點第 k 個 checkbox → 在 raw 值中切換第 k 個核取標記 → 走既有 `saveCell`
  （escapeCellText 重跳脫；樂觀 UI 與失敗還原沿用直編既有行為）。
- 控件欄分流（v3 修訂，2026-08-13 使用者實測回報「{checkbox} 欄放多段格只剩一顆空框」）：
  `{checkbox}` 控件欄的「純 `[ ]`/`[x]`/空」格維持整格單一勾選；**多段/帶標籤格改走多
  checkbox 增強**（否則整格單勾 replaceChildren 會吃掉標籤文字）。radio 等其他控件欄一律排除；
  無 `data-md-line` 的列（不可寫回）不啟用。新增測試 B7-5b/B7-5c。
- 編輯預覽維持字面文字（v1；互動集中讀模式）。

---

## B. 測試矩陣

### B1. 後端 xUnit（NoteContentHelpersTests 增補）
| # | 情境 | 預期 |
|---|---|---|
| B1-1 | `"第一行\n第二行"` | 單一 `<p>` 內含 `<br />` |
| B1-2 | `"段一\n\n段二"` | 兩個 `<p>`（空行仍分段） |
| B1-3 | 圍欄程式碼內多行 | `<pre>` 內容不含 `<br />`（程式碼不受影響） |
| B1-4 | `:::toggle` 內文單換行 | `<details>` 內 `<br />` |
| B1-5 | 表格（含 `<br>` 儲存格）在新管線下 | 表格結構不變、儲存格 `<br />` 照舊（回歸鎖） |
| B1-6 | 清單項的 lazy continuation（`- a\n  b`） | 項內 `<br />`（行為變更點，鎖新行為） |
| B1-7 | `CurrentRenderVersion == 3` | 常數 bump 鎖定（防止改管線忘 bump 的回歸） |
| B1-8 | 行尾兩空白／行尾 `\` | 仍是 `<br />`（既有機制不退化） |

### B2. 前端 vitest：`tableBreakView.test.ts`（純函式）
**expand**
| # | 輸入 | 預期 |
|---|---|---|
| B2-1 | `\| a<br>b \| c \|` | `\| a`＋換行＋`↳ b \| c \|`（墊片對齊 a 的起始欄） |
| B2-2 | 一格內兩個 `<br>` | 兩條續行、墊片相同 |
| B2-3 | 兩格各有 `<br>` | 各自對齊自己儲存格的起始欄 |
| B2-4 | CJK 前綴（`\| 日期 \| x<br>y \|`） | 墊片以 CJK=2 欄計算 |
| B2-5 | 圍欄內的 `\| a<br>b \|` | 不展開 |
| B2-6 | `<br/>`、`<br />`、`<BR>` 變體 | 不展開（維持字面） |
| B2-7 | 無未跳脫管線的行（`a<br>b`） | 不展開 |
| B2-8 | 縮排 ≥ 4 的表格樣行 | 不展開（splitTableRowLine invalid） |
| B2-9 | 行尾 `\r`（CRLF） | 不展開 |
| B2-10 | `\|` 跳脫（`\| a\\\|b<br>c \|`） | 儲存格切分照 tableSpec 規則、展開正確 |

**collapse／round-trip**
| # | 情境 | 預期 |
|---|---|---|
| B2-11 | `collapse(expand(x)) === x` | 對上述所有輸入＋混合長文成立 |
| B2-12 | 孤兒 `↳` 行（前一行是普通段落） | 維持字面不 join |
| B2-13 | `↳` 後無空白（刪到一半） | 仍 join、不漏 `↳` 進完整文字 |
| B2-14 | 連鎖續行（3 行） | join 成 `a<br>b<br>c` |
| B2-15 | 圍欄內的 `↳` 行 | 不 join |
| B2-16 | 原文本來就有「表格列＋次行行首 `↳`」 | `safeExpand` 驗證失敗 → 回傳原文（視圖層停用） |

**映射**
| # | 情境 | 預期 |
|---|---|---|
| B2-17 | join 之前／之後的 offset | 位移正確（display↔collapsed 對稱） |
| B2-18 | 端點落在墊片/標記內 | 貼齊 join 起點（不回 null） |

### B3. 前端 vitest：`MarkdownEditor.tablebr.test.tsx`（元件）
| # | 情境 | 預期 |
|---|---|---|
| B3-1 | value 含 `<br>` 表格 → 掛載 | textarea 顯示展開形；**不觸發 onChange**（純視圖） |
| B3-2 | 在續行打字 | onChange 收到「單行 `<br>` 形」完整文字 |
| B3-3 | 表格列內 Shift+Enter | display 多一條 `↳` 續行；onChange 完整文字該格多 `<br>`；游標在續行內容起點 |
| B3-4 | 段落內 Shift+Enter | 不 preventDefault（走預設換行） |
| B3-5 | 續行內容起點 Backspace | 整個 join 消失；onChange 完整文字少一個 `<br>` |
| B3-6 | 前行行尾 Delete（次行為續行） | 同 B3-5 |
| B3-7 | 選取跨 join 複製 | 剪貼簿為 `<br>` 單行形 |
| B3-8 | 外部 value 變更（AI 重排） | display 重新展開；摺疊重設（既有行為） |
| B3-9 | 摺疊含表格的 toggle → 展開 | display 仍是展開形；round-trip 完整文字不變 |
| B3-10 | 局部排版 mapSelectionToFull 跨 join | 回傳的完整文字座標切出正確片段 |
| B3-11 | IME 組字中按 Enter（isComposing） | 不攔截 |
| B3-12 | 病態內容（B2-16 同款） | 視圖層停用、textarea 顯示原文、編輯照常 |

### B4. 前端 vitest：直編對稱（tableSpec / readingTableInteractive 增補）
| # | 情境 | 預期 |
|---|---|---|
| B4-1 | `unescapeCellBr("a<br>b")` | `"a\nb"`；家族變體（`<br/>`、`<BR />`）皆轉 |
| B4-2 | `unescapeCellBr` 不轉 `<brs>`、`<br x>` | 維持字面（白名單同後端） |
| B4-3 | 開啟直編（格值 `a<br>b`） | textarea 初值 `a\nb`、rows=2 |
| B4-4 | 開啟後未改直接 blur | 不呼叫 saveCell（無變更比較用還原後值） |
| B4-5 | 格值 `a<br/>b` 開啟未改 blur | 不呼叫 saveCell（變體不因開關而被正規化） |
| B4-6 | 改字後存檔 | saveCell 收到含 `\n` 值 → 既有 escape 轉 `<br>`（round-trip 既有測試繼續鎖） |

### B5. 前端 vitest：remark-breaks 接線
| # | 情境 | 預期 |
|---|---|---|
| B5-1 | MarkdownPreview 渲染 `"a\nb"` | 輸出含 `<br>`（單換行＝硬換行） |
| B5-2 | 渲染 `"a\n\nb"` | 兩個 `<p>` |
| B5-3 | 圍欄程式碼內換行 | 不產生 `<br>` |

### B7. 前端 vitest：儲存格內多 checkbox（A6）
| # | 情境 | 預期 |
|---|---|---|
| B7-1 | `toggleCellCheckbox("[ ] 甲<br>[x] 乙", 1)` | `"[ ] 甲<br>[ ] 乙"`（只動第 k 個） |
| B7-2 | 行首非核取標記（`昨天 [ ] 甲`） | 不視為 checkbox 行（不渲染、不誤切） |
| B7-3 | 讀模式 cell 渲染（raw=`[ ] 甲<br>[x] 乙`） | 兩個 checkbox；第二個 checked |
| B7-4 | 點擊第 1 個 checkbox | saveCell 收到第 1 個標記切換後的新 raw |
| B7-5 | `{checkbox}` 控件欄的格 | 不套多 checkbox 渲染（維持整格單一勾選） |
| B7-6 | 無 data-md-line 的列 | 不渲染互動 checkbox（維持字面） |

### B6. E2E（Playwright，本地實測＋截圖，鐵則 #25）
腳本與截圖收整於 `tmp/playwright-verify/`（既有慣例資料夾）。
| # | 流程 | 驗證 |
|---|---|---|
| B6-1 | 編輯頁打「兩行字（單換行）」→ 存檔 → 閱讀頁 | 閱讀頁兩行分開；編輯預覽同樣分開 |
| B6-2 | 開含 `<br>` 表格的筆記 → 編輯頁 | textarea 是展開形（截圖＝使用者的圖一） |
| B6-3 | 表格列內 Shift+Enter 打字 → 存檔 → 閱讀頁 | 表格儲存格正確換行（截圖＝圖二）；DB 原文單行 `<br>`（GET API 驗證） |
| B6-4 | 閱讀頁雙右鍵直編含 `<br>` 儲存格 | textarea 顯示真實換行；未改 blur 無 PUT |
| B6-5 | 亮／暗主題＋手機寬 375px | 續行標記 `↳` 對比可讀、無爆版（uiux 硬規則） |

---

## C. v2 修訂（2026-08-13 對抗式復審結論：需修訂後可執行；以下全數採納）

對應復審編號 → 設計/矩陣修訂：

- **C-1（映射順序反了）**：已改 A4（先徽章映射、再 join 收斂映射）。矩陣新增 **B3-13**：
  「摺疊一個含 `<br>` 表格的 toggle（位於選取點之前）＋選取跨 join → mapSelectionToFull 切出正確片段」。
- **C-2（停用旗標語意）**：safeExpand 失敗＝**整個視圖層 per-instance 停用**（旗標進視圖快照）：
  applyEdit 不做 collapse、Shift+Enter 不攔、複製不轉換。**B3-12 加強斷言**：停用後打字，
  onChange 完整文字仍含原 `↳` 行、除輸入處外位元組不變。
- **H-1（複製正則誤傷）**：複製/剪下**不用正則猜**——選取範圍先經正確映射（徽章→join）切
  「收斂後完整文字」；映射回 null（跨徽章等）→ 放行預設複製。新增 **B3-14**（純表格選取→
  `<br>` 形）、**B3-15**（選取含使用者字面 `↳` 行→不誤傷，走映射結果）。
- **H-2（墊片區打字外漏）**：新增「join 原子區手勢」（比照 handleFoldGestureKeys）：
  游標落在「\n墊片↳␣」區內的可列印鍵/Enter → 先貼齊內容起點再落字；Backspace/Delete → 整個
  join 一次刪。工具列 linePrefix／Tab 縮排對續行的「行首」＝**內容起點**（標記之後），
  不會在 `↳` 前插字。拖放（drop）文字含 join 樣式 → preventDefault＋toast 提示改用複製貼上。
  矩陣新增 **B3-16**（續行行首打字→字落在內容起點、無 `↳` 外漏）、**B3-17**（linePrefix 作用於
  續行→前綴落在內容起點）、**B3-18**（drop 含 join 樣式→被擋）。
- **H-3（undo 未覆蓋）**：Shift+Enter／join 刪除改用 `document.execCommand('insertText'/'delete')`
  優先（保留原生 undo 堆疊；jsdom 不支援時退回 applyEdit 手動路徑）。矩陣新增 **B3-19**
  （jsdom 退路正確性）；**B6-6**（真瀏覽器：Shift+Enter 後 Ctrl+Z 復原、join 刪除後 Ctrl+Z 復原）。
- **H-4（分隔列）＋M-1（散文含管線誤傷）**：展開與 Shift+Enter 都收緊為「**真表格脈絡**」＝
  該行所屬的連續表格列區塊（續行不計）第 2 行是分隔列（cells 全符合 `/^:?-+:?$/`），且分隔列
  本身排除。collapse 對稱套用同一判準（round-trip 對稱）。矩陣新增 **B2-19**（分隔列不展開/不 join）、
  **B2-20**（無分隔列的偽表格行不展開）、**B3-20**（分隔列上 Shift+Enter 放行預設）、
  **B3-21**（散文 `甲 | 乙` 行 Shift+Enter 放行預設）。
- **M-2**：儲存格 inline code 內正規形 `<br>` 也會展開顯示（讀模式顯示字面）＝已知顯示差異，
  round-trip 不受損。新增 **B2-21** 鎖 round-trip。
- **M-3（白名單第 3 份拷貝）**：`BR_PATTERN` 從 remarkHtmlLineBreak.ts 匯出，`unescapeCellBr`
  直接共用；新增 **B4-7** 白名單同步鎖定測試（同組變體丟 unescapeCellBr 與 remark 外掛比對）。
- **M-4（CRLF 續行）**：collapse 對 `\r` 結尾的續行對稱拒收（維持字面）。新增 **B2-22**。
- **M-5**：新增 **B5-4/B5-5**：StickyBody 與 NodeContent 渲染 `"a\nb"` → 含 `<br>`（接線回歸鎖）。
- **M-6／部署注意（寫進 DECISIONS 與 PR 說明）**：RenderVersion bump ⇒ ①啟動一次性全量重渲染
  （ExecuteUpdate 推進 xmin：部署瞬間跨版開著的編輯 session 會各吃一次 409，屬既知行為）；
  ②全站 reflow 可能使 NoteOverlay 手繪筆跡與舊版面錯位（文字錨點畫記不受影響）；
  ③收斂完成前 GET 過時筆記走記憶體重渲染（短暫 CPU 稅）。
- **L-1**：新增 **B2-23** 混合形儲存格（`a<br>b<br/>c`）round-trip。
- **L-2**：直編變體正規化（編輯過的格 `<br/>`→`<br>`）＝可接受，已文件化於 A3。
- **L-4**：已知功能落差——行動裝置無 Shift+Enter，儲存格插換行僅桌機可用（記錄於已知邊界）。
- **L-5**：新增 **B5-6** 混合輸入 `a\nb<br>c` → 兩個換行。
- **矩陣補**：**B3-22** 續行上再 Shift+Enter（沿用該行墊片）；**B3-23** 貼上含字面 `<br>` 的表格
  文字→維持字面、無標記外漏（文件化行為的回歸鎖）。

## C0. 風險清單（初版；復審已逐條回應如上）
1. `splitTableRowLine.valid` 偏寬鬆（任何含未跳脫 `\|` 的行都算）→ 非表格行也被展開的誤傷面。
2. collapse 的「前一行 valid」判斷在使用者編輯中間態的穩定性（打字打到一半的行）。
3. fold hiddenText 與表格展開的交互（摺疊時 hiddenText 存的是展開形 → expandDisplay 後必須 collapse）。
4. 映射組合順序（join 映射 vs 徽章映射）錯位的可能。
5. `CurrentRenderVersion` bump 的遷移成本（啟動一次性重渲染全部筆記）。
6. remark-breaks 與 remarkHtmlLineBreak/remarkMarkFenced 的插件交互。
7. 直編 no-change 比較改動後，`<br/>` 變體格「開了就存」造成幽靈 Revision 的可能。
8. onCopy 正則誤傷（使用者內容恰含「換行＋空白＋`↳`」）。
