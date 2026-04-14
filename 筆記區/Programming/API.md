# API:程式間的溝通語言總覽

作為一名後端工程師,「API」這兩個字你每天都會聽到,但多數人一說 API 就直覺想到 REST。實際上 API 的世界遠比這個大 — REST 只是眾多「API 風格」中的其中一派。本文帶你建立一套完整的心智模型,搞懂 API 的真正定義、各種風格的差異、以及怎麼選擇適合的那一款。

---

## 一、API 是什麼?先從定義說起

**API**(Application Programming Interface,應用程式介面)的本質是:

> **讓一個程式能呼叫另一個程式的機制與約定。**

這個定義刻意寫得很廣,因為 API 真的就是這麼廣的概念。以下這些全都是 API:

| 例子 | 呼叫者 | 被呼叫者 |
|---|---|---|
| JavaScript 呼叫 `Array.prototype.map()` | 你的前端程式 | JavaScript 標準函式庫 |
| 前端用 `fetch('/api/users')` 取資料 | 瀏覽器 | 你的後端伺服器 |
| Python 程式讀 `os.environ['PATH']` | Python 程式 | 作業系統 |
| 你的 App 串接 LINE Login | 你的 App | LINE 的伺服器 |
| 一個微服務呼叫另一個微服務 | Service A | Service B |

所以 API 不一定跨網路、不一定有 JSON、不一定是 HTTP。這些只是「某些 API 風格」的特徵,不是 API 的本質。

### API 與相關概念的差異

| 詞 | 定義 | 舉例 |
|---|---|---|
| **Interface(介面)** | 最廣的概念,任何互動邊界 | USB 介面、鍵盤介面 |
| **API** | 程式能呼叫的介面 | REST API、Python API |
| **Protocol(協定)** | 通訊規則,規定訊息怎麼組 | HTTP、JSON-RPC、TCP |
| **SDK** | 包好 API 呼叫的工具包 | AWS SDK、Stripe SDK |
| **Library(函式庫)** | 可直接呼叫的程式碼集合 | Lodash、NumPy |

**簡單記法**:Protocol 定義「怎麼講話」,API 定義「能講什麼」,SDK 是「幫你把話組好的工具」,Library 是「一堆現成的話」。

---

## 二、API 的五大風格

這是你最需要建立的心智地圖。現代軟體主要有五種 API 風格:

```
API 風格大家族
├── REST          (資源導向,最主流)
├── RPC           (動作導向)
│    ├── JSON-RPC
│    ├── XML-RPC
│    └── gRPC
├── GraphQL       (查詢導向)
├── SOAP          (XML 信封,老牌企業)
├── WebSocket     (雙向即時)
└── Webhook       (反向通知,被動接收)
```

### 1. REST(Representational State Transfer)

**核心理念**:把所有東西當成「資源」,用 HTTP 動詞操作。

```http
GET    /users          → 取得使用者列表
GET    /users/123      → 取得編號 123 的使用者
POST   /users          → 建立新使用者
PUT    /users/123      → 更新編號 123 的使用者
DELETE /users/123      → 刪除編號 123 的使用者
```

**特徵**:
- **資源導向** — URL 代表名詞(使用者、訂單),動詞靠 HTTP method 表達
- **無狀態** — 每個請求獨立,Server 不記憶 Client 狀態
- **使用 HTTP 狀態碼** — `200` 成功、`404` 找不到、`500` 伺服器錯誤
- **通常回傳 JSON**(早期是 XML)

**代表**:GitHub API、Twitter API v1、Stripe API

**適合**:CRUD 操作為主、資源邊界清楚、需要 HTTP 快取的系統

### 2. RPC(Remote Procedure Call)

**核心理念**:讓呼叫遠端函式感覺像呼叫本地函式。

```python
# 本地函式
result = create_user(name="Alice", age=25)

# RPC 風格(感覺上一樣)
result = client.call("create_user", {"name": "Alice", "age": 25})
```

RPC 是個大家族,底下有好幾個具體規格:

#### JSON-RPC

