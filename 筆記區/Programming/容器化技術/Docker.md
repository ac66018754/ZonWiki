# Docker：把應用程式裝進箱子裡

身為工程師，你一定遇過這種情境：「在我電腦上跑得起來啊？」
新同事花一整天裝環境、production 跟 dev 環境差一點點版本就爆炸、一台機器要同時跑 Postgres 15 跟 16 還要互不干擾。
Docker 就是為了解決這些問題而生的。

本文從「容器到底是什麼」講起，建立完整的心智模型,
再一路帶你到會寫 `Dockerfile` 跟 `docker-compose.yml`。

---

## 零、先看整張架構圖

在深入每個組件之前,先建立「Docker 是怎麼運作的」全景圖。
你每下一個 `docker` 指令,背後發生的事情大概是這樣:

```
                                你的電腦 (Host)
 ┌──────────────────────────────────────────────────────────────────────┐
 │                                                                      │
 │   ┌──────────────────┐      ┌──────────────────────────────────┐     │
 │   │  Docker Client   │      │       Docker Daemon (dockerd)    │     │
 │   │                  │      │                                  │     │
 │   │  你打的指令:      │ REST │   ┌──────────┐   ┌──────────┐    │     │
 │   │  docker run ...  │────▶│   │  Images  │   │Containers│    │     │
 │   │  docker ps       │ API  │   │ (模板)   │──▶│ (實例)   │    │     │
 │   │  docker compose  │      │   └──────────┘   └──────────┘    │     │
 │   │                  │      │                                  │     │
 │   └──────────────────┘      │   ┌──────────┐   ┌──────────┐    │     │
 │          ▲                  │   │ Volumes  │   │ Networks │    │     │
 │          │                  │   │ (資料)   │    │ (連線)   │    │     │
 │          │ 使用者操作        │   └──────────┘   └──────────┘    │     │
 │          │                  │                                  │     │
 │                             └────────────┬─────────────────────┘     │
 │                                          │ pull / push               │
 └──────────────────────────────────────────┼───────────────────────────┘
                                            │
                                            ▼
                          ┌───────────────────────────────────┐
                          │   Registry (Image 倉庫)           │
                          │   • Docker Hub (公開,預設)        │
                          │   • AWS ECR / GitHub GHCR / 自架  │
                          └───────────────────────────────────┘
```

### 這張圖在說什麼?

1. **Docker Client**:你每天敲的 `docker` 指令。它其實只是一個**薄薄的命令列**,什麼事都不會自己做。
2. **Docker Daemon(`dockerd`)**:真正的大腦。Client 把你的指令透過 REST API 傳給它,它負責所有髒活 — 拉 image、啟動 container、管 volume、連 network。
3. **Daemon 管理的四大物件**:
   - **Image** = 唯讀模板(食譜)
   - **Container** = Image 跑起來的實例(蛋糕)
   - **Volume** = 資料的家(讓資料在 container 毀滅後還活著)
   - **Network** = container 之間怎麼講話
4. **Registry**:放 image 的倉庫。你 `docker pull nginx` 就是從 Docker Hub 下載;自己 build 好的 image 也可以 `docker push` 上去。

### Windows 的特殊情況

Windows 上的 `docker` 指令不是直接跟 Windows 聊天 — Docker Daemon 其實跑在 WSL2(Linux VM)裡:

```
  Windows 主機                           WSL2 (Linux VM)
 ┌──────────────────┐                  ┌────────────────────────┐
 │                  │                  │                        │
 │  Docker Client   │  named pipe      │   Docker Daemon        │
 │  (docker.exe) ───┼─────────────────▶│   + Images             │
 │                  │                  │   + Containers         │
 │  你的檔案系統     │  跨 VM 檔案同步   │   + Volumes (Linux FS) │
 │  (NTFS) ─────────┼────────────────▶│                        │
 │                  │                  │                        │
 └──────────────────┘                  └────────────────────────┘
```

這解釋了兩件事:
- **為什麼容器都是 Linux**:因為 daemon 就跑在 Linux VM 裡
- **為什麼 Bind Mount 在 Windows 上慢**:因為每次讀寫都要跨越 Windows 檔案系統 ↔ Linux VM 的邊界

### 接下來的章節對應這張圖

| 章節       | 內容                             |
| :--------- | :--------------------------------|
| 第二章     | Image、Container、Volume、Network |
| 第三章     | Docker Client(指令速查)           |
| 第四章     | Image(怎麼寫 Dockerfile 做 image) |
| 第五章     | Compose(一次管一整組 services)    |

