# FreeQuota

个人使用的 Supabase 多账号管理、Neon 免费额度观察与 Cloudflare 免费额度查询工具。

- Cloudflare Workers / React / Hono；Neon 数据库仅保存管理员 Session、加密 Supabase PAT 和加密 Neon API Key。
- 打开页面时按需实时请求官方 API，无 Cron、无后台采集、无用量历史快照。
- Supabase 模块：多账号管理、项目数据库磁盘运行指标及 API 请求量观察。
- Neon 模块：单个 Neon API Key 管理其可访问的 Organizations 和 Projects，展示 Free Plan 的 Compute、PostgreSQL Storage、数据传输、Projects、Branches。
- Neon PostgreSQL Storage 按 Neon 官方 Free Plan 指引，汇总项目所有 Branch 的 `logical_size`；不使用可能为 0 的 `data_storage_bytes_hour` 推算存储容量。
- Neon 项目用量快照用于监控，不是账单计量数据；官方数据可能延迟。无法确认的指标显示不可用，不冒充 0。
- Neon V1 不展示未经验证的 Object Storage、Functions、Auth MAU 实际用量。
- 所有 Supabase Management API 和 Neon API 请求均为只读；凭证写入仅发生在 FreeQuota 自己的数据库。
- 不保存 Supabase 或 Neon 的用量历史，不创建定时采集任务。

## 部署

1. Neon 新建独立数据库，执行 `migrations/001_initial.sql`、`migrations/002_neon_credentials.sql` 和 `migrations/003_cloudflare_credentials.sql`。
2. Cloudflare Worker 配置 `DATABASE_URL` 和 `TOKEN_ENCRYPTION_KEY` 两项 Secrets。后者为 32 字节随机密钥的 Base64 编码，请保存离线备份。
3. 首次管理员创建（仅当 `admin_users` 为空）：临时配置 `ADMIN_BOOTSTRAP_PASSWORD` Secret，首次使用 admin 和该密码成功登录后立即删除该 Secret。
4. 在 GitHub Actions Secrets 配置 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`。Pull Request 只运行测试和构建；只有 push 到 `main` 才部署生产 Worker。
5. 绑定自有域名并登录管理页。Supabase 模块添加 Supabase PAT；Neon 模块添加 Neon Personal API Key。

### Neon API Key

- 推荐使用 **Personal API Key**，它可以访问当前用户所属组织中有权限访问的项目。
- Organization API Key 只能访问对应组织；Project-scoped API Key 只能访问对应项目。
- API Key 仅在提交到 Worker 后验证，并使用现有 AES-256-GCM 密钥加密保存；前端不会回显。
- Neon V1 仅调用 `GET /users/me/organizations`、`GET /projects`、`GET /projects/{project_id}` 和 `GET /projects/{project_id}/branches`。
- Free Plan 参考额度：每组织 100 个项目；每项目 100 CU-hours/月、1 GB PostgreSQL 存储、5 GB 公网传输、10 个 Branch；每组织所有项目合计 20 GB PostgreSQL 存储。
- Compute 和数据传输按项目快照当前周期显示；Storage 汇总 Branch `logical_size`；Projects 与 Branches 为当前数量。
- Neon 项目列表单组织最多读取 400 个；Branch 详情最多读取 1000 个。超出时明确标记数据不完整。
- Neon 官方项目快照字段不用于计费或计量；项目 Egress 展示的是 `data_transfer_bytes` 项目快照，不将其宣称为账单级精确数据。

### Supabase 数据边界

- Free 组织展示官方套餐限额（组织级、项目级明确区分），不等同于实际计费量。
- Supabase 组织账单级 Egress、Storage、MAU、Edge Invocations、Logs 等实际用量没有确认可长期使用的公开接口，显示套餐限额及官方 Usage 页面入口，不计算虚假剩余量。
- 当前磁盘/API 统计均是非计费指标，数据源：
  - [Get disk utilization](https://supabase.com/docs/reference/api/v1-get-disk-utilization)
  - [Get project usage API count](https://supabase.com/docs/reference/api/v1-get-project-usage-api-count)
  - [官方套餐额度](https://supabase.com/docs/guides/platform/billing-on-supabase)

### 安全与数据边界

- Session Token 仅保存 SHA-256 哈希，Cookie 为 HttpOnly + Secure + SameSite=Strict。
- 管理员密码以 pgcrypto bcrypt 哈希保存；Supabase PAT 与 Neon API Key 使用 AES-256-GCM 加密，绝不写入前端。
- 用量结果只作为此次请求响应，不写入 Neon。
- 403/429/无数据均独立展示错误原因，不冒充 0。
- Neon API Key 只用于只读 GET 请求；FreeQuota 不调用 Neon 的创建、更新、删除接口。

MIT License.


## Cloudflare 单账号

- Cloudflare 模块按单账号设计，使用自定义 API Token；Token 通过现有 AES-256-GCM 密钥加密保存到 Neon。
- 打开页面时按需实时查询，不创建 Cron，不保存 Cloudflare 用量历史。
- Workers、D1、R2、KV 使用 GraphQL Analytics；Workers、D1、R2、KV、Pages、DNS 资源清单使用只读 REST API。
- 创建自定义 API Token 时需要：Account Analytics Read、Workers Scripts Read、D1 Read、Workers R2 Storage Read、Workers KV Storage Read、Pages Read、Zone Zone Read、Account DNS Settings Read。
- Workers、D1、KV 按 UTC 日统计；R2 操作按月统计；Pages 部署记录为非跳过 Deployment 记录估算；DNS 配额按 Zone 读取。
- R2 GB-month 只有在日峰值存储采样覆盖完整时才计算；缺失采样、权限不足、限流和 API 错误不会被当成零。
- GraphQL Analytics 运行数据与最终账单数据可能存在口径差异；Pages 部署记录也不冒充官方最终构建计费数据。
- Cloudflare API Token 只用于只读查询；凭证写入仅发生在 FreeQuota 自己的数据库。
