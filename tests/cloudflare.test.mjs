import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("src/shared/cloudflare.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const {
  CLOUDFLARE_FREE_LIMITS,
  cloudflareMetric,
  cloudflareUnavailable,
  classifyR2Operation,
  computeR2MonthlyAverage,
} = await import("data:text/javascript," + encodeURIComponent(compiled));

test("Cloudflare Free reference quotas preserve their product periods", () => {
  assert.equal(CLOUDFLARE_FREE_LIMITS.workersRequestsPerDay, 100000);
  assert.equal(CLOUDFLARE_FREE_LIMITS.d1RowsReadPerDay, 5000000);
  assert.equal(CLOUDFLARE_FREE_LIMITS.d1RowsWrittenPerDay, 100000);
  assert.equal(CLOUDFLARE_FREE_LIMITS.r2ClassAOperationsPerMonth, 1000000);
  assert.equal(CLOUDFLARE_FREE_LIMITS.r2ClassBOperationsPerMonth, 10000000);
  assert.equal(CLOUDFLARE_FREE_LIMITS.kvReadsPerDay, 100000);
  assert.equal(CLOUDFLARE_FREE_LIMITS.kvWritesPerDay, 1000);
  assert.equal(CLOUDFLARE_FREE_LIMITS.kvDeletesPerDay, 1000);
  assert.equal(CLOUDFLARE_FREE_LIMITS.kvListsPerDay, 1000);
  assert.equal(CLOUDFLARE_FREE_LIMITS.pagesBuildsPerMonth, 500);
});

test("a real zero remains available and missing usage remains unavailable", () => {
  assert.deepEqual(
    cloudflareMetric(0, 100, "次", "每日"),
    { state: "available", used: 0, quota: 100, unit: "次", period: "每日", estimated: false, note: null, reason: null },
  );
  assert.equal(cloudflareUnavailable("unavailable", "没有数据", "次", "每日").used, null);
});

test("R2 operation types map to the documented Class A and Class B categories", () => {
  assert.equal(classifyR2Operation("PutObject"), "classA");
  assert.equal(classifyR2Operation("ListBuckets"), "classA");
  assert.equal(classifyR2Operation("GetObject"), "classB");
  assert.equal(classifyR2Operation("HeadObject"), "classB");
  assert.equal(classifyR2Operation("NewUnknownAction"), "unknown");
});

test("R2 monthly storage average uses daily peaks, not the latest snapshot", () => {
  const buckets = [{ name: "media", creationDate: "2026-11-01T00:00:00Z" }];
  const rows = [
    { dimensions: { bucketName: "media", datetime: "2026-11-01T04:00:00Z" }, max: { payloadSize: 1000000000 } },
    { dimensions: { bucketName: "media", datetime: "2026-11-01T14:00:00Z" }, max: { payloadSize: 2000000000 } },
    { dimensions: { bucketName: "media", datetime: "2026-11-02T04:00:00Z" }, max: { payloadSize: 4000000000 } },
  ];
  const result = computeR2MonthlyAverage(buckets, rows, "2026-11-01", "2026-11-02");
  assert.equal(result.averageBytes, 3000000000);
  assert.equal(result.coverageDays, 2);
  assert.equal(result.expectedDays, 2);
});

test("R2 monthly storage estimate is unavailable when any expected day lacks a sample", () => {
  const buckets = [{ name: "media", creationDate: "2026-11-01T00:00:00Z" }];
  const rows = [
    { dimensions: { bucketName: "media", datetime: "2026-11-01T04:00:00Z" }, max: { payloadSize: 1000000000 } },
  ];
  const result = computeR2MonthlyAverage(buckets, rows, "2026-11-01", "2026-11-02");
  assert.equal(result.averageBytes, null);
  assert.equal(result.coverageDays, 1);
  assert.equal(result.expectedDays, 2);
});

test("R2 monthly storage estimate treats pre-creation days as zero and detects truncated samples", () => {
  const buckets = [{ name: "new", creationDate: "2026-11-02T00:00:00Z" }];
  const rows = [
    { dimensions: { bucketName: "new", datetime: "2026-11-02T04:00:00Z" }, max: { payloadSize: 2000000000 } },
  ];
  const result = computeR2MonthlyAverage(buckets, rows, "2026-11-01", "2026-11-02", true);
  assert.equal(result.averageBytes, null);
  assert.equal(result.coverageDays, 2);
});
