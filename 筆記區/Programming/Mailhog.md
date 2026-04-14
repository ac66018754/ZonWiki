# MailHog

MailHog 是一個本機開發用的假 SMTP 伺服器，專門用來擷取應用程式寄出的 email。

## 主要特點

- **擷取信件不會實際寄出**：應用程式以為自己在寄信，但 MailHog 把所有信件載下來，不會真的送到收件人信箱。
- **內建 Web UI**：可以在瀏覽器裡看到所有被擷取的信件內容（主旨、內文、HTML、附件）。
- **零設定**：用 Docker 跑起來就能使用，不需要註冊帳號或設定 API key。

### 在本專案中的角色

本專案的 `docs/local/docker-compose.yml` 會同時跑 Postgres + MailHog 兩個容器：

| 項目   | Port | 用途                             |
| :----- | :--- | :------------------------------- |
| SMTP   | 1025 | 應用程式透過這個 port 寄信進來 |
| Web UI | 8025 | 開 `http://localhost:8025` 看信  |

`Infrastructure/Email/SmtpEmailSender.cs`（我們 CP-1 寫的那個）的預設設定就是 `Email:SmtpHost=localhost`、`Email:SmtpPort=1025`，直接接到 MailHog。

### 為什麼不用真實 SMTP？

Phase 1–8 是**本機優先（local-first）**策略：

- 不需要申請 AWS SES、SendGrid 等服務。
- 不會不小心寄到真實信箱（例如測試時不小心把「密碼重設信」寄給真人）。
- Phase 6 的註冊確認、密碼重設、customer 成員邀請流程都能在本機完整演練。
- 開發者要驗證「信件長什麼樣子」只要開瀏覽器連 `http://localhost:8025`。

### 到 Phase 9 會怎樣？

依 `docs/architecture.md` 的設計，MailHog 只是 `IEmailSender` 介面的一種實作（`SmtpEmailSender`）。Phase 9 會把 DI 註冊從 `SmtpEmailSender` 換成 `SesEmailSender`（AWS SES），feature 程式碼完全不動，就是之前說的「Infrastructure 替換」策略。
