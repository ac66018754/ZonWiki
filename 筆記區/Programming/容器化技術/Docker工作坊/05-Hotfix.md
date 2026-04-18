# 05 — Hotfix

> 場景：晚上 11 點，主管傳訊息「線上爆了，任務無法儲存！」

---

## Hotfix 的流程

```
發現問題
    ↓
在本機重現問題、找到原因
    ↓
修正程式碼
    ↓
建立新版 Image（hotfix tag）
    ↓
推上 Registry
    ↓
伺服器快速更新
    ↓
確認修復
```

---

## 步驟一：先搞清楚是哪裡壞了

```bash
# 看線上服務的 log
docker compose -f docker-compose.prod.yml logs bruce-backend --tail=200
```

假設你看到：

```
System.NullReferenceException: Object reference not set to an instance of an object
   at TaskManager.Api.Controllers.TaskController.CreateTask
```

找到問題了，是 backend 的 bug。

---

## 步驟二：在本機重現

```bash
docker compose up   # 跑本機開發環境
# 重現同樣的操作，確認問題出現
```

---

## 步驟三：修好 bug，建立 hotfix Image

修完程式碼之後：

```bash
# 用 hotfix tag 建立新 Image
docker build -t bruce/task-backend:1.0.1-hotfix ./bruce-backend

# 推上去
docker push bruce/task-backend:1.0.1-hotfix
```

---

## 步驟四：在伺服器上只更新有問題的服務

```bash
# 只更新 backend，不動 frontend 和 db
docker compose -f docker-compose.prod.yml pull bruce-backend
docker compose -f docker-compose.prod.yml up -d bruce-backend
```

**前端和資料庫完全不受影響，使用者幾乎感覺不到中斷。**

---

## 步驟五：確認修復

```bash
docker compose -f docker-compose.prod.yml logs -f bruce-backend   # 確認沒有新的錯誤
docker compose -f docker-compose.prod.yml ps                # 確認服務正常跑著
```

---

## 如果修了更壞：快速回滾

這就是版本 tag 的價值：

```bash
# 改回 docker-compose.prod.yml 裡的 image tag
image: bruce/task-backend:1.0.0   # 改回上一個版本

# 重新部署
docker compose -f docker-compose.prod.yml up -d backend
```

**Docker Image 是不可變的**，舊版本的 Image 還在 Registry 上，隨時可以回滾，不需要改任何程式碼。

---

## Hotfix 流程的核心優勢

| 場景 | 沒有 Docker | 有 Docker |
|------|------------|-----------|
| 只修一個服務 | 要重啟整個系統 | 只重啟那個容器 |
| 出了問題要回滾 | 要找舊版程式碼重新部署 | 直接改 tag 拉舊 Image |
| 確認修了沒 | 要進伺服器看各種設定 | `docker compose logs` 就清楚 |
| 本機重現問題 | 要裝一堆東西 | 直接 `docker compose up` |

---

## 小結：整個生命週期的 Docker 角色

```
開發前   → 寫 Dockerfile + docker-compose.yml，讓環境可重現
開發中   → docker compose up 啟動全套環境，每天開發
開發後   → docker build + push，把 Image 推上 Registry，CI/CD 自動部署
維運     → docker compose ps/logs，監控、更新、備份
Hotfix   → 快速修復、重建 Image、只更新問題服務、必要時回滾
```
