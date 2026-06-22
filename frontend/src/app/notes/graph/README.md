# 知識圖譜頁面 (Knowledge Graph Page)

## 概述

知識圖譜是 ZonWiki 筆記功能的一個子頁面，位於 `/notes/graph`。它以視覺化的方式呈現所有筆記與它們之間的連結關係。

## 功能特性

### 1. 力導向圖視覺化
- **Canvas 繪製**：使用 HTML5 Canvas API 實現高效的力導向圖演算法
- **自動佈局**：節點透過斥力與引力自動計算位置，形成自然的分佈
- **實時模擬**：使用 requestAnimationFrame 以 60fps 更新圖譜

### 2. 互動體驗
- **點擊節點**：點擊任何節點可選中並在右側邊欄顯示詳情
- **滑鼠懸停**：懸停時節點大小改變，游標變為指針
- **節點導航**：點擊「開啟筆記」按鈕可直接進入該筆記詳情頁

### 3. 邊欄詳情面板
- **節點資訊**：顯示節點標題、類型（筆記/日記）、連結統計
- **進連結**：列出指向此筆記的其他筆記
- **出連結**：列出此筆記指向的其他筆記
- **斷鏈檢測**：若連結指向未建立的筆記，標示為「未建立」

### 4. 產品級設計
- **4 種顯示模式**：支援 warmpaper、light、dark、night 主題
- **CSS 變數系統**：配色透過 CSS 變數動態切換，支援全站主題系統
- **RWD 支援**：桌面顯示左右佈局，手機版改為上下疊放
- **無障礙**：支援高對比模式、減低動畫偏好、語義 HTML

## 技術實現

### 前端架構

```
frontend/src/
├── lib/api.ts (新增)
│   ├── getKnowledgeGraph() 函式
│   ├── GraphNode 介面
│   ├── GraphEdge 介面
│   └── KnowledgeGraph 介面
├── components/
│   └── KnowledgeGraph.tsx (新增)
│       └── KnowledgeGraphVisualizer 元件
└── app/notes/
    └── graph/
        └── page.tsx (新增)
            └── KnowledgeGraphPage 元件
```

### API 整合

呼叫後端 `/api/graph` 端點（已存在）取得圖譜資料：

```typescript
interface KnowledgeGraph {
  nodes: Array<{
    id: string;      // 筆記 ID
    title: string;   // 筆記標題
    slug: string;    // 筆記 slug
    kind: string;    // "note" 或 "journal"
  }>;
  edges: Array<{
    sourceNoteId: string;       // 來源筆記 ID
    targetNoteId?: string;      // 目標筆記 ID (可空)
    anchorText: string;         // 連結文字
  }>;
}
```

### 力導向演算法

#### 參數
- `CHARGE_STRENGTH = -300`：節點斥力強度
- `LINK_DISTANCE = 100`：期望連結距離
- `LINK_STRENGTH = 0.1`：連結引力強度
- `FRICTION = 0.8`：摩擦係數
- `DAMPING = 0.02`：阻尼係數

#### 計算流程
1. **斥力**：所有節點對之間的斥力 (Coulomb-like)
2. **引力**：連結兩端的節點相互吸引
3. **中心力**：節點被弱引力吸向中心，防止漂移
4. **速度更新**：應用摩擦力並更新位置
5. **停止判定**：所有速度小於閾值時停止模擬

### Canvas 繪製

- **背景**：使用主題色 `--bg-canvas`
- **邊（Edge）**：灰色線條，透明度 50%
- **節點**：圓形，直徑根據狀態變化
  - 常規：8px 半徑
  - 懸停：11px 半徑
  - 選中：12px 半徑
- **標籤**：節點下方顯示標題（若長度 < 30 字元）

### RWD 斷點

- **桌面** (>768px)：左側 Canvas，右側邊欄（固定寬度 300px）
- **平板/手機** (≤768px)：Canvas 佔滿上方，邊欄改為下方疊放（最高 40vh）

## 使用方式

### 訪問頁面
```
http://localhost:3000/notes/graph
```

### 操作流程
1. 頁面自動載入所有筆記與連結
2. 力導向演算法自動佈局節點
3. 點擊任何節點查看詳情
4. 在邊欄中查看進連結與出連結
5. 點擊「開啟筆記」進入該筆記頁面

## 空狀態處理

- **無筆記**：顯示空狀態圖示 🕸️ 與提示文字
- **載入中**：顯示旋轉加載動畫
- **載入失敗**：顯示錯誤訊息與重試提示

## 性能最佳化

- **Canvas 而非 SVG**：Canvas 在節點數 >100 時性能更優
- **RequestAnimationFrame**：確保與瀏覽器刷新同步
- **模擬停止判定**：演算法收斂後自動停止計算
- **視口相對位置**：滑鼠互動透過視口座標計算，避免重複遍歷

## 已知限制與未來改進

### 限制
- 手機觸控目前不支援拖曳（計劃中）
- 節點數 >500 可能出現性能下降
- 長標題節點標籤可能重疊（自動隱藏超長標題）

### 未來改進
- [ ] 觸控支援：實現節點拖曳、雙指縮放
- [ ] 搜尋功能：快速定位特定筆記
- [ ] 篩選功能：依標籤、分類篩選顯示節點
- [ ] 導出功能：將圖譜導出為 PNG / SVG
- [ ] 物理引擎升級：考慮 WebGL 加速或 worker 執行緒

## 依賴與相容性

- **React**：19.x（使用 `useRef`、`useState`、`useEffect`）
- **Next.js**：16.x（App Router）
- **瀏覽器支援**：支援 Canvas API 的現代瀏覽器 (Chrome, Firefox, Safari, Edge)
- **無第三方圖譜庫**：完全自製，無 d3.js / react-force-graph 依賴

## 型別安全

所有文件已通過 `npx tsc --noEmit` 0 型別錯誤驗證：
- ✓ `api.ts`：圖譜 DTO 型別
- ✓ `KnowledgeGraph.tsx`：Canvas 繪製與模擬邏輯
- ✓ `graph/page.tsx`：頁面容器與狀態管理

## 調試提示

若圖譜顯示異常，檢查以下項目：

1. **檢查後端端點**：`GET /api/graph` 是否返回正確 JSON
2. **檢查網路請求**：瀏覽器開發者工具 → Network 標籤
3. **檢查 Canvas 尺寸**：確認容器有正確高度
4. **檢查主題顏色**：CSS 變數是否正確定義

## 相關檔案

- 後端端點：`src/ZonWiki.Api/Endpoints/NoteWriteEndpoints.cs:GetKnowledgeGraphHandler`
- DTO 定義：`src/ZonWiki.Domain/Dtos/NoteDtos.cs:KnowledgeGraphDto`
- 實體定義：`src/ZonWiki.Domain/Entities/NoteLink.cs`