用 JSON 當訊息格式,規範極簡(整份 spec 只有幾頁)。訊息長這樣:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "create_user",
  "params": { "name": "Alice", "age": 25 }
}
```

**代表**:Ethereum 節點 API、Model Context Protocol(MCP)、Language Server Protocol(LSP)

**特色**:傳輸層無關 — 可以跑在 HTTP、WebSocket、stdio 上,很有彈性。

#### XML-RPC

JSON-RPC 的前身,訊息用 XML 格式。現在基本已經沒人用了,除非維護老系統。

#### gRPC

Google 開源的 RPC 框架,用 **Protocol Buffers**(Protobuf)做序列化,跑在 HTTP/2 上。

**特色**:
- **強型別** — 用 `.proto` 檔定義介面,自動產生各語言的 Client/Server 程式碼
- **高效能** — 二進位傳輸,比 JSON 小且快
- **雙向串流** — 原生支援 Server push、Client push、雙向串流

**代表**:Kubernetes 內部通訊、Google 內部微服務、Envoy Proxy

**適合**:微服務之間的高效能內部通訊、有嚴格型別需求的系統

### 3. GraphQL

**核心理念**:讓 Client 自己決定要什麼欄位,一次請求拿齊所有資料。

```graphql
query {
  user(id: 123) {
    name
    email
    orders(last: 5) {
      id
      total
      items {
        product { name }
      }
    }
  }
}
```

**解決的痛點**:
- **Over-fetching**(拿太多) — REST 每個端點都回固定欄位,App 根本用不到
- **Under-fetching**(拿太少) — REST 要呼叫多個端點才能組出一個畫面,導致 N+1 問題

**代表**:GitHub GraphQL API、Shopify Storefront API、Facebook(原創者)

**適合**:前端需求多變、畫面複雜、需要聚合多個資源的應用

**要注意的坑**:伺服器端要小心「N+1 查詢」與「惡意深度查詢」攻擊,需額外做深度限制與 DataLoader 批次化。

### 4. SOAP(Simple Object Access Protocol)

**核心理念**:用 XML 信封包訊息,搭配嚴謹的 WSDL 合約。

**特色**:
- 超級囉嗦的 XML 訊息格式
- 內建 WS-Security、WS-Transaction 等企業級規格
- 強型別、嚴合約

**代表**:老牌銀行系統、政府機關、保險公司內部系統

**適合**:...老實說現在開新系統基本不該選它。但如果你要整合老銀行的交換系統,你可能躲不掉。

### 5. WebSocket

**核心理念**:建立一條**長連線**,Client 與 Server 可雙向即時傳訊息。

```javascript
const ws = new WebSocket('wss://example.com/chat');
ws.onmessage = (event) => console.log('收到訊息:', event.data);
ws.send('哈囉');
```

**特色**:
- **全雙工** — 不像 HTTP 是 request/response,WebSocket 兩邊都能主動發訊息
- **低延遲** — 一次握手後連線保持開啟,省掉反覆建連線的成本
- **不是 stateless** — 有連線狀態要維護

**代表**:即時聊天室、線上遊戲、股價看板、協作工具(如 Figma 多人編輯)

**適合**:需要即時雙向溝通的場景

### 6. Webhook(反向 API)

**核心理念**:**反過來**,讓 Server 主動打電話給你。

```
傳統 API:你的程式 ──呼叫──→ 第三方 Server
Webhook: 第三方 Server ──呼叫──→ 你的程式(你要提供一個 URL)
```

**流程**:
1. 你在第三方平台(GitHub、Stripe、LINE)註冊一個 URL
2. 當該平台發生事件(有人 push code、有人付款、有人傳訊息)
3. 平台主動發 HTTP POST 到你的 URL,通知你

**代表**:GitHub Webhook、Stripe 付款通知、LINE Messaging API、Slack Events API

**適合**:你不想 polling、事件頻率不高、能容忍秒級延遲

**重點提醒**:Webhook 端點必須做**簽章驗證**(通常用 HMAC),否則會被偽造攻擊。

---

## 三、一張表看懂差異

| 風格 | 底層協定 | 資料格式 | 狀態 | 雙向 | 典型用途 |
|---|---|---|---|---|---|
| **REST** | HTTP | JSON | 無狀態 | 否 | 對外公開 API、CRUD |
| **JSON-RPC** | 任意(HTTP/stdio/WS) | JSON | 有狀態 | 可(看傳輸層) | 工具協定、區塊鏈節點 |
| **gRPC** | HTTP/2 | Protobuf(二進位) | 有狀態 | 是 | 微服務內部通訊 |
| **GraphQL** | HTTP(通常) | JSON | 無狀態 | 否(有訂閱時是) | 前端驅動的複雜資料查詢 |
| **SOAP** | HTTP | XML | 有狀態(可) | 否 | 老企業整合 |
| **WebSocket** | WebSocket | 任意 | 有狀態 | 是 | 即時通訊、遊戲 |
| **Webhook** | HTTP | JSON(通常) | 無狀態 | 反向 | 事件通知 |

---

## 四、怎麼選?

### 對外公開 API → 多數情況選 REST

- 生態最成熟,工具鏈最完整
- 任何語言、任何 Client 都能無痛呼叫
- HTTP 快取、CDN 都幫你省錢
- 但如果前端需求特別複雜,考慮 GraphQL

### 微服務內部通訊 → 考慮 gRPC

- 效能比 REST 好(Protobuf 比 JSON 省 3-10 倍頻寬)
- 強型別合約,重構有保障
- 但 debug 比 REST 麻煩(二進位訊息看不懂)

### 需要跑在非 HTTP 傳輸上 → JSON-RPC

- 例如 stdio(父子程序)、WebSocket、IPC
- MCP、LSP 都選這個不是沒原因

### 前端畫面複雜 → GraphQL

- 避免 over/under fetching
- 但後端複雜度會上升

### 即時雙向 → WebSocket

- 或新選項:**Server-Sent Events(SSE)** — 只需 Server → Client 單向的話,比 WebSocket 更簡單

### 被動接收事件 → Webhook

- 對方願意推給你的話,永遠優於你主動 polling

---

## 五、API 設計的共通原則

不管用哪種風格,好 API 都有這些共通點。

### 1. 版本化(Versioning)

API 一旦發布就很難無痛改,要一開始就規劃版本。常見做法:

- **URL 路徑版本**:`/api/v1/users` → `/api/v2/users`(最直觀)
- **Header 版本**:`Accept: application/vnd.myapi.v2+json`(最乾淨)
- **Query 參數版本**:`/api/users?version=2`(最偷懶,不推薦)

### 2. 錯誤格式一致化

回傳錯誤時用固定信封,讓 Client 能統一處理:

```json
{
  "success": false,
  "error": {
    "code": "USER_NOT_FOUND",
    "message": "找不到指定的使用者",
    "details": { "userId": 123 }
  }
}
```

避免成功與失敗的回傳格式完全不同,Client 要寫兩套 parser。

### 3. 身分驗證(Authentication)

常見方式:

| 方式 | 原理 | 適合 |
|---|---|---|
| **API Key** | 在 Header 帶固定金鑰 | 內部服務、簡單情境 |
| **Basic Auth** | `Authorization: Basic base64(user:pass)` | 老系統,不建議新做 |
| **Bearer Token(JWT)** | `Authorization: Bearer <token>` | 主流,無狀態 |
| **OAuth 2.0** | 透過授權流程拿 token | 第三方授權(Google 登入等) |
| **mTLS** | 雙向憑證驗證 | 高安全性微服務 |

### 4. 速率限制(Rate Limiting)

透過 HTTP Header 告知配額:

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1700000000
```

