import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";
import { encryptToken, decryptToken, EncryptionConfigurationError } from "./crypto";
import {
  getNeonOverview,
  getNeonProjectLive,
  listNeonOrganizations,
  neonErrorStatus,
  safeNeonError,
} from "./neon";
import type { AppEnv } from "./types";

export const neonRoutes = new Hono<AppEnv>();

type CredentialRow = {
  token_ciphertext: string;
  token_iv: string;
  updated_at: string;
};

async function credential(c: any): Promise<CredentialRow | null> {
  const sql = neon(c.env.DATABASE_URL);
  const rows = await sql`SELECT token_ciphertext,token_iv,updated_at
    FROM neon_credentials WHERE id=1 LIMIT 1`;
  return rows.length ? rows[0] as CredentialRow : null;
}

async function accessToken(c: any): Promise<string | null> {
  const row = await credential(c);
  if (!row) return null;
  return decryptToken(
    String(row.token_ciphertext),
    String(row.token_iv),
    c.env.TOKEN_ENCRYPTION_KEY,
  );
}

neonRoutes.get("/status", async c => {
  const row = await credential(c);
  return c.json({
    configured: Boolean(row),
    updatedAt: row ? String(row.updated_at) : null,
  });
});

neonRoutes.put("/credential", async c => {
  const body = await c.req.json().catch(() => null);
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  if (apiKey.length < 10 || apiKey.length > 512) {
    return c.json({ error: "Neon API Key 格式无效" }, 400);
  }

  let organizations;
  try {
    organizations = await listNeonOrganizations(apiKey);
  } catch (error) {
    return c.json(
      { error: "Neon API Key 验证失败：" + safeNeonError(error) },
      neonErrorStatus(error),
    );
  }
  if (!organizations.length) {
    return c.json({ error: "该 API Key 没有可访问的 Neon Organization" }, 422);
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
    console.error("Neon API key encryption error", error instanceof Error ? error.name : "unknown");
    return c.json({ error: "Neon API Key 加密失败，请检查 Worker 日志" }, 500);
  }

  const sql = neon(c.env.DATABASE_URL);
  await sql`INSERT INTO neon_credentials(id,token_ciphertext,token_iv,key_version)
    VALUES(1,${encrypted.ciphertext},${encrypted.iv},1)
    ON CONFLICT (id) DO UPDATE SET
      token_ciphertext=EXCLUDED.token_ciphertext,
      token_iv=EXCLUDED.token_iv,
      key_version=1,
      updated_at=now()`;

  return c.json({ ok: true, organizationCount: organizations.length });
});

neonRoutes.delete("/credential", async c => {
  const sql = neon(c.env.DATABASE_URL);
  await sql`DELETE FROM neon_credentials WHERE id=1`;
  return c.json({ ok: true });
});

neonRoutes.get("/live", async c => {
  try {
    const token = await accessToken(c);
    if (!token) return c.json({ error: "尚未配置 Neon API Key" }, 409);
    const data = await getNeonOverview(token);
    return c.json(data, 200, { "Cache-Control": "no-store" });
  } catch (error) {
    return c.json(
      { error: "Neon 实时查询失败：" + safeNeonError(error) },
      neonErrorStatus(error),
      { "Cache-Control": "no-store" },
    );
  }
});

neonRoutes.get("/projects/:projectId/live", async c => {
  const projectId = c.req.param("projectId");
  if (!/^[a-z0-9-]{1,60}$/i.test(projectId)) {
    return c.json({ error: "无效 Neon Project ID" }, 400);
  }
  try {
    const token = await accessToken(c);
    if (!token) return c.json({ error: "尚未配置 Neon API Key" }, 409);
    const data = await getNeonProjectLive(token, projectId);
    return c.json(data, 200, { "Cache-Control": "no-store" });
  } catch (error) {
    return c.json(
      { error: "Neon 项目查询失败：" + safeNeonError(error) },
      neonErrorStatus(error),
      { "Cache-Control": "no-store" },
    );
  }
});
