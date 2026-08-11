# 測試計畫：編輯模式下的 toggle 摺疊（editor folding）

> 日期：2026-08-11｜分支：feat/edit-toggle-fold-and-mobile-reading
> 對應需求：Markdown 編輯區（textarea）內的 `:::toggle` 區塊，不必切到預覽就能摺疊／展開，降低撰寫長筆記時的捲動負擔。

## 設計摘要（受測物）

- 新增純邏輯模組 `frontend/src/lib/editorFolding.ts`（無 DOM 相依，可完整單元測試）：
  - **顯示文字（display）＝完整文字（full）的視圖**：被摺疊的 toggle 區塊，其「內文＋結尾 `:::`」從顯示文字移除，只留標題行＋**徽章**（如 `` ⋯〔已摺疊 12 行 #a3f2〕``，`#id` 為 4 碼隨機 token）。
  - 隱藏內容存於 `FoldRecord { id, hiddenText }`（React state），**hiddenText 完全等於被移除的原文**（含前導換行），`expand(display, folds)` 以「徽章→hiddenText」代換還原完整文字，巢狀（摺疊中含摺疊）需迭代代換。
  - **資料安全不變式**：`onChange` 對外永遠送出「展開後的完整文字」；摺疊／展開本身不觸發 onChange（內容沒變）。
  - 編輯驗證：每次使用者編輯後，檢查每個 fold 的徽章出現次數——1 次＝正常；0 次＝整塊刪除（cascade 移除巢狀 record）；≥2 次或徽章被改壞＝**拒絕該次編輯**（還原顯示文字＋toast 提示）。
  - `mapDisplayRangeToFull(display, folds, start, end)`：把 textarea 顯示座標選取範圍映射回完整文字座標（供「局部排版」）；範圍碰到徽章＝回 null。
- `MarkdownEditor` 整合：內部一律以 display 文字操作（工具列、Tab、貼圖插入點），僅在 onChange 邊界 expand；外部 value 變更（AI 重排、預覽勾選核取方塊等非本編輯器發出的變更）＝重設摺疊狀態（全展開）。textarea 左側疊一條摺疊鈕 gutter（鏡像量測行 Y 座標）；點徽章＝展開。

## A. `editorFolding.ts` 單元測試（vitest，純函數）

