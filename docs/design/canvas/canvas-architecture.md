# 開問啦畫布 G2 互動架構文件

## 系統架構圖

```
┌─────────────────────────────────────────────────────────────────┐
│                      KaiWenCanvas 主容器                         │
│  - 畫布清單管理（new/rename/delete）                              │
│  - 主題/時區設定                                                 │
│  - 模型清單載入                                                   │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ├─────────────────────┬──────────────────────┐
             ▼                     ▼                      ▼
    ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
    │  CanvasView      │ │  RightDrawer     │ │SelectionPopover  │
    │  (React Flow)    │ │  (右側面板)       │ │ (浮現面板)       │
    │                  │ │                  │ │                  │
    │ - 節點渲染       │ │ - 編輯內容       │ │ - 提問輸入       │
    │ - 邊連線         │ │ - 連結管理       │ │ - 畫重點色選     │
    │ - 拖曳互動       │ │ - 邊管理         │ │ - 連結到目標     │
    │ - 文字選取偵測   │ │ - 節點刪除       │ │                  │
    └────────┬─────────┘ └──────────────────┘ └──────────────────┘
             │                    │                      │
             └────────────────────┼──────────────────────┘
                                  │
                        ┌─────────▼──────────┐
                        │   useCanvas Hook   │
                        │  (狀態 + 操作)     │
                        │                    │
                        │ - 節點 CRUD        │
                        │ - 邊 CRUD          │
                        │ - 行內連結 CRUD    │
                        │ - 高亮 CRUD        │
                        │ - SSE 訂閱         │
                        └─────────┬──────────┘
                                  │
                        ┌─────────▼──────────┐
                        │   kaiwen-api       │
                        │  (HTTP 客戶端)     │
                        │                    │
                        │ REST API ←──┐      │
                        │ SSE/EventSource   │
                        └─────────┬──────────┘
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │   ZonWiki 後端 API       │
                    │  /api/canvas/... 端點   │
                    │  /api/canvas/sse/...    │
                    └──────────────────────────┘
```

## 資料流向

### 1. 初始載入流程

```
KaiWenCanvas mounted
  → useCanvas(canvasId)
    → loadGraph()
      → kaiwenApi.getGraph()
        → /api/canvas/{canvasId} (GET)
          ↓
      → setNodes / setEdges / setInlineLinks / setHighlights
    → EventSource("/api/canvas/sse/{canvasId}")
      → 訂閱即時事件
```

### 2. 選取節點 → 開啟右側面板

```
使用者在畫布點擊節點
  → CanvasView.onNodeClick()
    → setSelectedId(nodeId)
    → setDrawerOpen(true)
      ↓
  → RightDrawer 渲染
    ├─ 顯示節點 ID / 時間戳
    ├─ Markdown textarea (blur 時儲存)
    └─ 行內連結、反向連結、邊清單
```

### 3. 框選文字 → 提問流程

```
使用者在節點內容區框選文字
  → QaNode.handleMouseUp()
    → captureSelection() 擷取選取資訊
    → setSelection({ text, start, end, prefix, suffix, rect })
      ↓
  → SelectionPopover 渲染
    ├─ 使用者輸入問題
    ├─ 點擊「問」按鈕
      ↓
    → onAsk(question)
      → actions.askFollowup()
        → kaiwenApi.askFollowup()
          → /api/canvas/{canvasId}/ask-followup (POST)
            {
              FromNodeId: sourceNodeId,
              Question: question,
              X: pos?.x,
              Y: pos?.y
            }
          ↓
        → 後端觸發 AI
          → SSE 推播 NodeAdded / NodeUpdated 事件
            ↓
          → useCanvas.handleSseEvent()
            → setNodes 加入新節點
              ↓
          → CanvasView 自動重新渲染
```

### 4. 即時推播機制（SSE）

