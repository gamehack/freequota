import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("src/worker/supabase-usage.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022},
}).outputText;
const {parseDiskUtil, parseApiCounts, FREE_PLAN_LIMITS} =
  await import("data:text/javascript," + encodeURIComponent(compiled));

test("disk utilization uses only documented fs metrics and does not infer billing usage", () => {
  const v = parseDiskUtil({
    timestamp: "2026-11-20T00:00:00Z",
    metrics: { fs_used_bytes: 2048, fs_size_bytes: 4096, fs_avail_bytes: 2048 },
  });
  assert.equal(v.state, "available");
  assert.equal(v.usedBytes, 2048);
  assert.equal(v.freeBytes, 2048);
  assert.equal(v.capacityBytes, 4096);
  assert.equal(v.sampleAt, "2026-11-20T00:00:00Z");
  assert.equal("remainingQuota" in v, false);
});
test("disk utilization preserves real zero but refuses malformed values", () => {
  assert.equal(parseDiskUtil({metrics:{fs_used_bytes:0}}).usedBytes,0);
  assert.equal(parseDiskUtil({metrics:{fs_used_bytes:"150"}}).state,"unavailable");
  assert.equal(parseDiskUtil({metrics:{fs_used_bytes:-5}}).state,"unavailable");
});
test("API statistics sum documented fields across rows, without creating billing quota", () => {
  const a = parseApiCounts({result:[
    {timestamp:"2026-11-20T10:00:00Z",total_auth_requests:3,total_rest_requests:7,total_storage_requests:0},
    {timestamp:"2026-11-20T11:00:00Z",total_auth_requests:2,total_rest_requests:5},
  ]});
  assert.equal(a.state,"available");
  assert.equal(a.auth,5);
  assert.equal(a.rest,12);
  assert.equal(a.storage,0);
  assert.equal(a.realtime,null);
  assert.equal(a.sampleStart,"2026-11-20T10:00:00Z");
  assert.equal(a.sampleEnd,"2026-11-20T11:00:00Z");
});
test("API missing stats never masquerade as zero", () => {
  assert.equal(parseApiCounts({result:[]}).state,"unavailable");
  assert.equal(parseApiCounts({result:[{}]}).state,"unavailable");
  assert.equal(parseApiCounts({error:"insufficient permissions"}).state,"unavailable");
});
test("Free plan limits have explicit scopes and are reference data only", () => {
  assert.equal(FREE_PLAN_LIMITS.find(x=>x.key==="database").scope,"project");
  assert.equal(FREE_PLAN_LIMITS.find(x=>x.key==="egress").scope,"organization");
  assert.ok(FREE_PLAN_LIMITS.every(x=>x.source.startsWith("https://supabase.com/")));
  assert.ok(FREE_PLAN_LIMITS.every(x=>!Object.hasOwn(x,"used")));
});