### A1. findToggleBlocks（位置感知解析）
1. 單一 `:::toggle 標題`＋內文＋`:::` → 回報 headerLine、標題、close 位置正確。
2. `:::toggle-open` 也被辨識。
3. 程式碼圍欄（``` 內）的 `:::toggle`／`:::` 不被辨識為區塊。
4. 巢狀 toggle：外層 body 範圍涵蓋內層整塊；深度計數正確（內層的 `:::` 不會提早關閉外層）。
5. 未閉合 toggle（無結尾 `:::`）：body 到文末。
6. `:::protect` 不是 toggle（不出現在可摺疊清單），但其 `:::…:::` 深度計數不干擾後續 toggle 判定。
7. 已摺疊的標題行（含徽章）被辨識為 folded 區塊（不往下找 close）。

### A2. fold / unfold / foldAll / unfoldAll（round-trip 不變式）
8. fold 單一區塊：display 移除內文與 `:::`、標題行尾出現徽章（含正確行數）；`expand(display, folds) === 原完整文字`（**核心不變式**）。
9. unfold：還原後 display === 原文、folds 清空。
10. fold 未閉合區塊：round-trip 仍精確還原（含檔尾無換行的情況）。
11. foldAll：多個頂層區塊全部摺疊，round-trip 成立。
12. 巢狀：先摺內層、再摺外層 → display 只剩外層標題行；expand 迭代代換後 === 原文；unfold 外層 → 內層徽章重現於 display（仍摺疊）。
13. 摺疊外層時，其範圍內「已摺疊的內層」記錄保留且 round-trip 正確。
14. 兩個「標題與內容完全相同」的 toggle 各自摺疊：徽章 id 不同、各自 unfold 還原正確（不互換）。

### A3. 編輯驗證 validateEdit（applyUserEdit）
15. 正常編輯（徽章外打字／刪字）：接受；expand 後完整文字反映編輯。
16. 在摺疊標題行「徽章之前」改標題文字：接受；expand 後標題已改、隱藏內文不變。
17. 刪除整行（含完整徽章）：接受＝整塊刪除；該 record（含巢狀 record）被移除；expand 後完整文字不含該區塊。
18. 徽章被改壞（少一個字元／中間插字）：拒絕（回 invalid）。
19. 徽章被複製成兩份：拒絕。
20. 摺疊狀態下貼上含「未知 id 的假徽章」文字：接受（當一般文字，expand 原樣保留——不對應任何 record）。

### A4. mapDisplayRangeToFull
21. 無摺疊：映射＝恆等。
22. 選取範圍完全在第一個徽章之前：恆等。
23. 選取範圍在徽章之後：位移＝(hiddenText 展開長 − 徽章長) 的累計；對巢狀摺疊使用「完全展開長度」。
24. 選取範圍與徽章相交：回 null。

### A5. 徽章格式
25. 徽章 regex 能從行內取出 id 與行數；使用者一般文字（含 `⋯`、`〔〕` 單獨出現）不會誤匹配。

## B. `MarkdownEditor` 元件測試（vitest + jsdom）

26. 內容含 toggle 時，工具列出現「全部摺疊／全部展開」；點「全部摺疊」→ textarea 顯示值含徽章、`onChange` **未被呼叫**（摺疊不改內容）。
27. 摺疊後在區塊外打字 → onChange 收到「展開後完整文字」（含隱藏內文）。
28. 摺疊後把游標點進徽章範圍（模擬 click＋selectionStart）→ 自動展開該塊。
29. 摺疊後模擬「破壞徽章」的輸入 → 顯示值被還原、出現錯誤 toast、onChange 未被呼叫。
30. 外部 value 變更（父層直接改 value prop，非編輯器發出）→ 摺疊狀態重設（顯示值＝新完整文字）。
31. 無 toggle 內容：不顯示 gutter/摺疊鈕；行為與現狀完全一致（顯示值===value）。
32. 「局部排版」座標映射：foldApiRef 暴露 mapSelectionToFull；摺疊存在時選取跨徽章 → 回 null（NoteAiActions 顯示錯誤而非重排錯段）。

## C. Playwright E2E（本地實跑，含截圖）

33. 編輯一篇含多個 toggle（含巢狀）的筆記：點 gutter ▾ 摺疊 → 視覺確認內文消失、徽章出現；點徽章展開還原。
34. 摺疊狀態下打字後按「保存」→ 重新載入筆記，內容完整（隱藏內文沒有遺失、徽章文字沒有被存進 DB）。
35. 全部摺疊 → 保存 → 內容不變（DB 中無徽章字樣）。
36. 「並排」檢視下摺疊：預覽仍渲染完整內容。

## 風險與對策（審查重點）

- **最大風險＝內容毀損**（徽章文字被存進 DB、或隱藏內文遺失）。對策：onChange 永遠 expand；驗證失敗一律拒絕編輯；E2E #34/#35 直接驗 DB 往返。
- IME（中文輸入）：正常組字不經過驗證失敗路徑；僅「編輯破壞徽章」才拒絕。**IME 相容性列為 E2E／手動驗證項**（jsdom 無法模擬 composition）。

## v2 修訂（2026-08-11 對抗式審查後的設計裁定與補充測項）

審查結論：原計畫 4 CRITICAL / 4 HIGH，補以下裁定與測項後方可進入撰寫。

### 設計裁定
1. **墓碑復活（回應 C3/H2）**：徽章 count 0 的編輯＝整塊刪除（接受＋info toast 提示可 Ctrl+Z 復原），紀錄移入 graveyard（元件存續期保留）。後續編輯若 graveyard 徽章重現（undo 復活）且 count 1 → **紀錄自動復活**、隱藏內容完整回歸——堵死「孤兒徽章存進 DB」路徑。復活後 count ≥2 → 拒絕。
2. **H1 矛盾裁定**：徽章行**只有 id 命中 records（含 graveyard）才視為 folded**；未知 id 的假徽章＝一般文字（該行若同時是 `:::toggle` 標頭，照一般未摺疊標頭走深度計數）。
3. **內部操作一律 display 座標（回應 C2）**：工具列（wrap/linePrefix/codeBlock/insertBlock/wrapProtect）、Tab 縮排、貼圖插入點全部改在 display 文字上操作，經同一 emit 管線 expand 後對外。貼圖上傳完成的替換走內部管線（**不重置摺疊**）。
4. **展開手勢（回應 M3）**：點擊落在徽章範圍內、或游標嚴格位於徽章內按可列印鍵、或緊鄰徽章（後緣 Backspace／前緣 Delete）→ 一律**自動展開該塊**（preventDefault，不進拒絕路徑）。事件驅動：click／keydown 讀 selectionStart（不依賴 selectionchange，jsdom 可測）。
5. **相交邊界（回應 M2）**：選取端點「貼齊」徽章前後緣＝不相交（允許映射）；嚴格跨入才回 null。
6. **expand 替換禁用樣板語意（回應 C4）**：以 split/join 或函數 replacer 實作，hiddenText 含 `$&`、`` $` ``、`$'`、`$1` 不得被解義。
7. **id 唯一性（回應 H4）**：生成 id 時排除「已出現在 display＋所有 hiddenText＋graveyard」的 token，撞名重生成（RNG 可注入以便測試）。
8. **自家 round-trip 不重置摺疊（回應 H3）**：以 lastEmittedFull 識別自家變更；僅真正外部變更（AI 重排、預覽勾 checkbox）才重置。

