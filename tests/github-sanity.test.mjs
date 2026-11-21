import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("GitHub credentials use one encrypted singleton row and never return the PAT", () => {
  const migration = readFileSync("migrations/004_github_credentials.sql", "utf8");
  const routes = readFileSync("src/worker/github-credentials.ts", "utf8");
  assert.match(migration, /id smallint PRIMARY KEY DEFAULT 1 CHECK \(id = 1\)/);
  assert.match(migration, /token_ciphertext text NOT NULL/);
  assert.match(migration, /token_iv text NOT NULL/);
  assert.match(routes, /encryptToken\(token/);
  assert.match(routes, /decryptToken\(/);
  assert.match(routes, /ON CONFLICT \(id\) DO UPDATE/);
  assert.doesNotMatch(routes, /return c\.json\(\{[^}]*token:/);
});

test("GitHub routes are mounted behind the existing administrator middleware", () => {
  const worker = readFileSync("src/worker/index.ts", "utf8");
  const routes = readFileSync("src/worker/github-credentials.ts", "utf8");
  assert.match(worker, /requireAdmin\(c,next\)/);
  assert.match(worker, /app\.route\("\/api\/github",githubRoutes\)/);
  assert.match(routes, /githubRoutes\.get\("\/live"/);
  assert.match(routes, /githubRoutes\.put\("\/credential"/);
});

test("GitHub provider calls are read-only and do not persist usage history", () => {
  const source = readFileSync("src/worker/github.ts", "utf8");
  const migration = readFileSync("migrations/004_github_credentials.sql", "utf8");
  assert.match(source, /method: "GET"/);
  assert.match(source, /2026-03-10/);
  assert.match(source, /settings\/billing\/usage/);
  assert.doesNotMatch(source, /method: "POST"|method: "PATCH"|method: "DELETE"/);
  assert.doesNotMatch(migration, /usage_history|quota_snapshot|usage_snapshot/i);
});

test("GitHub UI preserves official billing data boundaries", () => {
  const ui = readFileSync("src/web/github.tsx", "utf8");
  assert.match(ui, /\$12/);
  assert.match(ui, /不推算未经证实的剩余额度/);
  assert.match(ui, /增强账单平台/);
  assert.match(ui, /Plan: Read/);
});
