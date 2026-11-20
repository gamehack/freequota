import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Cloudflare routes are behind the existing administrator middleware", () => {
  const worker = readFileSync("src/worker/index.ts", "utf8");
  const routes = readFileSync("src/worker/cloudflare-credentials.ts", "utf8");
  assert.match(worker, /requireAdmin\(c,next\)/);
  assert.match(worker, /app\.route\("\/api\/cloudflare",cloudflareRoutes\)/);
  assert.match(routes, /encryptToken/);
  assert.match(routes, /decryptToken/);
  assert.match(routes, /cloudflare_credentials/);
  assert.doesNotMatch(routes, /return c\.json\(\{[^}]*token:/);
});

test("Cloudflare REST integration uses read-only GET and GraphQL query POST only", () => {
  const source = readFileSync("src/worker/cloudflare.ts", "utf8");
  assert.match(source, /method: "GET"/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /pages\/projects", 10, 4/);
  assert.match(source, /"account\.id": accountId/);
  assert.doesNotMatch(source, /method: "DELETE"/);
  assert.doesNotMatch(source, /method: "PUT"/);
  assert.doesNotMatch(source, /method: "PATCH"/);
});

test("Cloudflare dashboard labels estimates and keeps missing values distinct from zero", () => {
  const ui = readFileSync("src/web/cloudflare.tsx", "utf8");
  assert.match(ui, /Cloudflare 免费额度/);
  assert.match(ui, /非跳过 Deployment/);
  assert.match(ui, /estimated/);
  assert.match(ui, /缺失数据不会按 0 处理/);
  assert.match(ui, /Token 不会回显/);
});
