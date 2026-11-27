import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";
import { encryptToken, decryptToken, EncryptionConfigurationError } from "./crypto";
import {
  getInstaboxOverview,
  validateInstaboxApiKey,
  safeInstaboxError,
  instaboxErrorStatus,
} from "./instabox";
import type { AppEnv } from "./types";

export const instaboxRoutes = new Hono<AppEnv>();

type CredentialRow = {
  token_ciphertext: string;
  token_iv: string;
  updated_at: string;
};

async function credential(c: any): Promise<CredentialRow | null> {
  const sql = neon(c.env.DATABASE_URL);
  const rows = await sql`SELECT token_ciphertext,token_iv,updated_at
    FROM instabox_credentials WHERE id=1 LIMIT 1`;
  return rows.length ? rows[0] as CredentialRow : null;
}

instaboxRoutes.get("/status", async c => {
  const row = await credential(c);
  return c.json({
    configured: Boolean(row),
    updatedAt: row ? String(row.updated_at) : null,
  });
});

instaboxRoutes.put("/credential", async c => {
  const body = await c.req.json().catch(() => null);
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  if (!/^ibk_[A-Za-z0-9_-]{10,}$/.test(apiKey) || apiKey.length > 512) {
    return c.json({ error: "InstaBox API Key 格式无效，应以 ibk_ 开头" }, 400);
  }

  try {
    await validateInstaboxApiKey(apiKey);
  } catch (error) {
    return c.json(
      { error: "InstaBox API Key 验证失败：" + safeInstaboxError(error) },
      instaboxErrorStatus(error),
    );
  }

  let encrypted: { ciphertext: string; iv: string };
  try {
    encrypted = await encryptToken(apiKey, c.env.TOKEN_ENCRYPTION_KEY);
  } catch (error) {
    if (error instanceof EncryptionConfigurationError) {
      return c.json({
        error: "服务加密密钥配置错误：请检查 TOKEN_ENCRYPTION_KEY",
        code: "INVALID_ENCRYPTION_KEY",
      }, 503);
    }
    console.error("InstaBox API key encryption error", error instanceof Error ? error.name : "unknown");
    return c.json({ error: "InstaBox API Key 加密失败，请检查 Worker 日志" }, 500);
  }

  const sql = neon(c.env.DATABASE_URL);
  await sql`INSERT INTO instabox_credentials(id,token_ciphertext,token_iv,key_version)
    VALUES(1,${encrypted.ciphertext},${encrypted.iv},1)
    ON CONFLICT (id) DO UPDATE SET
      token_ciphertext=EXCLUDED.token_ciphertext,
      token_iv=EXCLUDED.token_iv,
      key_version=1,
      updated_at=now()`;

  return c.json({ ok: true });
});

instaboxRoutes.delete("/credential", async c => {
  const sql = neon(c.env.DATABASE_URL);
  await sql`DELETE FROM instabox_credentials WHERE id=1`;
  return c.json({ ok: true });
});

instaboxRoutes.get("/live", async c => {
  try {
    const row = await credential(c);
    if (!row) return c.json({ error: "尚未配置 InstaBox API Key" }, 409);
    const token = await decryptToken(
      String(row.token_ciphertext),
      String(row.token_iv),
      c.env.TOKEN_ENCRYPTION_KEY,
    );
    const data = await getInstaboxOverview(token);
    return c.json(data, 200, { "Cache-Control": "no-store" });
  } catch (error) {
    return c.json(
      { error: "InstaBox 实时查询失败：" + safeInstaboxError(error) },
      instaboxErrorStatus(error),
      { "Cache-Control": "no-store" },
    );
  }
});