---

## 一、Docker 到底是什麼？

一句話：**Docker 是把「應用程式 + 它需要的所有東西」打包起來,在任何機器上都能一致執行的工具。**

這個「所有東西」包含:

- 作業系統層級的檔案（基礎 Linux 發行版）
- 執行環境（Node.js、.NET SDK、Python 解譯器）
- 依賴套件（npm、pip、NuGet）
- 你的應用程式程式碼
- 設定檔與環境變數

### 跟虛擬機（VM）的差異

很多人第一次聽到容器會直覺以為「容器就是輕量版 VM」,這觀念不全錯但不精確。真正的差異在「共用核心」:

```
虛擬機（VM）                         容器（Container）
┌─────────────────────┐            ┌─────────────────────┐
│   App A  │   App B  │            │   App A  │   App B  │
├──────────┼──────────┤            ├──────────┼──────────┤
│ Guest OS │ Guest OS │            │   Libs   │   Libs   │
├──────────┼──────────┤            ├──────────┴──────────┤
│    Hypervisor       │            │   Docker Engine     │
├─────────────────────┤            ├─────────────────────┤
│     Host OS         │            │     Host OS         │
├─────────────────────┤            ├─────────────────────┤
│     Hardware        │            │     Hardware        │
└─────────────────────┘            └─────────────────────┘
```

| 維度         | 虛擬機                       | 容器                          |
| :----------- | :---------------------------| :---------------------------- |
| **隔離層級** | 整個作業系統                  | 只隔離 process + 檔案系統      |
| **啟動時間** | 幾十秒～幾分鐘                | 幾百毫秒                       |
| **檔案大小** | 幾 GB 起跳                   | 幾十 MB ～幾百 MB              |
| **效能開銷** | 明顯（要模擬硬體）            | 幾乎無（直接用 Host 核心）      |
| **適用情境** | 強隔離、跨 OS（Linux on Win） | 同 OS 跑大量服務、CI/CD、微服務 |

**Windows / Mac 上的 Docker Desktop** 實際上還是跑了一個輕量 Linux VM,容器長在這個 VM 裡。
所以在 Windows 上你看到的容器其實是 Linux 容器,只是 Docker Desktop 幫你藏起這層複雜性。

---

## 二、四個核心概念

Docker 的世界其實只有四個詞要記熟:**Image、Container、Volume、Network**。

### 2.1 Image（映像檔）

Image 是**唯讀的模板**,裡面包含「一個應用程式該怎麼跑」的所有資訊。
你可以把它想成:

- 程式設計角度:Image ≈ Class
- 生活角度:Image ≈ 食譜、烤蛋糕的模具

一個 Image 通常長這樣（以 `postgres:16-alpine` 為例）:

```
postgres:16-alpine
├── alpine 3.18 基礎層（~5 MB）
├── postgres 相關套件層（~80 MB）
├── 設定檔層
└── 啟動指令（CMD postgres）
```

Image 是**分層堆疊**的,每一層都 immutable。
這個設計很重要:如果 10 個 image 都基於 alpine 3.18,這層只會在硬碟上存一份。

### 2.2 Container（容器）

Container 是 **Image 被啟動後的執行實例**。

- 程式設計角度:Container ≈ Instance（物件）
- 生活角度:Container ≈ 用食譜做出的蛋糕

你可以從同一個 Image 啟動多個 Container,它們彼此隔離、互不干擾。

```bash
# 同一個 image 跑三個 container
docker run -d --name pg1 -p 5433:5432 postgres:16-alpine
docker run -d --name pg2 -p 5434:5432 postgres:16-alpine
docker run -d --name pg3 -p 5435:5432 postgres:16-alpine
```

**重點**:Container 預設是**短暫的（ephemeral）**。
你刪掉 container,裡面的所有資料就沒了。
這就是為什麼需要下一個概念。

### 2.3 Volume（資料卷）

Volume 是 Docker 管理的**持久化儲存空間**,生命週期獨立於 container。
刪掉 container,volume 還活著，下次 container 起來資料還在。

Docker 提供**三種**資料掛載方式,各自適合不同場景:

#### ① Named Volume（具名卷）

**這是 Docker 最推薦的方式**,資料完全由 Docker 引擎管理。

- **底層原理**:Docker 會在 Host 主機 (宿主機) 的特定目錄建立一個資料夾
  - Linux: `/var/lib/docker/volumes/<volume-name>/_data`
  - Windows (Docker Desktop): 存在 WSL2 的虛擬磁碟裡,`\\wsl$\docker-desktop-data\...`