超過限制時回 `429 Too Many Requests`,並帶 `Retry-After` Header。

### 5. 冪等性(Idempotency)

同一個請求執行一次與執行多次,結果應該相同。這在網路不穩時特別重要 — Client 重試不會造成重複付款之類的災難。

- `GET`、`PUT`、`DELETE` 天然冪等
- `POST` 不冪等,但可以透過 **Idempotency Key**(Client 自己產生 UUID 放在 Header)達成

Stripe 的付款 API 就強制要求 Idempotency Key。

### 6. 分頁(Pagination)

絕對不要回傳無上限的陣列。常見分頁模式:

| 模式 | 範例 | 適合 |
|---|---|---|
| **Offset-based** | `?page=2&limit=20` | 固定資料、可跳頁 |
| **Cursor-based** | `?after=abc123&limit=20` | 即時流、資料會變動 |
| **Keyset** | `?last_id=100&limit=20` | 效能優先、排序穩定 |

Facebook、GitHub 都用 cursor-based,原因是流式資料下 offset 會出現「讀到重複或漏讀」問題。

---

## 六、REST 的 HTTP 狀態碼速查

這是 REST 最常考的基本功,背起來會省很多時間:

| 區段 | 意義 | 常見碼 |
|---|---|---|
| **1xx** | 資訊 | `100 Continue`(少用) |
| **2xx** | 成功 | `200 OK`、`201 Created`、`204 No Content` |
| **3xx** | 重導向 | `301 Moved Permanently`、`304 Not Modified`(快取命中) |
| **4xx** | Client 錯誤 | `400 Bad Request`、`401 Unauthorized`、`403 Forbidden`、`404 Not Found`、`409 Conflict`、`422 Unprocessable`、`429 Too Many Requests` |
| **5xx** | Server 錯誤 | `500 Internal Server Error`、`502 Bad Gateway`、`503 Service Unavailable`、`504 Gateway Timeout` |

