import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("src/shared/neon.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const {
  NEON_FREE_LIMITS,
  isFreeNeonPlan,
  parseProjectMetrics,
  parseBranchMetrics,
} = await import("data:text/javascript," + encodeURIComponent(compiled));

test("Neon Free plan limits use documented scopes and decimal GB units", () => {
  assert.equal(NEON_FREE_LIMITS.projectsPerOrganization, 100);
  assert.equal(NEON_FREE_LIMITS.computeCuHoursPerProject, 100);
  assert.equal(NEON_FREE_LIMITS.postgresStorageBytesPerProject, 1_000_000_000);
  assert.equal(NEON_FREE_LIMITS.postgresStorageBytesPerOrganization, 20_000_000_000);
  assert.equal(NEON_FREE_LIMITS.publicTransferBytesPerProject, 5_000_000_000);
  assert.equal(NEON_FREE_LIMITS.branchesPerProject, 10);
  assert.equal(isFreeNeonPlan("free"), true);
  assert.equal(isFreeNeonPlan("free_v2"), true);
  assert.equal(isFreeNeonPlan("launch"), false);
  assert.equal(isFreeNeonPlan(null), false);
});

test("project snapshot converts compute seconds to CU-hours and preserves transfer bytes", () => {
  const result = parseProjectMetrics({
    project: {
      compute_time_seconds: 7200,
      data_transfer_bytes: 2_500_000,
      consumption_period_start: "2026-11-01T00:00:00Z",
      consumption_period_end: "2026-12-01T00:00:00Z",
      compute_last_active_at: "2026-11-20T12:00:00Z",
    },
  });
  assert.deepEqual(result.compute, { state: "available", used: 2, reason: null });
  assert.deepEqual(result.transfer, { state: "available", used: 2_500_000, reason: null });
  assert.equal(result.periodStart, "2026-11-01T00:00:00Z");
  assert.equal(result.periodEnd, "2026-12-01T00:00:00Z");
});

test("project metrics preserve actual zero and never invent missing zero", () => {
  const zero = parseProjectMetrics({ project: { compute_time_seconds: 0, data_transfer_bytes: 0 } });
  assert.equal(zero.compute.used, 0);
  assert.equal(zero.transfer.used, 0);
  const missing = parseProjectMetrics({ project: {} });
  assert.equal(missing.compute.state, "unavailable");
  assert.equal(missing.compute.used, null);
  assert.equal(missing.transfer.state, "unavailable");
});

test("branch storage sums logical_size across all branches", () => {
  const result = parseBranchMetrics({
    branches: [
      { id: "br-main", name: "main", logical_size: 100, default: true, current_state: "ready" },
      { id: "br-dev", name: "dev", logical_size: 250, default: false, current_state: "ready" },
    ],
  });
  assert.deepEqual(result.storage, { state: "available", used: 350, reason: null });
  assert.deepEqual(result.branches, { state: "available", used: 2, reason: null });
  assert.equal(result.branchItems[0].isDefault, true);
});

test("empty branch list is a real zero; missing logical_size is not", () => {
  assert.deepEqual(parseBranchMetrics({ branches: [] }).storage, {
    state: "available", used: 0, reason: null,
  });
  const missing = parseBranchMetrics({ branches: [{ id: "br-main" }, { id: "br-dev", logical_size: 5 }] });
  assert.equal(missing.branches.used, 2);
  assert.equal(missing.storage.state, "unavailable");
  assert.equal(missing.storage.used, null);
});

test("invalid or absent branch list does not masquerade as zero", () => {
  assert.equal(parseBranchMetrics({}).branches.state, "unavailable");
  assert.equal(parseBranchMetrics({ branches: "not-an-array" }).storage.state, "unavailable");
});