- **優點**:
  - **效能好**:直接由 Docker 最佳化管理
  - **安全**:你不需要知道宿主機路徑 (Bind Mount就需要指定),防止意外修改
  - **易遷移**:可以輕鬆備份整個 volume(指令:`docker volume inspect`可找出位置，壓縮資料夾後就可以帶走了)
- **適用場景**:資料庫(MySQL、PostgreSQL)、正式生產環境、任何「不想管檔案放哪但要能存活下來」的資料

寫法:

```bash
docker run -v myvolume:/data myimage
```

以本專案為例:

```yaml
volumes:
  - postgres-data:/var/lib/postgresql/data   # Named Volume
```

#### ② Bind Mount（綁定掛載）

直接把 **Host 主機上的一個特定路徑** 對接到容器內部。

- **底層原理**:類似「硬連結」的概念。你指定主機上的 `C:\MyCode` 對應到容器的 `/app`,**兩邊即時同步**。主機改檔 → 容器裡馬上看得到;容器寫檔 → 主機也能直接開。
- **優點**:
  - **開發神器**:主機上改程式碼,容器內的服務搭配 Hot Reload(nodemon、dotnet watch、uvicorn --reload)就能立刻抓到變更,**不需要重 build image**
  - 可以把設定檔 / SSL 憑證等動態塞進容器
- **缺點**:
  - **依賴宿主機的路徑結構**,換一台電腦路徑不一樣就會噴錯
  - Windows / Mac 上效能會比 named volume 差(要跨 VM 邊界同步檔案)
  - 權限問題(容器內的 user 可能跟主機 user 不同,寫出來的檔案 owner 會很亂)
- **適用場景**:本地開發熱重載、掛設定檔(config files)、把 log 寫到主機上方便查看

寫法:

```bash
docker run -v "C:\MyCode:/app" myimage
docker run -v "$(pwd):/app" myimage       # 當前目錄(Linux/macOS)
docker run -v "${PWD}:/app" myimage        # 當前目錄(PowerShell)
```

#### ③ tmpfs（記憶體掛載)

**不持久化**的掛載方式,資料只存在於 **RAM(記憶體)** 中。

- **底層原理**:資料寫入主機的記憶體,不經過硬碟。容器一停,資料立刻消失。
- **優點**:
  - **速度極快**:記憶體存取遠快於 SSD
  - **安全性高**:敏感資料(私鑰、token、session)不會落地,重啟即清空,減少外洩風險
- **缺點**:
  - **只能 Linux 主機**(Windows / Mac 上不支援)
  - 容器重啟就沒了,不能放任何「要保留」的東西
- **適用場景**:敏感資訊暫存、高頻讀寫的暫存快取

寫法:

```bash
docker run --tmpfs /tmp myimage
docker run --tmpfs /tmp:size=100m,mode=1777 myimage   # 限制大小與權限
```

#### 三種掛載方式的決策表

| 我想要的效果                             | 推薦方式         |
| :--------------------------------------- | :--------------- |
| 高效能 + 安全地儲存資料庫資料            | **Named Volume** |
| 正在寫 code,主機改完容器馬上變          | **Bind Mount**   |
| 掛設定檔進容器                           | **Bind Mount**   |
| 密鑰 / token 不想留存在硬碟,且需要極速 | **tmpfs**        |
| 不知道該選哪個                           | **Named Volume** |

簡單的記法:**預設 Named Volume,開發熱重載用 Bind Mount,極致敏感用 tmpfs。**

---

#### 實戰範例(PowerShell 語法)

以下 `` ` `` 是 PowerShell 的換行連接符(等同 bash 的 `\`)。

**① Named Volume — 跑一個 MySQL**

即便你下 `docker rm my_db` 刪除容器,資料依然保留在 `sql_data` 這個 volume 裡,下次啟動掛回去就又能用。

```powershell
# 1. 建立一個具名卷(可省略,docker run 會自動建立)
docker volume create sql_data

# 2. 掛載到容器
# 語法:-v [卷名稱]:[容器內路徑]
docker run -d `
  --name my_db `
  -e MYSQL_ROOT_PASSWORD=password123 `
  -v sql_data:/var/lib/mysql `
  mysql:latest