```
後端發布事件
  │
  └─→ SSE 事件流 (/api/canvas/sse/{canvasId})
      │
      ├─ NodeAdded: { Seq: N, Type: "NodeAdded", Data: NodeDto }
      ├─ NodeUpdated
      ├─ EdgeAdded
      ├─ InlineLinkAdded
      ├─ HighlightAdded
      └─ AskStarted / AskCompleted
        │
        ▼
      useCanvas.handleSseEvent()
        │
        ├─ 更新本地狀態 (setNodes / setEdges / ...)
        ├─ 觸發通知 onNotification()
        └─ 更新 pending 状態
          │
          ▼
      React 重新渲染 (自動)
```

### 5. 右側面板編輯流程

```
使用者在 RightDrawer 編輯
  │
  ├─ 修改內容後 blur
  │   → onSaveContent()
  │     → actions.updateNodeContent()
  │       → kaiwenApi.updateNodeContent()
  │         → /api/nodes/{nodeId}/content (PUT)
  │
  ├─ 改連結目標
  │   → onUpdateLinkTarget()
  │     → actions.updateInlineLinkTarget()
  │       → kaiwenApi.updateInlineLinkTarget()
  │         → /api/inline-links/{linkId} (PATCH)
  │
  ├─ 刪除連結
  │   → onDeleteLink()
  │     → actions.deleteInlineLink()
  │       → kaiwenApi.deleteInlineLink()
  │         → /api/inline-links/{linkId} (DELETE)
  │
  └─ 刪除邊
      → onDeleteEdge()
        → actions.deleteEdge()
          → kaiwenApi.deleteEdge()
            → /api/edges/{edgeId} (DELETE)
```

## 核心元件詳解

### CanvasView

**角色**：主畫布容器，使用 React Flow 渲染節點和邊

**狀態**：
```typescript
const [selectedId, setSelectedId] = useState<string | null>(null)  // 當前選中節點
const [drawerOpen, setDrawerOpen] = useState(false)                // 右側面板開閉
const [selection, setSelection] = useState<Selection | null>(null) // 文字選取
const [spotlightEdgeId, setSpotlightEdgeId] = useState<string | null>(null)
```

**主要事件回調**：
- `onNodeClick` → 選中節點、開啟右側面板
- `onEdgeClick` → 聚光邊
- 內嵌的 `buildData()` 建構每個節點的互動行為

### RightDrawer

**角色**：右側編輯面板，顯示/編輯節點及其關係

**Props**：
```typescript
{
  node: NodeDto,
  nodes: Record<string, NodeDto>,
  nodeOptions: { id, label }[],
  outgoingLinks: InlineLinkDto[],  // 此節點出發的連結
  incomingLinks: InlineLinkDto[],  // 指向此節點的連結
  edges: EdgeDto[],
  onClose, onSaveContent, onDeleteNode,
  onDeleteEdge, onDeleteLink, onUpdateLinkTarget,
  onNavigate, timezone
}
```

**主要 UI**：
1. **頂部標題列** - 標題 + 關閉按鈕
2. **節點資訊區** - ID、建立時間、編輯時間
3. **內容編輯區** - Markdown textarea
4. **可點擊連結** - 錨點 → 目標節點 (可改、可導、可刪)
5. **反向連結** - 來源 → 本節點 (可導、可刪)
6. **相連邊** - outgoing + incoming (可刪)
7. **底部刪除鈕** - 刪除節點

### SelectionPopover

**角色**：浮現面板，處理框選文字後的交互

**Props**：
```typescript
{
  rect: DOMRect,              // 選取文字的邊界
  anchorText: string,         // 選取的文字內容
  nodeOptions: { id, label }[],
  onAsk: (question: string) => void,
  onHighlight: (colorName: string) => void,
  onLinkToNode: (targetNodeId: string) => void
}
```

**UI 結構**：
1. 文字摘要 (「...」)
2. 問題輸入框 + 提問按鈕
3. 畫重點色彩選擇 (5 種)
4. 連結到節點下拉單

