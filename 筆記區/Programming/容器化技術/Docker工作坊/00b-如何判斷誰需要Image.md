# 00b — 如何判斷誰需要 Image？

> 如果專案是我自己規劃的，我怎麼知道什麼東西需要 Image、要自己建還是從 Docker Hub 拉？

---

## 核心思維：一個問題搞定

> **「這個東西是我寫的，還是我用的？」**

- **我寫的** → 自己建 Dockerfile（因為沒有人幫你打包）
- **我用的** → Docker Hub 拉現成的（因為官方或社群已經幫你打包好了）

---

## 實際拆解專案的方法

**第一步：把系統拆成「服務」**

把你的系統想成幾個獨立運作的東西，每個服務就是一個容器。

以任務管理系統為例：

```
任務管理系統
├── 使用者看到的畫面   → React 前端
├── 處理業務邏輯       → .NET API
└── 儲存資料           → 資料庫
```

**第二步：對每個服務問那個問題**

| 服務 | 這是我寫的，還是我用的？ | 結論 |
|------|------------------------|------|
| React 前端 | 我寫的（我的 UI 程式碼） | 自己寫 Dockerfile |
| .NET API | 我寫的（我的商業邏輯） | 自己寫 Dockerfile |
| PostgreSQL | 我用的（現成的資料庫軟體） | Docker Hub 拉 |

---

## 更多例子：常見的「我用的」（直接 Docker Hub 拉）

這些東西都是現成軟體，官方都有維護 Image：

| 服務類型 | 常見選擇 | Docker Hub Image |
|---------|---------|-----------------|
| 關聯式資料庫 | PostgreSQL、MySQL、MariaDB | `postgres`、`mysql` |
| 快取 | Redis | `redis` |
| 訊息佇列 | RabbitMQ、Kafka | `rabbitmq`、`confluentinc/cp-kafka` |
| 搜尋引擎 | Elasticsearch | `elasticsearch` |
| 反向代理 | Nginx、Traefik | `nginx`、`traefik` |
| 監控 | Prometheus、Grafana | `prom/prometheus`、`grafana/grafana` |
| 物件儲存 | MinIO（S3 相容） | `minio/minio` |

---

## 灰色地帶：Nginx

Nginx 是現成軟體，通常直接拉。  
但如果你需要客製設定（自訂 `nginx.conf`），有兩種做法：

**做法 A：用 Bind Mount 掛設定檔進去（不建新 Image）**
```yaml
nginx:
  image: nginx
  volumes:
    - ./nginx.conf:/etc/nginx/nginx.conf
```

**做法 B：寫 Dockerfile，把設定檔複製進去（建新 Image）**
```dockerfile
FROM nginx
COPY nginx.conf /etc/nginx/nginx.conf
```

> 判斷原則：改動小 → Bind Mount；需要版本控制或要推上 Registry → 寫 Dockerfile

---

## 什麼時候「我用的」也要自己寫 Dockerfile？

極少數情況：官方 Image 不夠用，要裝額外的東西。

例如：PostgreSQL 官方 Image 沒有某個 extension，你要自己裝：

```dockerfile
FROM postgres:16
RUN apt-get install -y postgresql-16-pgvector   # 裝 pgvector extension
```

這種情況你還是從官方 Image 出發（`FROM postgres:16`），只是在上面加料。

---

## 決策樹（一眼判斷）

```
這個服務是我自己寫的程式碼嗎？
├── 是 → 自己寫 Dockerfile
└── 否（現成軟體）
    ├── 官方 Image 夠用嗎？
    │   ├── 是 → 直接 Docker Hub 拉
    │   └── 否（需要客製）
    │       ├── 只是掛設定檔 → Bind Mount
    │       └── 需要裝額外套件 → FROM 官方 Image，加料後自建
    └── Docker Hub 根本沒有這個東西 → 自己寫 Dockerfile
```

---

## 實戰心法

1. 先去 [hub.docker.com](https://hub.docker.com) 搜尋看看有沒有官方 Image
2. 看 Image 的 README，通常會說明怎麼設定環境變數、資料存在哪
3. **不要重造輪子**：只要有官方 Image，絕大多數情況直接用就好