```

**② Bind Mount — 開發熱重載 Node.js 專案**

在 VS Code 改 code,容器內的 Node 跟著變化(搭配 `nodemon` 或 `node --watch`)。

```powershell
# 語法:-v [主機絕對路徑]:[容器內路徑]
# 注意:Windows 路徑建議用正斜線 /,或整個用雙引號包起來
docker run -it `
  -v C:/Users/YourName/Projects/my-app:/app `
  -w /app `
  node:18-alpine sh
```

**③ tmpfs — 把 nginx 的快取放在記憶體**

```powershell
# 語法:--tmpfs [容器內路徑]
docker run -d `
  --name fast_cache `
  --tmpfs /app/cache `
  nginx:latest
```

---

#### 給後端工程師的三個判斷指標

**1. 為什麼正式環境不要用 Bind Mount?**

因為它依賴**特定的主機路徑**(例如 `C:/Users/TsungEn/...`)。一旦要搬到測試機、雲端(AWS / GCP / Azure),路徑對不上就噴錯。正式環境一律 Named Volume,路徑無關、Docker 全權管理。

**2. Windows 上的效能陷阱**

Windows 的 Docker 底層是 WSL2(Linux VM):

- **Named Volume** 直接寫在 WSL2 的 Linux 虛擬磁碟裡 → **快**
- **Bind Mount** 要跨 Windows 檔案系統 → **慢**(尤其大量小檔)

大型編譯場景(`dotnet build`、`npm install`、`yarn`),如果用 Bind Mount 把整個專案掛進去,`bin/`、`obj/`、`node_modules/` 會讀寫超慢。解法兩個:

- 把 `bin`、`obj`、`node_modules` 用 **Named Volume 覆蓋掉** bind mount 裡的對應路徑
- 或直接把原始碼擺在 WSL2 的檔案系統裡(`\\wsl$\Ubuntu\home\...`),在 WSL2 裡下 `docker run`

範例(混用 bind mount + named volume,把 `node_modules` 從 bind mount 裡「挖空」):

```yaml
services:
  app:
    build: .
    volumes:
      - .:/app                       # Bind Mount:程式碼熱同步
      - node_modules:/app/node_modules   # Named Volume 覆蓋,效能回來
volumes:
  node_modules:
```

**3. 怎麼看 Named Volume 裡到底存了什麼?**

```powershell
docker volume ls                     # 列出所有 volume
docker volume inspect sql_data       # 看這個 volume 的詳情(Mountpoint 會告訴你實際路徑)
docker volume rm sql_data            # 砍掉(小心!)
docker volume prune                  # 清掉所有沒在用的 volume

# 想直接看內容?開一個暫時 container 掛進去 ls
docker run --rm -v sql_data:/data alpine ls -la /data
```

最後這招(拿 alpine 臨時掛進去看)很實用,因為 Windows 上 Named Volume 的 Mountpoint 是 WSL2 內部路徑,從檔案總管打不開。

### 2.4 Network（網路）

Container 預設會被放進一個 **bridge network**,container 之間可以用**服務名稱**互相連線。

```yaml
services:
  app:
    # 這個 container 裡可以用 "postgres" 當 hostname 連到下面那個服務
    environment:
      DB_HOST: postgres

  postgres:
    image: postgres:16-alpine
```

這是 Docker 最神奇的地方之一:你不用知道 container 的 IP,直接用名字就能溝通。Docker 內建 DNS 幫你處理。

---

## 三、最常用的指令

### 3.1 Image 相關

```bash
docker pull postgres:16-alpine        # 從 Docker Hub 抓 image
docker images                         # 列出本機有的 image
docker rmi postgres:16-alpine         # 刪掉 image
docker image prune                    # 清掉沒用到的 image
```

### 3.2 Container 相關

```bash
# 執行 container
docker run -d \                        # -d 背景執行
  --name my-postgres \                 # 取名字
  -p 5433:5432 \                       # port 對應（host:container）
  -e POSTGRES_PASSWORD=secret \        # 環境變數
  -v pgdata:/var/lib/postgresql/data \ # volume
  postgres:16-alpine                   # image

# 管理
docker ps                              # 看執行中的 container
docker ps -a                           # 看全部（含已停止）
docker stop my-postgres                # 停止
docker start my-postgres               # 再啟動
docker restart my-postgres             # 重啟
docker rm my-postgres                  # 刪除（要先停止）

