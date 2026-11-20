# FreeQuota

开源、低成本的 Supabase 多账号免费额度查看工具。用户登录管理页面时，使用各账号的 Supabase Personal Access Token 实时读取官方 Management API。

- Cloudflare Workers + Static Assets + Hono + React
- Neon PostgreSQL：单管理员、会话及**加密** PAT
- 不使用 Cloudflare Access、Cron、后台采集或额度历史快照
- 多账号单独查询，每次前端最多并发 2 个账号；失败互不影响
- 未验证官方用量接口的指标明确显示“未支持”，不编造剩余额度
- 只读 Supabase API，不创建/删除 Supabase 项目

## 部署

1. 在 Neon Free 项目中创建数据库，执行 `migrations/001_initial.sql`。
2. 通过安全的一次性 SQL 操作设置管理员口令（使用 `crypt(password,gen_salt('bf',10))`），勿将密码写入版本库。
3. 为 Worker 设置 `DATABASE_URL` 和 `TOKEN_ENCRYPTION_KEY` 两个 Secrets。后者是 **32 字节随机密钥的 Base64 编码**。
4. 安装依赖，执行 `cf deploy`（`cloudflare.config.ts` 指定 Worker 名称为 `freequota`）。
5. 为 Worker 绑定自己的域名，进入管理页添加 Supabase PAT。

部署前先在非生产环境验证依赖版本、构建、登录和多账号查询。密码与 PAT 不属于开源仓库内容。

### API

- `POST /api/auth/login`：用户名、密码登录
- `POST /api/auth/logout`：注销会话
- `GET /api/auth/me`：会话检查
- `PUT /api/auth/password`：管理员修改密码并注销所有会话
- `GET /api/accounts`：账号列表（不含 PAT）
- `POST /api/accounts`：验证、加密保存新 PAT
- `PATCH /api/accounts/:id`：编辑账号别名、备注、PAT
- `DELETE /api/accounts/:id`：仅删除本工具的账号记录
- `GET /api/accounts/:id/live`：实时查询指定账号

### 安全

Cookie 使用 `HttpOnly; Secure; SameSite=Strict`，Session 原文不落库。密码采用 pgcrypto bcrypt 验证。Supabase PAT 使用 AES-256-GCM 加密且只在 Worker 服务端解密。管理 API 禁止跨域写入及缓存。管理员登录错误会触发账户暂时锁定。

**关于 Supabase 免费名额：**官方参考限制为每用户两个活跃 Free 项目，但组织 Owner/Admin 关系会影响新建资格。对于没有可靠官方查询接口的账单用量，FreeQuota 会注明未支持，而非显示虚假值。

## License

MIT
