# 歸檔規範

過期的 task、decision、constraint、issue 等文件**必須歸檔，不得刪除**。
歷史是這套系統最重要的資產。

## 何時歸檔

| 觸發 | 動作 |
|---|---|
| Decision 被新版取代 | 舊 decision `Status: Superseded`，回填 `Superseded By`（見 `decision-writing.md`）。完全失效後，歸檔 |
| Decision 因其他原因（功能移除、範圍砍掉）不再相關 | `Status: Deprecated`，歸檔 |
| Task 不再需要（PRD 變更、做法放棄） | 在頂部加 Deprecation Note 註明放棄原因，歸檔 |
| Constraint 不再適用 | 在 `constraints.md` 用刪除線標記，連到取代它的 decision |
| 標 `Won't Fix` 的 issue 已 >30 天 | 歸檔 |
| 測試被刪除（迴歸覆蓋被移除） | 將測試紀錄附原因歸檔 |

## 資料夾配置

- Active 文件：留在原資料夾（例如 `/docs/decisions/`、`/docs/tasks/`）
- 歸檔文件：搬到 `/docs/_archive/<原資料夾名>/<原檔名>.md`
  - 保留原檔名
  - 在檔案頂部加上下方定義的 `Deprecation Note` 區塊（蓋在原內容之上）

## 歸檔文件頂部必填區塊

歸檔時，把下列區塊**插入到原內容之前**：

```
> # DEPRECATED — <原標題>
>
> Status: Deprecated | Superseded | Archived
> Deprecated On: YYYY-MM-DD
> Deprecated By: <人類姓名>
> Reason: <一段話 — 描述世界發生了什麼變化導致這份不再適用>
> Superseded By: [標題](../../decisions/YYYY-MM-DD-xxx.md) — 適用時填，否則略
>
> --- （以下為原內容，未動） ---
```

原內容**保持不變**，放在區塊下方。

## constraints.md 特例

`constraints.md` 是單一活檔，不是資料夾。已棄用的 constraint **留在原處**用刪除線標示：

```
- ~~舊的限制文字~~ — Deprecated YYYY-MM-DD，見 [decision](decisions/YYYY-MM-DD-xxx.md)
```

這樣保留歷史可見度，又不污染現役清單。

## 更新交叉引用

歸檔某文件時：
- 將 active 文件中指向它的入站連結改成新的 `/_archive/` 路徑
- 若 `current-state.md` 引用過該文件，也要更新
- 一份文件可能**同時**有 `Superseded By` 連結與歸檔項目 — 適用時兩者都要做

## 規則
- **不得刪除任何歷史文件** — 包含失敗實驗、放棄的 task、撤回的 decision
- 歸檔**必須保留原檔名**（讓既有引用調整路徑後仍可解析）
- 歸檔時**必須**更新入站連結
- 歸檔的文件若被 `current-state.md` 引用，必須一併更新
- 歸檔本身**不**觸發 issue 紀錄；只有當歸檔過程揭露出值得預防的 bug 或模式時才開 issue
- 歸檔文件 = 唯讀歷史 — 歸檔後**不可編輯**，唯一例外是修補連結
