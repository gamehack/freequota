import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("src/shared/instabox.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const {
  parseInstaboxUsage,
  parseInstaboxMachineUsage,
  attachInstaboxMachineUsage,
  INSTABOX_FREE_REFERENCE_LIMITS,
} = await import("data:text/javascript," + encodeURIComponent(compiled));

const baseUsage = () => parseInstaboxUsage({
  machines: 1,
  snapshots: 0,
  storedBytes: 0,
  plan: "free",
  workspaceName: "personal",
  limits: { maxMachines: 1, maxRunning: 1, maxSnapshots: 5, maxStoredGiB: 200, maxEgressGiB: 100 },
  cost: { costUSD: 0, egressGiB: 0, ratedUntil: "2026-11-28T00:00:00Z" },
});

test("InstaBox Free reference limits match the official Limits table", () => {
  assert.equal(INSTABOX_FREE_REFERENCE_LIMITS.machines, 1);
  assert.equal(INSTABOX_FREE_REFERENCE_LIMITS.running, 1);
  assert.equal(INSTABOX_FREE_REFERENCE_LIMITS.snapshots, 5);
  assert.equal(INSTABOX_FREE_REFERENCE_LIMITS.storedGiB, 200);
  assert.equal(INSTABOX_FREE_REFERENCE_LIMITS.egressGiB, 100);
  assert.equal(INSTABOX_FREE_REFERENCE_LIMITS.startsPerMinute, 3);
});

test("usage parser keeps billable egress separate from total machine egress", () => {
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
      egressGiB: 0,
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
  assert.equal(result.cost.costUSD, 0);
  assert.equal(result.cost.egressGiB, 0);
  assert.equal(result.egressGiB.used, null);
  assert.equal(result.workspaceName, "personal");
});

test("machine usage egressBytes is the actual monthly traffic, including free machines", () => {
  const machineUsage = {
    from: "2026-11-01T00:00:00.000Z",
    to: "2026-11-28T00:00:00.000Z",
    total: 1,
    machines: [{
      id: "m_test",
      name: "instabox-qjai-dsh-01",
      free: true,
      runningSeconds: 3600,
      vcpuSeconds: 14400,
      memGiBSeconds: 28800,
      computeUSD: 0,
      diskGiBSeconds: 1728000,
      diskUSD: 0,
      egressBytes: 1073741824,
      egressUSD: 0,
    }],
  };

  const parsed = parseInstaboxMachineUsage(machineUsage);
  assert.equal(parsed.bytes, 1073741824);
  assert.equal(parsed.machineCount, 1);
  assert.deepEqual(parsed.machineNames, ["instabox-qjai-dsh-01"]);
  assert.equal(parsed.from, "2026-11-01T00:00:00.000Z");
  assert.equal(parsed.countedThrough, "2026-11-28T00:00:00.000Z");

  const overview = attachInstaboxMachineUsage(baseUsage(), machineUsage);
  assert.equal(overview.egressGiB.used, 1);
  assert.equal(overview.egressGiB.quota, 100);
  assert.equal(overview.egressUsage.source, "usage_machines");
  assert.equal(overview.egressUsage.bytes, 1073741824);
  assert.equal(overview.cost.egressGiB, 0);
});

test("machine usage aggregates rows and preserves an actual zero", () => {
  const combined = attachInstaboxMachineUsage(baseUsage(), {
    from: "2026-11-01T00:00:00Z",
    to: "2026-11-28T00:00:00Z",
    total: 2,
    machines: [
      { id: "m_old", name: "old", egressBytes: 1024 },
      { id: "m_current", name: "current", egressBytes: 2048 },
    ],
  });
  assert.equal(combined.egressGiB.used, 3072 / (1024 ** 3));

  const zero = attachInstaboxMachineUsage(baseUsage(), {
    from: "2026-11-01T00:00:00Z",
    to: "2026-11-28T00:00:00Z",
    total: 0,
    machines: [],
  });
  assert.equal(zero.egressGiB.used, 0);
  assert.equal(zero.egressGiB.state, "available");
});

test("machine usage never turns missing or incomplete egress into zero", () => {
  const missing = attachInstaboxMachineUsage(baseUsage(), {
    total: 1,
    machines: [{ id: "m_missing", name: "missing" }],
  });
  assert.equal(missing.egressGiB.state, "unavailable");
  assert.equal(missing.egressGiB.used, null);
  assert.match(missing.egressUsage.reason, /egressBytes/);

  const incomplete = attachInstaboxMachineUsage(baseUsage(), {
    total: 2,
    machines: [{ id: "m_1", egressBytes: 1 }],
  });
  assert.equal(incomplete.egressGiB.state, "unavailable");
  assert.match(incomplete.egressUsage.reason, /分页数据不完整/);
});

test("Free plan uses the documented egress cap when dynamic limits are omitted", () => {
  const overview = parseInstaboxUsage({
    machines: 1,
    snapshots: 0,
    storedBytes: 0,
    plan: "free",
    limits: { maxMachines: 1, maxSnapshots: 5, maxStoredGiB: 200 },
    cost: { egressGiB: 0, ratedUntil: "2026-11-27T11:00:00Z" },
  });
  assert.equal(overview.limits.maxEgressGiB, 100);
  assert.equal(overview.egressGiB.quota, 100);
});
