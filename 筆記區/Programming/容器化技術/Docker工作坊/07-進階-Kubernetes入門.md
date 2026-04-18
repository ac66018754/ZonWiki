# 07 — 進階：Kubernetes 入門概念

> 場景：系統流量大了，一台伺服器跑不夠，需要多台機器分擔

---

## 先理解問題：Docker Compose 的限制

Docker Compose 很好用，但有個根本限制：**它只能管理一台機器上的容器。**

當系統長大：

- 流量暴增 → 需要同時跑多個 backend 容器分擔
- 一台機器掛掉 → 服務全部停擺
- 多台伺服器 → Compose 沒辦法跨機器協調

這時就需要 **Kubernetes（K8s）**。

---

## Kubernetes 是什麼？

Kubernetes 是一個**容器編排系統**，負責：

- 決定容器要跑在哪台機器上
- 自動補起掛掉的容器
- 根據流量自動增減容器數量
- 在多台機器間分配流量

> 你可以把 Kubernetes 想成「超強版的 Docker Compose，但可以管幾百台機器」。

---

## 核心概念

### Cluster（叢集）

多台機器組成一個群體，K8s 統一管理。

```
Cluster
├── Control Plane（大腦，負責決策）
└── Nodes（工作機器，實際跑容器的地方）
    ├── Node 1
    ├── Node 2
    └── Node 3
```

### Pod

K8s 裡的最小單位，**一個 Pod 通常包一個容器**。

```
Deployment（管理 Pod 數量）
└── Pod 1 → backend 容器
└── Pod 2 → backend 容器
└── Pod 3 → backend 容器
```

### Deployment

告訴 K8s「我要跑幾個 Pod」，K8s 負責維持這個數量。

```yaml
# 等同於 docker-compose 裡的 service，但多了「我要幾份」的概念
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
spec:
  replicas: 3          # 同時跑 3 個 backend 容器
  selector:
    matchLabels:
      app: backend
  template:
    spec:
      containers:
        - name: backend
          image: mycompany/task-backend:1.0.0
```

### Service

讓外部能連進來，並且**自動分流**到多個 Pod。

---

## Docker Compose vs Kubernetes 對照

| 概念 | Docker Compose | Kubernetes |
|------|---------------|-----------|
| 設定檔 | `docker-compose.yml` | 多個 yaml 檔（Deployment、Service...） |
| 服務 | `services:` 下的每個項目 | Deployment + Pod |
| 網路 | 自動 | Service |
| 幾台機器 | 1 台 | 多台 |
| 自動擴充 | 不支援 | 支援（HPA） |
| 掛掉自動重啟 | `restart: always` | 內建 |

---

## 自動擴充（Auto Scaling）

這是 K8s 最強的功能之一：

```yaml
# HPA = Horizontal Pod Autoscaler
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  scaleTargetRef:
    name: backend
  minReplicas: 2        # 最少跑 2 個
  maxReplicas: 10       # 最多跑 10 個
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          averageUtilization: 70   # CPU 超過 70% 就自動加 Pod
```

流量大 → 自動加 Pod → 流量小 → 自動縮回去，**不用人工介入**。

---

## 零停機部署（Rolling Update）

K8s 預設的部署方式：

```
舊版: Pod1(v1) Pod2(v1) Pod3(v1)

更新中:
Pod1(v2) Pod2(v1) Pod3(v1)   ← 先更新一個，確認沒問題
Pod1(v2) Pod2(v2) Pod3(v1)   ← 再更新第二個
Pod1(v2) Pod2(v2) Pod3(v2)   ← 全部更新完

使用者全程都有服務，只是有些請求打到 v1，有些打到 v2
```

---

## 常見的 K8s 雲端服務

自己架 K8s 很複雜，通常用雲端的托管版：

| 雲端 | 服務名稱 |
|------|---------|
| AWS | EKS（Elastic Kubernetes Service） |
| GCP | GKE（Google Kubernetes Engine） |
| Azure | AKS（Azure Kubernetes Service） |

---

## 你什麼時候才需要 K8s？

**不是每個專案都需要。** 先問自己：

| 情況 | 建議 |
|------|------|
| 小型專案、流量穩定、一台機器夠用 | Docker Compose 就好 |
| 需要多台機器、流量不穩定、高可用 | 考慮 K8s |
| 團隊沒有 K8s 經驗 | 先用 Compose，等真的需要才遷移 |

> K8s 的複雜度很高，維護成本也高。過早引入只會讓專案更難維護。

---

## 學習路徑建議

```
Docker 基礎
    ↓
docker-compose 熟練
    ↓
CI/CD 自動化（GitHub Actions）
    ↓
雲端基礎概念（VM、網路、DNS）
    ↓
Kubernetes 基礎
    ↓
K8s 進階（Helm、Ingress、Secret 管理...）
```

**不要跳步驟。** K8s 本質上還是在跑 Docker Container，基礎沒有打好，K8s 只會更混亂。