# 開問啦畫布標註工具列（Canvas Annotation Toolbar）設計

> 目的：把「筆記頁右下角那組浮層工具」（便利貼／圖片板／手繪塗鴉＋橡皮擦）整組搬到開問啦（KaiWen）的 React Flow 畫布上，放右下角；**排除** ＋高 / −高（畫布本身可無限平移，不需要手動加高）。
>
> 來源需求（使用者原話，2026-06）：「我想要筆記現在的右下角的整組工具複製到開問啦的畫布裡面，一樣放在右下角就好，除了 +/- 高度之外其他都要！」

## 1. 為什麼這是「大改動」

筆記浮層（`NoteOverlay.tsx`）與畫布有兩個本質差異：

1. **座標系**：筆記浮層用「相對內文容器的固定像素座標」，疊在 `.markdown-prose` 上、不縮放。開問啦是 React Flow（`@xyflow/react`），有平移 (pan) 與縮放 (zoom)。標註必須跟著畫布一起平移縮放，否則一拖動畫布、標註就跟原本的節點錯位。
2. **持久化**：筆記浮層存在 `NoteOverlayItem`（綁 `NoteId`）。畫布需要一張**新表**綁 `CanvasId`。

## 2. 架構決策

### 2.1 座標：擷取（screen）與渲染（flow）分離

- **擷取一律在螢幕座標**：繪圖時用一層覆蓋整個畫布視窗的「擷取面」(capture surface, `position:absolute; inset:0`) 接 pointer 事件，再用 React Flow 的 `screenToFlowPosition({x,y})` 把 `clientX/clientY` 換成**畫布座標 (flow coords)** 後才存。如此 pan/zoom 都被正確吸收，存進 DB 的點永遠是 flow 座標。
- **渲染一律在畫布座標**：用一層 `transform: translate(viewport.x, viewport.y) scale(viewport.zoom)`（`transformOrigin:0 0`，viewport 來自 `useViewport()`）的內層 div 包住 SVG 與便利貼/圖片板，子元素直接用 flow 座標定位，瀏覽器套上 transform 後就和節點對齊、同步 pan/zoom。
- **決策理由**：擷取面在螢幕空間能「整片覆蓋」，不必煩惱 SVG 在縮放下的尺寸/命中區；渲染層在 flow 空間則自動跟著畫布跑。兩者用 `screenToFlowPosition` 這唯一一個換算點銜接，邏輯最少、最不易錯。
- **未採用 `<ViewportPortal>`**：它會把內容塞進 React Flow 內部 pane，pointer-events 與 RF 自身的 pan/select 糾纏較難控制；自管 transform 層可完全掌握事件與「繪圖時鎖住畫布」。

### 2.2 繪圖時鎖住畫布

工具啟用 (`tool !== null`) 時，`CanvasAnnotationLayer` 透過 callback 通知 `CanvasInner`，把 `<ReactFlow>` 的 `panOnDrag / nodesDraggable / elementsSelectable / zoomOnScroll / panOnScroll` 全部關掉，避免一邊畫一邊平移/選取。放開工具即恢復。

### 2.3 三種橡皮擦一律用「擷取面 + 純函式命中測試」

筆記版的「整筆刪除」靠點到 SVG 形狀本身（`pointer-events:stroke`）。在縮放的 SVG 上做子元素命中較不穩，故畫布版**三種橡皮擦都走擷取面**：把 pointer 轉成 flow 座標後，用純函式判定：

- 整筆刪除 (`erase-stroke`)：`hitTestShape()` 找出描邊在點半徑內的第一個形狀 → 整筆移除。
- 局部擦除 (`erase-area`)：`eraseAt()`（擦到哪那裏消失、斷成多段）。
- 框選擦除 (`erase-box`)：`eraseInBox()`。

這些純函式與筆記版**完全相同**，只是抽到共用模組。

### 2.4 共用模組（DRY）

把筆記浮層中「與座標系無關」的部分抽出，兩邊共用，避免兩套會走樣的實作：

