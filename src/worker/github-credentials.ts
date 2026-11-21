import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";
import { encryptToken, decryptToken, EncryptionConfigurationError } from "./crypto";
import { getGitHubOverview, validateGitHubToken, safeGitHubError, githubErrorStatus } from "./github";
import type { AppEnv } from "./types";

export const githubRoutes = new Hono<AppEnv>();

type CredentialRow = {
  username: string;
  token_ciphertext: string;
  token_iv: string;
  updated_at: string;
};

async function credential(c: any): Promise<CredentialRow | null> {
  const sql = neon(c.env.DATABASE_URL);
  const rows = await sql\`SELECT username,token_ciphertext,token_iv,updated_at
    FROM github_credentials WHERE id=1 LIMIT 1\`;
  return rows.length ? rows[0] as CredentialRow : null;
}

githubRoutes.get("/status", async c => {
  const row = await credential(c);
  return c.json({
    configured: Boolean(row),
    username: row ? String(row.username) : null,
    updatedAt: row ? String(row.updated_at) : null,
  });
});

githubRoutes.put("/credential", async c => {
  const body = await c.req.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(username)) {
    return c.json({ error: "GitHub 用户名格式无效" }, 400);
  }
  if (token.length < 20 || token.length > 512) {
    return c.json({ error: "GitHub Fine-grained PAT 格式无效" }, 400);
  }

  try {
    await validateGitHubToken(token, username);
  } catch (error) {
    return c.json(
      { error: "GitHub Token 验证失败：" + safeGitHubError(error) },
      githubErrorStatus(error),
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
    console.error("GitHub PAT encryption error", error instanceof Error ? error.name : "unknown");
    return c.json({ error: "GitHub Token 加密失败，请检查 Worker 日志" }, 500);
  }

  const sql = neon(c.env.DATABASE_URL);
  await sql\`INSERT INTO github_credentials(id,username,token_ciphertext,token_iv,key_version)
    VALUES(1,\${username},\${encrypted.ciphertext},\${encrypted.iv},1)
    ON CONFLICT (id) DO UPDATE SET
      username=EXCLUDED.username,
      token_ciphertext=EXCLUDED.token_ciphertext,
      token_iv=EXCLUDED.token_iv,
      key_version=1,
      updated_at=now()\`;

  return c.json({ ok: true, username });
});

githubRoutes.delete("/credential", async c => {
  const sql = neon(c.env.DATABASE_URL);
  await sql\`DELETE FROM github_credentials WHERE id=1\`;
  return c.json({ ok: true });
});

githubRoutes.get("/live", async c => {
  try {
    const row = await credential(c);
    if (!row) return c.json({ error: "尚未配置 GitHub Fine-grained PAT" }, 409);
    const token = await decryptToken(
      String(row.token_ciphertext),
      String(row.token_iv),
      c.env.TOKEN_ENCRYPTION_KEY,
    );
    const data = await getGitHubOverview(token, String(row.username));
    return c.json(data, 200, { "Cache-Control": "no-store" });
  } catch (error) {
    return c.json(
      { error: "GitHub 实时查询失败：" + safeGitHubError(error) },
      githubErrorStatus(error),
      { "Cache-Control": "no-store" },
    );
  }
});