### 補充測項
- **C1+**：（元件整合，mock reformatNote）摺疊在選取之前×1、×2（含巢狀）→ 送 AI 的文字正確＋merge 後全文正確；選取端點貼齊徽章前緣/後緣可映射；兩個呼叫端（notes 頁、edit-popout）皆接線。
- **C2+**：摺疊存在時：粗體 wrap、H1 linePrefix、Tab 縮排、insertBlock、wrapProtect 各一條「操作後 expand === 預期全文」；貼圖：插入位置正確、上傳完成替換正確且**摺疊未重置**、佔位被摺入 hiddenText 後替換仍正確。
- **C3+**：刪徽章行（接受、進 graveyard、info toast）→ 模擬 undo 貼回徽章 → 紀錄復活、expand 含原內容；復活成兩份 → 拒絕。
- **C4+**：hiddenText 含 `$&`／`` $` ``／`$'`／`$1` 的 round-trip。
- **H1+**：未知 id 徽章行後接 body＋`:::` → 該 `:::` 不會提早關掉外層；foldAll 範圍正確。
- **H3+**：打字後徽章仍在（不重置）；預覽勾 checkbox（外部）→ 重置且內容正確；上傳完成替換（內部）→ 不重置。
- **H4+**：注入 RNG 強迫撞名 → 自動重生成。
- **M4+**：徽章行被改到不再是 `:::toggle` 標頭 → 接受、expand 不掉內容（結構孤兒屬可接受）。
- **M5+**：徽章被搬進行中間 → 接受、expand 後所有字元保留（round-trip 完整性不變式）。
- **M6+**：CRLF 內容（`\r\n`）round-trip 精確還原；徽章插在行尾 `\r` 之前。
- **M7+**：未閉合 fence、```/~~~ 混用下的解析與 toggleBlocks 既有語意一致（單一真相：匯出共用 helper）。
- **M8+**：200KB＋50 摺疊的 validate＋expand 效能冒煙（寬鬆上限，防迴歸）。
- **L1+**：拒絕還原後游標回編輯前位置。
- **L5 修正**：A3 純函數層只斷言 invalid；還原＋toast 屬元件層測項。
- **已知限制**：PiP 右鍵定位摺疊區內的行 → fallback 全部展開後重試（補一條元件測試）。
