import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync("src/shared/github.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const {
  GITHUB_FREE_LIMITS,
  parseGitHubUsageItems,
  aggregateGitHubProducts,
  aggregateGitHubRepositories,
} = await import("data:text/javascript," + encodeURIComponent(compiled));

test("GitHub Free reference quotas match the current included usage table", () => {
  assert.equal(GITHUB_FREE_LIMITS.includedComputeUsd, 12);
  assert.equal(GITHUB_FREE_LIMITS.actionsAndPackagesStorageBytes, 500 * 1024 * 1024);
  assert.equal(GITHUB_FREE_LIMITS.actionsCachePerRepositoryBytes, 10 * 1024 * 1024 * 1024);
  assert.equal(GITHUB_FREE_LIMITS.codespacesCoreHours, 120);
  assert.equal(GITHUB_FREE_LIMITS.codespacesStorageGb, 15);
  assert.equal(GITHUB_FREE_LIMITS.packagesBandwidthGb, 1);
  assert.equal(GITHUB_FREE_LIMITS.gitLfsStorageGb, 10);
  assert.equal(GITHUB_FREE_LIMITS.gitLfsBandwidthGb, 10);
});

test("billing items preserve missing values instead of converting them to zero", () => {
  const items = parseGitHubUsageItems([
    { product: "Actions", sku: "actions_linux", quantity: 100, grossAmount: 0.6, discountAmount: 0.6, netAmount: 0 },
    { product: "Actions", sku: "actions_windows", quantity: 20, grossAmount: 0.32, discountAmount: 0.32, netAmount: 0 },
    { product: "Packages", sku: "storage", quantity: 1, grossAmount: 0.1 },
  ]);
  assert.equal(items[2].discountAmount, null);
  const products = aggregateGitHubProducts(items);
  const actions = products.find(item => item.product === "Actions");
  const packages = products.find(item => item.product === "Packages");
  assert.equal(actions.grossAmount, 0.92);
  assert.equal(actions.discountAmount, 0.92);
  assert.equal(actions.netAmount, 0);
  assert.equal(packages.discountAmount, null);
});

test("repository aggregation includes Actions only and groups records by repository", () => {
  const items = parseGitHubUsageItems([
    { product: "Actions", sku: "actions_linux", repositoryName: "gamehack/a", grossAmount: 1, discountAmount: 1, netAmount: 0 },
    { product: "Actions", sku: "actions_windows", repositoryName: "gamehack/a", grossAmount: 2, discountAmount: 1, netAmount: 1 },
    { product: "Actions", sku: "actions_linux", repositoryName: "gamehack/b", grossAmount: 0.5, discountAmount: 0.5, netAmount: 0 },
    { product: "Packages", sku: "storage", repositoryName: "gamehack/a", grossAmount: 3, discountAmount: 0, netAmount: 3 },
  ]);
  const repos = aggregateGitHubRepositories(items);
  assert.equal(repos.length, 2);
  assert.equal(repos[0].repositoryName, "gamehack/a");
  assert.equal(repos[0].grossAmount, 3);
  assert.equal(repos[0].netAmount, 1);
  assert.deepEqual(repos[0].skus, ["actions_linux", "actions_windows"]);
});