**定位**：使用 `createPortal` + fixed 絕對定位，不受 canvas 縮放影響

### useCanvas Hook

**角色**：畫布的所有狀態和操作中心

**狀態**：
```typescript
const [nodes, setNodes] = useState<NodeDto[]>([])
const [edges, setEdges] = useState<EdgeDto[]>([])
const [inlineLinks, setInlineLinks] = useState<InlineLinkDto[]>([])
const [highlights, setHighlights] = useState<HighlightDto[]>([])
const [pending, setPending] = useState<Set<string>>(new Set())
const [error, setError] = useState<string | null>(null)

const eventSourceRef = useRef<EventSource | null>(null)
const sequenceRef = useRef(0)  // SSE 補播序列號
```

**關鍵方法**：
- `loadGraph()` - 初始載入完整圖譜
- `handleSseEvent(evt)` - 解析並應用 SSE 事件
- `actions.createNode/createEdge/...` - CRUD 操作
- `actions.createInlineLink/createHighlight` - 進階功能
- `actions.ask/askFollowup` - AI 互動

**SSE 訂閱邏輯**：
```typescript
useEffect(() => {
  if (!canvasId) return
  
  loadGraph()  // 初始全量載入
  
  const eventSource = new EventSource(
    `/api/canvas/sse/${canvasId}?afterSeq=${sequenceRef.current}`
  )
  
  eventSource.onmessage = (event) => {
    const evt = JSON.parse(event.data) as SseEvent
    handleSseEvent(evt)
  }
  
  return () => eventSource.close()
}, [canvasId])
```

## 主題系統

所有 UI 元件使用 CSS 變數（無硬編碼色值）

```css
html[data-theme='warmpaper'],
[data-kaiwen-theme='warmpaper'] {
  --kw-bg: #f5f1ed;
  --kw-surface: #fefdfb;
  --kw-text: #2b2420;
  --kw-primary: #a85e2c;
  /* ... 更多變數 ... */
}

html[data-theme='light'] { /* ... */ }
html[data-theme='dark'] { /* ... */ }
html[data-theme='night'] { /* ... */ }
```

## 錯誤處理

各層級的錯誤處理：

1. **API 層** (`kaiwenApi`)
   - `http()` 檢查 response.ok 與 json.Success
   - 拋出 Error，message = json.Error

2. **Hook 層** (`useCanvas`)
   - try-catch 包裹所有 async 操作
   - 設定 `error` state
   - 設定 `pending` state 表示操作中

3. **UI 層** (`CanvasView`)
   - 顯示頂部錯誤通知
   - 點擊可關閉

## 性能最佳化

1. **React Flow 虛擬化** - 只渲染可見節點
2. **useCallback 依賴** - buildData 避免不必要重新渲染
3. **Memoized 節點** - `export const QaNode = memo(QaNodeComponent)`
4. **State 局部化** - RightDrawer/SelectionPopover 各自管理狀態

## 可訪問性 (Accessibility)

- 按鈕有 `title` 屬性 (tooltip)
- 表單有 `data-testid` 便於測試
- 色彩選擇有文字標籤，非僅依賴顏色
- 時區感知的日期顯示

## 測試策略

建議測試項目：

1. **單元測試** (jest)
   - `captureSelection()` 邊界
   - `formatDateTime()` 時區換算
   
2. **集成測試** (React Testing Library)
   - 點擊節點開啟右側面板
   - 編輯內容自動儲存
   - 框選文字顯示浮現面板

3. **E2E 測試** (Playwright)
   - 端到端提問流程
   - SSE 即時推播
   - 多客戶端同時編輯

## 未來擴展

1. **Undo/Redo** - 使用 immer 記錄狀態變化
2. **協作編輯** - 使用 Yjs 或 CRDTs
3. **版本控制** - Git-like commit/branch
4. **匯出/匯入** - JSON / Markdown 格式
5. **外掛系統** - 節點類型擴展
