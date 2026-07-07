# 決策紀錄（Architecture Decision Records）

> 本檔遵循專案鐵則 #16：重大決策「當下就寫」。格式一則一段：**日期／背景／考慮過的選項／最終決定／理由與取捨**。
> 新決策往檔案「最上方」加（新在上、舊在下）。跨專案／環境層級的決策另寫入 Claude 的 memory。
> （註：本檔在 fix/note-annotations-and-toc 與 feature/others-phase1 兩分支各自新增，合併時直接串接兩邊條目即可。）

---

## 2026-07-08 ｜筆記頁畫記跟隨 toggle 收合＋繪圖工具體驗＋TOC 三修（fix/note-annotations-and-toc）

- **背景**：使用者回報（prod reamde 筆記）：①收合 `:::toggle` 時只有便利貼會跟著隱藏，手繪畫記/螢光筆/形狀/文字框全部殘留在畫面上蓋到別的內容；②「全部展開」後點右下角「📖 目錄」，整篇筆記莫名變回全部收合；③章節目錄表預設開啟不符期望；④reamde 這種「整篇純 :::toggle、無 h1-h3」的筆記目錄表完全不出現。另要求：螢光筆直線模式、幾何圖形畫完先進「調整中」（滾輪縮放、左鍵完成、維持工具模式）、按 T 取消繪圖模式、右鍵取消所有模式。
- **根因（皆實證，非臆測）**：
  - ①畫記殘留：`NoteOverlay` 的「DOM 錨點＋收合祖先判定」機制只涵蓋 sticky/slide，shapes 與 text 未參與。
  - ②點目錄全收合（**本次最重要的發現**）：React 19 的 `commitUpdate` 對 `dangerouslySetInnerHTML` 以「物件識別」比較——頁面每次 render 都寫新的 `{__html}` 字面量，導致**任何不相關的重繪都會重新注入 innerHTML**、把所有 `<details>` 重建成預設收合。以位元組級插樁證實：重注入內容與原內容完全相同（1315/1315 bytes，零差異），純屬破壞性重寫。「全部展開」按鈕之所以看似正常，是它的 effect 恰好在同一次 commit 後把 open 補回去。此根因同時解釋了歷史上「畫重點標記偶爾消失」的雜症。
  - ④目錄空白：`buildToc` 只掃 `<h1-3>`，toggle 標題是純文字 `<summary>`（Markdig `ToggleContainerExtension`），整篇無 heading → `toc=[]` → TocPanel `return null`。
- **考慮過的選項**：
  - 畫記收合判定曾考慮「幾何範圍」（點是否落在 details rect 內）——沿用既有結論否決（收合歷史造成版面位移 → 判定非決定性）；採既有 DOM 錨點機制推廣。
  - 形狀錨點 key 曾考慮持久化 shape id（改 dataJson 格式）——否決（動持久化格式、遷移成本），改用「形狀 JSON 內容」為 session 內 key：內容不變則 key 穩定；擦除/改樣式/縮放會換 key，但屆時形狀必為可見狀態（隱藏者已被隔離不可操作），會安全重新錨定。
  - ②的修法曾考慮只把「全部展開」effect 加依賴補寫——否決（治標且會清掉使用者手動開合）；根治＝`useMemo` 固定 `{__html}` 物件識別（`previewHtmlObj`），並把「全部展開/收合」effect 改為**序號閘門**（只有按鈕真的被按下才批次寫 `details.open`；初載不再把 `:::toggle-open` 壓成收合）。