**常見混淆**:
- `401` vs `403`:`401` = 你根本沒登入、`403` = 你登入了但沒權限
- `400` vs `422`:`400` = 請求格式壞掉(JSON parse 錯)、`422` = 格式對但內容不合業務規則(Email 已存在)
- `404` vs `410`:`404` = 找不到、`410 Gone` = 以前有現在永久刪除(很少用但語意精準)

---

## 七、實戰建議

### 新專案開 API 的決策樹

```
需要跨網路?
├── 否 → 用 Library(直接函式呼叫)
└── 是
    ├── 微服務內部 → gRPC
    ├── 對外公開 → REST(或 GraphQL if 前端複雜)
    ├── 即時雙向 → WebSocket
    ├── 被動接收事件 → Webhook(你當 Server)
    └── 本機工具協定 → JSON-RPC over stdio
```

### 學習順序建議

1. **先徹底搞懂 REST** — 這是地基,90% 的工作都會碰到
2. **學會看 OpenAPI(Swagger)文件** — 現代 REST API 的標準規格
3. **再看一種 RPC 風格(推薦 gRPC 或 JSON-RPC)** — 理解 REST 不是唯一選項
4. **了解 GraphQL 的取捨** — 不一定要用,但要知道什麼時候該用
5. **熟悉 Webhook 與 WebSocket** — 補完事件驅動的能力

### 常見新手錯誤

- ❌ 把動詞塞進 URL:`POST /createUser` → ✅ `POST /users`
- ❌ 用 `200 OK` 回錯誤:`{"status": "error"}` with HTTP 200 → ✅ 錯誤時用 4xx/5xx
- ❌ 所有操作都用 POST → ✅ 依語意選擇 HTTP method
- ❌ 不做分頁 → ✅ 永遠假設資料可能有 10 萬筆
- ❌ 回傳錯誤只給「失敗」→ ✅ 給明確的 error code 讓 Client 能程式化處理

---

## 八、延伸主題

本文之外你還可以深入:

- **OpenAPI / Swagger** — REST 的 schema 規範與文件工具
- **AsyncAPI** — 事件驅動 API(Kafka、MQTT 等)的規範
- **HATEOAS** — REST 最嚴格的形式(Hypermedia 驅動)
- **BFF(Backend for Frontend)** — 為前端客製化中介層
- **API Gateway** — Kong、Tyk、AWS API Gateway 等流量閘道器
- **Service Mesh** — Istio、Linkerd,微服務間通訊治理
- **Protobuf vs Avro vs MessagePack** — 二進位序列化格式比較

---

## 九、一句話總結

> **API 是「程式能呼叫的介面」這個廣義概念;REST、RPC、GraphQL、SOAP、WebSocket、Webhook 是它底下不同的風格。不要把「API = REST API」當成預設值 — 認清你的需求,選對風格,比追流行重要。**

---

## 延伸閱讀

- [RESTful API 設計指南(Google)](https://cloud.google.com/apis/design)
- [JSON-RPC 2.0 規範](https://www.jsonrpc.org/specification)(英文,很短)
- [gRPC 官方文件](https://grpc.io/docs/)
- [GraphQL 官方文件](https://graphql.org/learn/)
- [OpenAPI Specification](https://www.openapis.org/)
- [Stripe API 文件](https://stripe.com/docs/api) — 業界公認寫得最好的 REST API 文件範本

---

_最後更新:2026-04-15_
