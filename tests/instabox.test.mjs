import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("src/shared/instabox.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { parseInstaboxUsage, INSTABOX_FREE_REFERENCE_LIMITS } =
  await import("data:text/javascript," + encodeURIComponent(compiled));

test("InstaBox Free reference limits match the official Limits table", () => {
  assert.equal(INSTABOX_FREE_REFERENCE_LIMITS.machines, 1);
  assert.equal(INSTABOX_FREE_REFERENCE_LIMITS.running, 1);
  assert.equal(INSTABOX_FREE_REFERENCE_LIMITS.snapshots, 5);
  assert.equal(INSTABOX_FREE_REFERENCE_LIMITS.storedGiB, 200);
  assert.equal(INSTABOX_FREE_REFERENCE_LIMITS.egressGiB, 100);
  assert.equal(INSTABOX_FREE_REFERENCE_LIMITS.startsPerMinute, 3);
});

test("usage parser maps current counts, dynamic limits and hourly-rated cost fields", () => {
  const result = parseInstaboxUsage({
    machines: 1,
    snapshots: 2,
    storedBytes: 6 * 1024 * 1024 * 1024,
    computedAt: "2026-11-27T12:00:00Z",
    plan: "free",
    workspaceName: "personal",
    limits: {
      maxMachines: 1,
      maxRunning: 1,
      maxSnapshots: 5,
      maxStoredGiB: 200,
      maxEgressGiB: 100,
      maxStartsPerMinute: 3,
    },
    cost: {
      costUSD: 0,
      allowanceUSD: 0,
      creditsUSD: 0,
      creditsUsedUSD: 0,
      vcpuHours: 4,
      memGiBHours: 8,
      storageGiBHours: 120,
      egressGiB: 12.5,
      ratedUntil: "2026-11-27T11:00:00Z",
      periodStart: "2026-11-01T00:00:00Z",
      periodEnd: "2026-12-01T00:00:00Z",
    },
  }, "2026-11-27T12:01:00Z");

  assert.equal(result.machines.used, 1);
  assert.equal(result.machines.quota, 1);
  assert.equal(result.snapshots.used, 2);
  assert.equal(result.snapshots.quota, 5);
  assert.equal(result.storedBytes.used, 6 * 1024 * 1024 * 1024);
  assert.equal(result.storedBytes.quota, 200 * 1024 * 1024 * 1024);
  assert.equal(result.egressGiB.used, 12.5);
  assert.equal(result.egressGiB.quota, 100);
  assert.equal(result.cost.costUSD, 0);
  assert.equal(result.cost.ratedUntil, "2026-11-27T11:00:00Z");
  assert.equal(result.workspaceName, "personal");
  assert.equal(result.partial, false);
});

test("real zero is preserved and missing metrics are not converted to zero", () => {
  const zero = parseInstaboxUsage({
    machines: 0,
    snapshots: 0,
    storedBytes: 0,
    plan: "free",
    limits: { maxMachines: 1, maxSnapshots: 5, maxStoredGiB: 200 },
    cost: { costUSD: 0, egressGiB: 0, ratedUntil: "2026-11-27T11:00:00Z" },
  });

  assert.equal(zero.machines.used, 0);
  assert.equal(zero.snapshots.used, 0);
  assert.equal(zero.storedBytes.used, 0);
  assert.equal(zero.egressGiB.used, 0);

  const missing = parseInstaboxUsage({ limits: {}, cost: {} });
  assert.equal(missing.machines.state, "unavailable");
  assert.equal(missing.machines.used, null);
  assert.equal(missing.snapshots.state, "unavailable");
  assert.equal(missing.storedBytes.state, "unavailable");
  assert.equal(missing.egressGiB.state, "unavailable");
  assert.equal(missing.partial, true);
});

test("dynamic egress limit overrides the static Free reference limit", () => {
  const result = parseInstaboxUsage({
    machines: 1,
    snapshots: 1,
    storedBytes: 1,
    plan: "free",
    limits: { maxMachines: 1, maxSnapshots: 5, maxStoredGiB: 200, maxEgressGiB: 80 },
    cost: { egressGiB: 10, ratedUntil: "2026-11-27T11:00:00Z" },
  });
  assert.equal(result.egressGiB.quota, 80);
});
