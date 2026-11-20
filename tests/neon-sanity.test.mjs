import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Neon credentials are stored as one encrypted singleton row", () => {
  const migration = readFileSync("migrations/002_neon_credentials.sql", "utf8");
  const routes = readFileSync("src/worker/neon-credentials.ts", "utf8");
  assert.match(migration, /id smallint PRIMARY KEY DEFAULT 1 CHECK \(id = 1\)/);
  assert.match(migration, /token_ciphertext text NOT NULL/);
  assert.match(migration, /token_iv text NOT NULL/);
  assert.match(routes, /encryptToken\(apiKey/);
  assert.match(routes, /decryptToken\(/);
  assert.match(routes, /ON CONFLICT \(id\) DO UPDATE/);
  assert.doesNotMatch(routes, /c\.json\(\{[^}]*apiKey/);
});

test("Neon read endpoints are mounted behind the existing administrator middleware", () => {
  const worker = readFileSync("src/worker/index.ts", "utf8");
  const routes = readFileSync("src/worker/neon-credentials.ts", "utf8");
  assert.match(worker, /requireAdmin\(c,next\)/);
  assert.match(worker, /app\.route\("\/api\/neon",neonRoutes\)/);
  assert.match(routes, /neonRoutes\.get\("\/live"/);
  assert.match(routes, /neonRoutes\.get\("\/projects\/:projectId\/live"/);
});

test("Neon module uses only GET for provider data and never persists usage history", () => {
  const neon = readFileSync("src/worker/neon.ts", "utf8");
  const migration = readFileSync("migrations/002_neon_credentials.sql", "utf8");
  assert.match(neon, /method: "GET"/);
  assert.doesNotMatch(neon, /method: "POST"|method: "PATCH"|method: "DELETE"/);
  assert.doesNotMatch(migration, /usage_history|quota_snapshot|usage_snapshot/i);
});

test("production deployment runs only after a push to main", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(workflow, /github\.event_name == 'push'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
});
