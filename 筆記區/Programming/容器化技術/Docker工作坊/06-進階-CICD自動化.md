# 06 — 進階：CI/CD 自動化

> 場景：專案成熟了，每次部署都手動 SSH 進伺服器很煩，團隊決定自動化

---

## 什麼是 CI/CD？

- **CI（Continuous Integration，持續整合）**：每次 push 程式碼，自動跑測試，確保不壞別人的東西
- **CD（Continuous Deployment，持續部署）**：測試過後，自動部署到伺服器

簡單說：**你只管寫程式、push，剩下的系統自動幫你做。**

---

## 沒有 CI/CD 的流程（初學者版）

```
你改程式碼
    ↓
git push
    ↓
手動 docker build
    ↓
手動 docker push
    ↓
SSH 進伺服器
    ↓
手動 docker compose pull + up
    ↓
手動確認有沒有壞掉
```

問題：麻煩、容易忘步驟、每個人做法不一樣。

---

## 有 CI/CD 的流程

```
你改程式碼
    ↓
git push
    ↓ （以下全自動）
CI/CD 跑測試
    ↓
docker build + push 到 Registry
    ↓
自動 SSH 進伺服器執行部署指令
    ↓
通知你「部署成功」或「部署失敗」
```

你只做第一步，其他都是機器做的。

---

## 常見 CI/CD 工具

| 工具 | 說明 |
|------|------|
| **GitHub Actions** | GitHub 內建，最普遍，免費額度夠用 |
| GitLab CI/CD | GitLab 內建 |
| Jenkins | 老牌，自架，高度客製 |
| CircleCI | 雲端服務 |

---

## GitHub Actions 怎麼跟 Docker 搭？

在專案根目錄建立 `.github/workflows/deploy.yml`：

```yaml
name: Build and Deploy

on:
  push:
    branches: [main]    # 只有 push 到 main branch 才觸發

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest

    steps:
      # 1. 拉下程式碼
      - uses: actions/checkout@v4

      # 2. 登入 Docker Registry
      - name: Login to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      # 3. Build 並 Push Image
      - name: Build and push backend
        uses: docker/build-push-action@v5
        with:
          context: ./bruce-backend
          push: true
          tags: bruce/task-backend:${{ github.sha }}   # 用 commit hash 當 tag

      # 4. SSH 進伺服器部署
      - name: Deploy to server
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SERVER_SSH_KEY }}
          script: |
            docker compose -f docker-compose.prod.yml pull
            docker compose -f docker-compose.prod.yml up -d
```

---

## Secrets 是什麼？

注意上面的 `${{ secrets.DOCKERHUB_USERNAME }}` 這種寫法。

這是 GitHub 的**密鑰管理**，你把帳號密碼存在 GitHub 設定頁，CI/CD 執行時才會注入，**不會出現在程式碼裡**。

> 永遠不要把密碼寫進 yaml 檔，要用 Secrets。

---

## Staging 環境

成熟的團隊會有三個環境：

```
開發環境（本機）→ Staging（測試伺服器）→ 正式環境（Production）
```

| 環境 | 目的 | 誰用 |
|------|------|------|
| 開發 | 寫程式 | 工程師本機 |
| Staging | 上線前最後驗證，跟正式環境幾乎一樣 | QA、PM、工程師 |
| Production | 真實使用者 | 全世界 |

### CI/CD 配合 Staging 的流程

```
push 到 feature branch
    ↓ CI 跑測試
merge 到 develop branch
    ↓ 自動部署到 Staging
QA 測試通過
    ↓
merge 到 main branch
    ↓ 自動部署到 Production
```

---

## 為什麼 Staging 很重要？

因為有些 bug 只在「接近正式環境」才會出現：

- 環境變數不同
- 資料量不同（本機只有假資料）
- 其他服務的連線行為不同

Staging 讓你**在真實使用者踩到之前先踩到**。

---

## 小結

| 階段 | 你做什麼 | 機器做什麼 |
|------|---------|-----------|
| 寫程式 | 改程式碼 | — |
| push | git push | CI 跑測試 |
| 合併 | merge PR | CD 自動部署到 Staging |
| 確認沒問題 | 在 Staging 測試 | — |
| 上線 | merge 到 main | CD 自動部署到 Production |