- `frontend/src/lib/drawing/shapes.ts`：`Shape` 型別、`DrawTool` 型別、`normalizeShapes / samePoint / dist2 / densifyPolyline / shapeToPoints / erodeFreePoints / eraseByPredicate / eraseAt / eraseInBox / hitTestShape / safeParse`。
- `frontend/src/lib/drawing/ShapeEl.tsx`：`renderShapeWith / ShapeEl`（純 SVG 形狀渲染）。
- `frontend/src/components/overlay/StickyBody.tsx`、`SlideBody.tsx`、`overlayShared.ts`（`STICKY_COLORS / navBtn`）：便利貼與圖片板內容元件，改為吃最小介面 `{ color?, text?, dataJson? }`，筆記版與畫布版共用。

`NoteOverlay.tsx` 改為 import 這些共用模組（行為不變，仍需 Playwright 回歸驗證）。

## 3. 持久化（鏡像 NoteOverlayItem，綁 CanvasId）

新實體 **`CanvasAnnotation`**（`AuditableEntity, IUserOwned`）：

| 欄位 | 型別 | 說明 |
|---|---|---|
| `UserId` | Guid | 擁有者（冗餘存放，供使用者隔離全域過濾 + 具現化攔截器自動保護）|
| `CanvasId` | Guid | 所屬畫布外鍵 |
| `Kind` | string(16) | `sticky` / `drawing` / `slide` |
| `X`,`Y`,`Width`,`Height` | double | **flow 座標**（非螢幕像素）|
| `ZIndex` | int | 疊放順序 |
| `Color` | string(32)? | 便利貼底色 |
| `Text` | string(4000)? | 便利貼文字 |
| `DataJson` | text? | drawing→筆畫陣列；slide→圖片陣列 |
| + 6 稽核欄位 | | Id / Created* / Updated* / ValidFlag / DeletedDateTime |

- 命名遵循專案規則：表名 PascalCase（`CanvasAnnotation`）、欄位 `CanvasAnnotation_{Field}`、索引 `IX_CanvasAnnotation_UserId_CanvasId_ValidFlag`。
- 因為實作 `IUserOwned` + 繼承 `AuditableEntity`，**全域查詢過濾（UserId+ValidFlag）與 fail-closed 具現化攔截器自動涵蓋**，不需逐端點手寫隔離（仍在建立時驗證 canvas 屬於本人）。

### Endpoints（`/api/canvas`，沿用 `ICurrentUser` + `CanvasJsonHelper`）

- `GET    /api/canvas/canvases/{canvasId}/annotations`
- `POST   /api/canvas/canvases/{canvasId}/annotations`
- `PATCH  /api/canvas/annotations/{annotationId}`
- `DELETE /api/canvas/annotations/{annotationId}`（軟刪除，回 204）

DTO 採 **PascalCase `{Table}_{Field}`**（`CanvasAnnotationDto.CanvasAnnotation_Id` …），與既有畫布 DTO 一致、`PropertyNamingPolicy=null` 序列化，避免歷史上的 casing 坑。

### v1 不做 SSE

標註是單一使用者、不需即時協作；前端用樂觀更新即可。先不發 SSE 事件，降低範圍與風險（日後要多端同步再加）。

## 4. 前端元件

`frontend/src/app/canvas/kaiwen-components/CanvasAnnotationLayer.tsx`：

- `useReactFlow().screenToFlowPosition` + `useViewport()`（x/y/zoom）。
- 載入 `listCanvasAnnotations(canvasId)`；新增/更新/刪除走樂觀更新 + `kaiwen-api`。
- 結構：
  - 內層 transform 渲染層（`pointer-events:none`）：SVG（顯示用）＋便利貼/圖片板（未繪圖時 `pointer-events:auto` 可拖可編）。
  - 繪圖時於最上層加「擷取面」（`pointer-events:auto`）接所有筆畫/擦除。
  - 工具列：portal 到 body、`position:fixed` 右下角（避開右下角的小地圖，往上墊高）；不含 ＋高/−高。
- 拖曳/縮放便利貼：`dxFlow = dxScreen / zoom`，存 flow 座標。

掛載點：`CanvasView` 內 `<div className="relative h-full flex-1">`（與「＋新增節點」鈕同層），在 `<ReactFlow>` 之後。

## 5. 驗證

- `tsc --noEmit`、`eslint`、後端 `dotnet build`。
- 重啟後端（套用 migration + 新端點）。
- Playwright 實測：畫布上新增便利貼/圖片板、畫筆/形狀、三種橡皮擦、pan/zoom 後標註與節點同步、重整後仍在；並回歸**筆記頁**浮層（抽共用後行為不變）。
