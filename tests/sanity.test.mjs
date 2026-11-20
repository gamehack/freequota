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

test("account mutations report invalid encryption-key configuration distinctly",()=>{
  const accounts=readFileSync("src/worker/accounts.ts","utf8");
  const crypto=readFileSync("src/worker/crypto.ts","utf8");
  assert.match(accounts,/INVALID_ENCRYPTION_KEY/);
  assert.match(accounts,/EncryptionConfigurationError/);
  assert.match(crypto,/bytes.length !== 32/);
  assert.match(crypto,/material.trim\(\)/);
  assert.doesNotMatch(crypto,/console\.log\(.*material/);
});

test("dashboard hides non-billing API counts and Free plan quota sections",()=>{
  const ui=readFileSync("src/web/main.tsx","utf8");
  for(const obsolete of [
    "API 请求统计",
    "Free 官方套餐限额",
    "freePlanLimits.map",
    "免费项目参考上限",
    "supabase.com/dashboard/org/_/usage",
  ]) assert.equal(ui.includes(obsolete),false,`obsolete UI content: ${obsolete}`);
  for(const preserved of ["添加账号","组织及套餐","项目实际运行数据","数据库磁盘（运行指标）"])
    assert.ok(ui.includes(preserved),`missing retained UI: ${preserved}`);
});

test("compact dashboard renders organization, project and disk data without old panels",()=>{
 const ui=readFileSync("src/web/main.tsx","utf8");
 const css=readFileSync("src/web/styles.css","utf8");
 assert.match(ui,/summarizeDashboard\(accounts\.length/);
 assert.match(ui,/hasVisibleIssues\(state\.data\)/);
 assert.match(ui,/role="table"/);
 assert.match(ui,/className="project-line"/);
 assert.match(ui,/数据库磁盘/);
 assert.match(ui,/项目列表/);
 assert.match(css,/\.project-metrics-grid/);
 assert.match(css,/@media\(max-width:440px\)/);
 for(const old of ["API 请求统计","Free 官方套餐限额","免费项目参考上限","部分统计不可用"])
   assert.equal(ui.includes(old),false);
});