# 進去看看
docker logs my-postgres                # 看日誌
docker logs -f my-postgres             # 持續追蹤日誌（像 tail -f）
docker exec -it my-postgres bash       # 進入 container 的 shell
docker exec -it my-postgres psql -U postgres   # 直接執行指令
```

### 3.3 最實用的除錯三連招

90% 的 Docker 問題靠這三個指令就能定位:

```bash
docker ps -a                  # 1. 我的 container 到底有沒有跑？狀態是？
docker logs <name>            # 2. 它說了什麼？有什麼錯誤訊息？
docker exec -it <name> sh     # 3. 進去裡面親自看看狀況
```

---

## 四、寫你自己的 Image:Dockerfile

`Dockerfile` 是一份**把你的應用打包成 Image 的說明書**。每一行指令會產生一個 layer。

### 4.1 基本範例（.NET 應用）

```dockerfile
# ===== Stage 1: Build =====
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# 先複製 csproj 跑 restore,這樣如果只改程式碼,restore 層能被快取
COPY ["MyApp.csproj", "./"]
RUN dotnet restore

# 再複製全部原始碼 + build + publish
COPY . .
RUN dotnet publish -c Release -o /app/publish

# ===== Stage 2: Runtime =====
FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app/publish .
EXPOSE 8080
ENTRYPOINT ["dotnet", "MyApp.dll"]
```

這就是**多階段建置（multi-stage build）**:
- Stage 1 用肥的 SDK image 編譯
- Stage 2 只搬編譯好的成品到瘦身過的 runtime image
- 最終 image 不會包含 SDK、原始碼、node_modules

### 4.2 Dockerfile 常用指令

| 指令         | 作用                                        |
| :----------- | :------------------------------------------ |
| `FROM`       | 基礎 image（一定是第一行）                  |
| `WORKDIR`    | 設定工作目錄（後續指令的 cwd）              |
| `COPY`       | 把 host 的檔案複製進 image                  |
| `ADD`        | 類似 COPY,但會自動解壓縮、支援 URL（少用） |
| `RUN`        | 在**建置時**執行指令                        |
| `ENV`        | 設定環境變數                                |
| `EXPOSE`     | 宣告 container 會使用的 port（文件作用）    |
| `ARG`        | 建置時的參數（`--build-arg` 傳入）          |
| `CMD`        | 容器**啟動時**的預設指令（可被覆寫）        |
| `ENTRYPOINT` | 容器啟動時一定會執行的指令（CMD 變成參數）  |

### 4.3 Layer Cache 的關鍵心法

**把最少變動的放前面、最常變動的放後面。**

```dockerfile
# 壞:改一行程式碼,npm install 就要重跑
COPY . .
RUN npm install

# 好:改程式碼時,npm install 層還能命中快取
COPY package*.json ./
RUN npm install
COPY . .
```

### 4.4 .dockerignore

跟 `.gitignore` 一樣重要。沒設定的話,`COPY . .` 會把 `node_modules/`、`.git/`、`bin/`、`obj/` 全都複製進 image,變超大。

```
node_modules
bin
obj
.git
.vs
.vscode
*.log
```

---

## 五、Docker Compose:把一組服務一起帶起來

單一 container 用 `docker run`,一組服務用 `docker compose`。Compose 是**宣告式**的 — 你描述你想要的狀態,Docker 幫你實現。

### 5.1 看本專案的 docker-compose.yml

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: zonwiki-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: zonwiki
      POSTGRES_PASSWORD: zonwiki_dev_password
      POSTGRES_DB: zonwiki
      TZ: Asia/Taipei
    ports:
      - "5433:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U zonwiki -d zonwiki"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s

volumes:
  postgres-data:
    name: zonwiki-postgres-data
```

逐段拆解:

| 區塊                | 意思                                                                                              |
| :------------------ | :------------------------------------------------------------------------------------------------ |
| `services:`         | 要跑哪些 container                                                                                |
| `postgres:`         | 這個服務的名字（之後別的 container 用這個名字連）                                                 |
| `image:`            | 用哪個 image                                                                                      |
| `container_name:`   | 實際 container 的名字（`docker ps` 看到的）                                                       |
| `restart:`          | 重啟策略。`unless-stopped` = 除非手動停,不然一直重啟                                              |
| `environment:`      | 環境變數                                                                                          |
| `ports:`            | `"host:container"`。這裡把 container 的 5432 露在 host 的 5433                                    |
| `volumes:`          | `named-volume:container-path`                                                                     |
| `healthcheck:`      | 健康檢查。定期執行 `pg_isready`,用來判斷 container 是否真的可用                                   |
| `volumes:` (外層)   | 宣告 named volume                                                                                 |

### 5.2 Compose 常用指令

