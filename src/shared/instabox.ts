export type InstaboxMetric = {
  state: "available" | "unavailable";
  used: number | null;
  quota: number | null;
  reason: string | null;
};

export type InstaboxLimits = {
  maxMachines: number | null;
  maxRunning: number | null;
  maxSnapshots: number | null;
  maxStoredGiB: number | null;
  maxEgressGiB: number | null;
  maxStartsPerMinute: number | null;
};

export type InstaboxCost = {
  costUSD: number | null;
  allowanceUSD: number | null;
  creditRemainingUSD: number | null;
  creditsUSD: number | null;
  creditsUsedUSD: number | null;
  overageUSD: number | null;
  chargedUSD: number | null;
  vcpuHours: number | null;
  memGiBHours: number | null;
  storageGiBHours: number | null;
  egressGiB: number | null;
  ratedUntil: string | null;
  periodStart: string | null;
  periodEnd: string | null;
};

export type InstaboxOverview = {
  queriedAt: string;
  computedAt: string | null;
  workspaceName: string | null;
  plan: string | null;
  machines: InstaboxMetric;
  snapshots: InstaboxMetric;
  storedBytes: InstaboxMetric;
  egressGiB: InstaboxMetric;
  limits: InstaboxLimits;
  cost: InstaboxCost;
  partial: boolean;
  warnings: string[];
};

export type InstaboxStatus = {
  configured: boolean;
  updatedAt: string | null;
};

export const INSTABOX_FREE_REFERENCE_LIMITS = {
  machines: 1,
  running: 1,
  snapshots: 5,
  storedGiB: 200,
} as const;

type Obj = Record<string, unknown>;

function object(value: unknown): Obj | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Obj
    : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function firstNumber(source: Obj | null, keys: string[]): number | null {
  if (!source) return null;
  for (const key of keys) {
    const value = numberValue(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function metric(used: number | null, quota: number | null, label: string): InstaboxMetric {
  if (used === null) {
    return { state: "unavailable", used: null, quota, reason: "官方 Usage API 未返回 " + label };
  }
  return { state: "available", used, quota, reason: null };
}

export function parseInstaboxUsage(raw: unknown, queriedAt = new Date().toISOString()): InstaboxOverview {
  const root = object(raw);
  if (!root) throw new Error("InstaBox Usage API 返回了无效 JSON 对象");

  const rawLimits = object(root.limits);
  const rawCost = object(root.cost);
  const org = object(root.org);
  const workspace = object(root.workspace);
  const maxMachines = firstNumber(rawLimits, ["maxMachines"]);
  const maxSnapshots = firstNumber(rawLimits, ["maxSnapshots"]);
  const maxStoredGiB = firstNumber(rawLimits, ["maxStoredGiB"]);
  const maxEgressGiB = firstNumber(rawLimits, ["maxEgressGiB", "egressGiB", "monthlyEgressGiB"]);
  const maxRunning = firstNumber(rawLimits, ["maxRunning"]);
  const maxStartsPerMinute = firstNumber(rawLimits, ["maxStartsPerMinute", "startsPerMinute"]);

  const machinesUsed = numberValue(root.machines);
  const snapshotsUsed = numberValue(root.snapshots);
  const storedBytesUsed = numberValue(root.storedBytes);
  const egressUsed = numberValue(rawCost?.egressGiB);

  const plan = stringValue(root.plan) ??
    stringValue(root.tier) ??
    stringValue(org?.tier) ??
    stringValue(workspace?.tier);

  // Never infer a monthly egress quota from the plan name. Only show a cap
  // when the official Usage API actually returns one in limits.

  const limits: InstaboxLimits = {
    maxMachines,
    maxRunning,
    maxSnapshots,
    maxStoredGiB,
    maxEgressGiB,
    maxStartsPerMinute,
  };

  const warnings: string[] = [];
  const machines = metric(machinesUsed, maxMachines, "machines");
  const snapshots = metric(snapshotsUsed, maxSnapshots, "snapshots");
  const storedBytes = metric(
    storedBytesUsed,
    maxStoredGiB === null ? null : maxStoredGiB * 1024 * 1024 * 1024,
    "storedBytes",
  );
  const egressGiB = metric(egressUsed, maxEgressGiB, "cost.egressGiB");

  for (const [name, value] of [
    ["机器数量", machines],
    ["Snapshot 数量", snapshots],
    ["存储占用", storedBytes],
    ["本月出口流量", egressGiB],
  ] as const) {
    if (value.state !== "available") warnings.push(name + "暂不可用：" + value.reason);
  }
  if (!rawLimits) warnings.push("官方 API 未返回 limits 对象，无法确认动态套餐上限。");
  if (rawCost?.ratedUntil === undefined) warnings.push("官方 API 未返回 ratedUntil，无法确认账单计量数据的更新时间。");

  const cost: InstaboxCost = {
    costUSD: numberValue(rawCost?.costUSD),
    allowanceUSD: numberValue(rawCost?.allowanceUSD),
    creditRemainingUSD: numberValue(rawCost?.creditRemainingUSD),
    creditsUSD: numberValue(rawCost?.creditsUSD),
    creditsUsedUSD: numberValue(rawCost?.creditsUsedUSD),
    overageUSD: numberValue(rawCost?.overageUSD),
    chargedUSD: numberValue(rawCost?.chargedUSD),
    vcpuHours: numberValue(rawCost?.vcpuHours),
    memGiBHours: numberValue(rawCost?.memGiBHours),
    storageGiBHours: numberValue(rawCost?.storageGiBHours),
    egressGiB: egressUsed,
    ratedUntil: stringValue(rawCost?.ratedUntil),
    periodStart: stringValue(rawCost?.periodStart),
    periodEnd: stringValue(rawCost?.periodEnd),
  };

  return {
    queriedAt,
    computedAt: stringValue(root.computedAt),
    workspaceName: stringValue(root.workspaceName) ?? stringValue(org?.name) ?? stringValue(workspace?.name),
    plan,
    machines,
    snapshots,
    storedBytes,
    egressGiB,
    limits,
    cost,
    partial: warnings.length > 0,
    warnings,
  };
}