- **最終決定（全在前端，無後端/DB 變更）**：
  1. 錨點機制推廣：`computeHidden` 通用化（項目級 key=item.id、形狀級 key=JSON），錨定時機擴充為「toggle 開合（立即）＋捲動/resize（200ms 節流）＋items 變動（60ms 去抖）」——畫完當下（必在視野內）即錨定；從未進過視野的舊畫記維持「無錨點＝永遠顯示」保守行為。
  2. 擦除安全：`eraseVisibleOnly` 讓局部/框選橡皮擦跳過隱藏形狀（不可看不見地誤刪）；渲染層隱藏形狀渲染 `null` 保留原始索引（整筆刪除依索引對應完整陣列，不可位移）。
  3. 螢光筆直線＝`type:'line'+opacity`（沿用既有持久化格式，零遷移）；工具列開關為選項性 props，開問啦畫布端不受影響。
  4. 「調整中」只適用幾何形狀（line/rect/ellipse/螢光直線），**自由筆不進**——手寫（多筆劃）會被「點一下完成」打斷。滾輪縮放走原生 wheel（passive:false 才能擋頁面捲動）、持久化 500ms 尾端去抖＋卸載 flush。
  5. 右鍵取消模式：document capture `contextmenu`，僅在「有模式」時 preventDefault（平時右鍵不受影響）；同時丟棄畫到一半的一筆。
  6. TOC：`buildToc` 單正則掃描 h1-3＋md-toggle summary（details 巢狀深度定層級、cap 3、注入唯一 id 至 `<summary>`）；`tocOpen` 預設 `false`；TocPanel 點章節先展開「祖先」details（目標是 summary 時不動它自己的開合——點目錄＝帶我過去，不替使用者決定展開）。
- **驗證**：零相依單元測試 28 PASS（toc 11＋幾何 17，先 RED 後 GREEN）；tsc/eslint 0 error；Playwright 本地實測（3100/5109 worktree 實例）全數通過——收合跟隨（深層/外層/toggle 外不受影響/展開恢復）、擦除隔離（框選掃過隱藏座標區→隱藏形狀無恙）、整筆刪除索引正確（收合下刪可見者、隱藏者無恙、Ctrl+Z 復原）、調整中（滾輪 40→42.4 放大、頁面零捲動、左鍵完成、工具保持）、螢光直線（斜拖仍兩點直線＋0.4 半透明）、T/右鍵取消、TOC 三項（預設不開/點目錄不再影響展開狀態/純 toggle 筆記有目錄）；亮/暗主題與 375/1280 截圖存證於 worktree `test-artifacts/`；console 0 error。
- **已知取捨**：(a) 收合時畫記採「隱藏」而非「跟著位移」——收合上方章節時，下方仍可見的畫記不會跟著內容上移（與便利貼既有語意一致；若未來要做位移跟隨，錨點基礎已就緒）；(b)「清除全部」仍會清掉隱藏中的形狀（語意＝全部，且可 Ctrl+Z）；(c) 兩個幾何內容完全相同的形狀共用錨點 key（同座標同樣式 → 同收合行為，無害）。
- **對抗式復審後的修正（2 項 MEDIUM，0 CRITICAL/HIGH）**：①「該筆記的第一筆形狀」在 drawing 項目 POST 往返空窗期，items 派生的 shapes 仍為空 → 滾輪/調色短路、第一筆短暫消失、空窗期連畫兩筆會丟第一筆（後兩者為既有縫隙）——修法＝`shapesForUi`（建立中改用樂觀同步的 shapesRef、渲染期不被空值蓋掉）＋建立完成時以最新樂觀值回填 dataJson；已以「全新筆記第一筆＋立刻滾輪→重載」E2E 驗證（即時 112.4×56.2、重載後一致）。②TOC 掃描正則的無界量詞在病態輸入（大量未閉合 `<details`）下 O(n²)（復審實測 4MB→15 秒）；現狀因後端 DisableHtml 無觸發路徑，仍防禦性改為有界量詞（{0,512}/{0,256}）。復審另確認：JSON key 幂等性、eraseVisibleOnly 的 JSON 比較、wheel effect 閉包、contextmenu 不外洩至開問啦、共用元件回歸（TextBox 的左鍵防護反而修掉畫布中鍵誤拖）、TocPanel 展開祖先會同步觸發錨點重算（Playwright 實測 `details.open=true` 會發 toggle 事件）皆安全。
