# FreeQuota

个人使用的 Supabase 多账号管理与按需用量观察工具。

- Cloudflare Workers / React / Hono，Neon 仅存储管理员 Session 与加密 Supabase PAT。
- 打开页面时实时请求官方 Management API，无 Cron、无后台采集、无用量历史快照。
- 项目详情查询数据库文件系统使用情况和 API 请求量；依赖 PAT 权限及项目运行状态。
- Free 组织展示 **官方套餐限额**（组织级、项目级明确区分），不等同于实际计费量。
- Supabase 组织账单级 Egress、Storage、MAU、Edge Invocations、Logs 等实际用量没有确认可长期使用的公开接口，显示套餐限额及 [Supabase Usage](https://supabase.com/dashboard/org/_/usage) 官方入口，不计算虚假剩余量。
- 所有 Supabase 请求均为只读；没有 Supabase 计费数据写入。
- 当前磁盘/API 统计均是非计费指标，数据源：
  - [Get disk utilization](https://supabase.com/docs/reference/api/v1-get-disk-utilization)
  - [Get project usage API count](https://supabase.com/docs/reference/api/v1-get-project-usage-api-count)
  - [官方套餐额度](https://supabase.com/docs/guides/platform/billing-on-supabase)

## 部署

1. Neon 新建独立数据库，执行 `migrations/001_initial.sql`。
2. Cloudflare Worker 配置 `DATABASE_URL` 和 `TOKEN_ENCRYPTION_KEY` 两项 Secrets。后者为 32 字节随机密钥的 Base64 编码，请保存离线备份。
3. 首次管理员创建（仅当 admin_users 为空）：临时配置 `ADMIN_BOOTSTRAP_PASSWORD` Secret，首次使用 admin 和该密码成功登录后立即删除该 Secret。
4. 在 GitHub Actions Secrets 配置 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 后，push main 将自动执行测试、构建和 `cf deploy`。
5. 绑定自有域名并进入管理页添加 Supabase PAT。使用 Scoped PAT 时需授予项目设置读取、组织信息读取、分析统计读取权限。

### 安全与数据边界

- Session Token 仅保存 SHA-256 哈希，Cookie 为 HttpOnly + Secure + SameSite=Strict。
- 管理员密码以 pgcrypto bcrypt 哈希保存，Supabase PAT 使用 AES-256-GCM 加密，绝不写入前端。
- 用量结果只作为此次请求响应，不写入 Neon。
- `GET /api/accounts/:id/live` 查询每个项目的公开 Management API：
  - `GET /v1/projects/{ref}/config/disk/util`
  - `GET /v1/projects/{ref}/analytics/endpoints/usage.api-counts`
- 同一账号每次最多自动查询前 12 个项目详情，以控制 API 外部子请求和频率。其他项目仍显示在列表，标为本次跳过。
- 403/429/无数据均独立展示错误原因，不冒充 0。
- 初始免费套餐额度为参考，不等于本月账单剩余量；账单需要到 Supabase 组织 Usage 页面查看。

MIT License.
