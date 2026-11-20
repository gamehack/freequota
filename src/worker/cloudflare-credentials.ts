
import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";
import { encryptToken, decryptToken, EncryptionConfigurationError } from "./crypto";
import { getCloudflareOverview, validateCloudflareToken, safeCloudflareError, cloudflareErrorStatus } from "./cloudflare";
import type { AppEnv } from "./types";

export const cloudflareRoutes = new Hono<AppEnv>();

type CredentialRow = {
  account_id: string;
  token_ciphertext: string;
  token_iv: string;
  updated_at: string;
};

async function credential(c: any): Promise<CredentialRow | null> {
  const sql = neon(c.env.DATABASE_URL);
  const rows = await sql`SELECT account_id,token_ciphertext,token_iv,updated_at
    FROM cloudflare_credentials WHERE id=1 LIMIT 1`;
  return rows.length ? rows[0] as CredentialRow : null;
}

async function accessToken(c: any, row: CredentialRow): Promise<string> {
  return decryptToken(
    String(row.token_ciphertext),
    String(row.token_iv),
    c.env.TOKEN_ENCRYPTION_KEY,
  );
}

cloudflareRoutes.get("/status", async c => {
  const row = await credential(c);
  return c.json({
    configured: Boolean(row),
    accountId: row ? String(row.account_id) : null,
    updatedAt: row ? String(row.updated_at) : null,
  });
});

cloudflareRoutes.put("/credential", async c => {
  const body = await c.req.json().catch(() => null);
  const accountId = typeof body?.accountId === "string" ? body.accountId.trim().toLowerCase() : "";
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!/^[0-9a-f]{32}$/.test(accountId)) {
    return c.json({ error: "Cloudflare Account ID 必须是 32 位十六进制字符串" }, 400);
  }
  if (token.length < 20 || token.length > 512) {
    return c.json({ error: "Cloudflare API Token 格式无效" }, 400);
  }

  try {
    await validateCloudflareToken(token, accountId);
  } catch (error) {
    return c.json(
      { error: "Cloudflare API Token 验证失败：" + safeCloudflareError(error) },
      cloudflareErrorStatus(error),
    );
  }

  let encrypted: { ciphertext: string; iv: string };
  try {
    encrypted = await encryptToken(token, c.env.TOKEN_ENCRYPTION_KEY);
  } catch (error) {
    if (error instanceof EncryptionConfigurationError) {
      return c.json({
        error: "服务加密密钥配置错误：请检查 TOKEN_ENCRYPTION_KEY",
        code: "INVALID_ENCRYPTION_KEY",
      }, 503);
    }
    console.error("Cloudflare API token encryption error", error instanceof Error ? error.name : "unknown");
    return c.json({ error: "Cloudflare API Token 加密失败，请检查 Worker 日志" }, 500);
  }

  const sql = neon(c.env.DATABASE_URL);
  await sql`INSERT INTO cloudflare_credentials(id,account_id,token_ciphertext,token_iv,key_version)
    VALUES(1,${accountId},${encrypted.ciphertext},${encrypted.iv},1)
    ON CONFLICT (id) DO UPDATE SET
      account_id=EXCLUDED.account_id,
      token_ciphertext=EXCLUDED.token_ciphertext,
      token_iv=EXCLUDED.token_iv,
      key_version=1,
      updated_at=now()`;

  return c.json({ ok: true, accountId });
});

cloudflareRoutes.delete("/credential", async c => {
  const sql = neon(c.env.DATABASE_URL);
  await sql`DELETE FROM cloudflare_credentials WHERE id=1`;
  return c.json({ ok: true });
});

cloudflareRoutes.get("/live", async c => {
  try {
    const row = await credential(c);
    if (!row) return c.json({ error: "尚未配置 Cloudflare API Token" }, 409);
    const token = await accessToken(c, row);
    const data = await getCloudflareOverview(token, String(row.account_id));
    return c.json(data, 200, { "Cache-Control": "no-store" });
  } catch (error) {
    return c.json(
      { error: "Cloudflare 实时查询失败：" + safeCloudflareError(error) },
      cloudflareErrorStatus(error),
      { "Cache-Control": "no-store" },
    );
  }
});
