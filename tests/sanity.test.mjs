import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
test("no cron scheduler or usage snapshots in initial deployment",()=>{
  const cf=readFileSync("cloudflare.config.ts","utf8");
  const schema=readFileSync("migrations/001_initial.sql","utf8");
  assert.doesNotMatch(cf,/triggers\s*:/);
  assert.doesNotMatch(schema,/quota_snapshots/);
});
test("API routes are authenticated and secrets are never returned in account listing",()=>{
  const routes=readFileSync("src/worker/accounts.ts","utf8");
  const worker=readFileSync("src/worker/index.ts","utf8");
  assert.match(worker,/requireAdmin\(c,next\)/);
  assert.match(routes,/SELECT id,alias,remark,created_at,updated_at/);
  assert.doesNotMatch(routes,/SELECT \* FROM supabase_accounts/);
});

test("bcrypt verification compares hash to hash, not plaintext to hash",()=>{
  const auth=readFileSync("src/worker/auth.ts","utf8");
  assert.match(auth,/\$\{u\.password_hash\}\s*=\s*crypt\(\$\{password\},\s*\$\{u\.password_hash\}\)/);
  assert.match(auth,/password_hash\s*=\s*crypt\(\$\{old\},\s*password_hash\)/);
  assert.doesNotMatch(auth,/\$\{password\}\s*=\s*crypt\(\$\{password\},/);
  assert.doesNotMatch(auth,/\$\{old\}\s*=\s*crypt\(\$\{old\},/);
});