```bash
docker compose up              # 啟動（前景）
docker compose up -d           # 啟動（背景）
docker compose down            # 停止並刪除 container（volume 保留）
docker compose down -v         # 連 volume 一起砍（謹慎！資料會沒）
docker compose ps              # 看這組 service 的狀態
docker compose logs -f         # 看所有 service 的日誌
docker compose logs -f postgres  # 只看某個 service
docker compose restart postgres
docker compose exec postgres psql -U zonwiki   # 對特定 service 執行指令
```

### 5.3 服務間連線

如果本專案之後加一個 `app` service 要連 postgres:

```yaml
services:
  app:
    build: .
    environment:
      # 在同一個 compose network 裡,直接用服務名當 hostname
      # 注意 port 是 container 內部的 5432,不是 host 的 5433
      ConnectionString: "Host=postgres;Port=5432;Database=zonwiki;Username=zonwiki;Password=zonwiki_dev_password"
    depends_on:
      postgres:
        condition: service_healthy   # 等 postgres 的 healthcheck 通過才起來
```

這段 `depends_on + service_healthy` 是 compose 的殺手級功能。沒這個,app 很容易在 postgres 還沒 ready 前就啟動然後 crash。

---

## 六、常見陷阱與解法

### 陷阱 1:改了程式碼,container 卻沒變化

**原因**:container 跑的是 image 的快照,image 沒重建就不會變。

```bash
docker compose up -d --build     # 加上 --build 強制重建
```

### 陷阱 2:資料莫名消失

**原因**:沒設 volume,或用 `docker compose down -v` 把 volume 砍了。

養成習慣:**正式資料一定要 named volume,砍東西前看清楚有沒有 `-v`。**

### 陷阱 3:port 被佔用

```
Error: port 5432 is already allocated
```

**原因**:host 上本來就有個 Postgres 跑在 5432,或另一個 container 佔著。

解法:改 host port（container 內部不用動）。

```yaml
ports:
  - "5433:5432"   # host 5433 → container 5432
```

### 陷阱 4:Windows 路徑問題

Bind mount 寫 Windows 路徑要小心,Docker Desktop 會自動轉,但在 PowerShell 裡最好用:

```powershell
docker run -v "${PWD}:/app" myimage
```

### 陷阱 5:image 越長越大

**原因**:
1. 沒用 multi-stage build
2. 沒設 `.dockerignore`
3. 每個 `RUN` 都裝東西後沒清

改善:

```dockerfile
# 壞
RUN apt-get update
RUN apt-get install -y curl
RUN apt-get install -y git

# 好:合併 + 清 cache
RUN apt-get update && \
    apt-get install -y curl git && \
    rm -rf /var/lib/apt/lists/*
```

### 陷阱 6:container 一啟動就退出

```bash
docker ps -a    # 看到 status Exited (1) 5 seconds ago
docker logs <name>   # 先看它到底吐了什麼錯
```

最常見原因:主程式沒持續執行（Docker 的 container 會在主 process 結束時退出）。

---

## 七、進階主題（先知道有就好）

| 主題             | 一句話說明                                                                  |
| :--------------- | :-------------------------------------------------------------------------- |
| **BuildKit**     | Docker 新的建置引擎,更快、支援快取掛載。現在 Docker Desktop 預設啟用。      |
| **Registry**     | Image 的倉庫。Docker Hub 是公用的,也可以自架或用 AWS ECR / GitHub GHCR。    |
| **Namespace**    | Linux 核心功能,Docker 用來做 process / network / mount / user 隔離。        |
| **cgroups**      | Linux 核心功能,Docker 用來限制 CPU / 記憶體 / IO。                          |
| **Kubernetes**   | 多台機器、大規模跑 container 的編排系統。Docker 管單機,K8s 管一整群。       |
| **Podman**       | Docker 的替代品,daemonless、rootless,指令幾乎一樣。                         |

---

## 八、一張心智地圖

```
想跑一個服務
  │
  ├── 只跑一個？               → docker run ...
  │
  └── 一組服務一起跑？         → docker-compose.yml + docker compose up
                                   │
                                   ├── 資料要保留 → volume
                                   ├── 服務互連   → 用服務名當 hostname
                                   └── 啟動順序   → depends_on + healthcheck

想打包我的應用
  │
  └── 寫 Dockerfile
        ├── 最小化 image:multi-stage build
        ├── 最大化快取:少變的放前、常變的放後
        └── 別把 node_modules 帶進去:.dockerignore
```

記住這張圖,你大概 80% 的場景都能自己處理了。剩下 20% 遇到再查手冊。
