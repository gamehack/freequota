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
  /** Egress quantity that was priced above the plan's included allowance, not total traffic. */
  egressGiB: number | null;
  ratedUntil: string | null;
  periodStart: string | null;
  periodEnd: string | null;
};

export type InstaboxEgressUsage = {
  source: "usage_machines" | "unavailable";
  bytes: number | null;
  machineCount: number | null;
  machineNames: string[];
  from: string | null;
  countedThrough: string | null;
  reason: string | null;
};

export type InstaboxOverview = {
  queriedAt: string;
  computedAt: string | null;
  workspaceName: string | null;
  plan: string | null;
  machines: InstaboxMetric;
  snapshots: InstaboxMetric;
  storedBytes: InstaboxMetric;
  /** Total month-to-date machine egress from GET /v1/usage/machines. */
  egressGiB: InstaboxMetric;
  egressUsage: InstaboxEgressUsage;
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
  egressGiB: 100,
  startsPerMinute: 3,
} as const;

const GIB_BYTES = 1024 * 1024 * 1024;

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

  const plan = stringValue(root.plan) ??
    stringValue(root.tier) ??
    stringValue(org?.tier) ??
    stringValue(workspace?.tier);

  const effectiveEgressLimit = maxEgressGiB ??
    (plan?.toLowerCase() === "free" ? INSTABOX_FREE_REFERENCE_LIMITS.egressGiB : null);

  const limits: InstaboxLimits = {
    maxMachines,
    maxRunning,
    maxSnapshots,
    maxStoredGiB,
    maxEgressGiB: effectiveEgressLimit,
    maxStartsPerMinute: maxStartsPerMinute ??
      (plan?.toLowerCase() === "free" ? INSTABOX_FREE_REFERENCE_LIMITS.startsPerMinute : null),
  };

  const warnings: string[] = [];
  const machines = metric(machinesUsed, maxMachines, "machines");
  const snapshots = metric(snapshotsUsed, maxSnapshots, "snapshots");
  const storedBytes = metric(
    storedBytesUsed,
    maxStoredGiB === null ? null : maxStoredGiB * GIB_BYTES,
    "storedBytes",
  );
  const egressGiB = metric(null, effectiveEgressLimit, "usage/machines[].egressBytes");
  const egressUsage: InstaboxEgressUsage = {
    source: "unavailable",
    bytes: null,
    machineCount: null,
    machineNames: [],
    from: null,
    countedThrough: null,
    reason: "尚未读取机器级月度 Usage API",
  };

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
    egressGiB: numberValue(rawCost?.egressGiB),
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
    egressUsage,
    limits,
    cost,
    partial: warnings.length > 0,
    warnings,
  };
}

export function parseInstaboxMachineUsage(raw: unknown): InstaboxEgressUsage {
  const root = object(raw);
  if (!root || !Array.isArray(root.machines)) {
    throw new Error("InstaBox machine usage 响应缺少 machines 数组");
  }

  const rows = root.machines;
  const reportedTotal = numberValue(root.total);
  const machineCount = reportedTotal ?? rows.length;
  if (machineCount > rows.length) {
    throw new Error("InstaBox machine usage 分页数据不完整");
  }

  let bytes = 0;
  const machineNames: string[] = [];
  for (const value of rows) {
    const machine = object(value);
    const egressBytes = numberValue(machine?.egressBytes);
    if (egressBytes === null) {
      throw new Error("InstaBox machine usage 未返回有效的 egressBytes");
    }
    bytes += egressBytes;
    const name = stringValue(machine?.name);
    if (name) machineNames.push(name);
  }

  return {
    source: "usage_machines",
    bytes,
    machineCount,
    machineNames,
    from: stringValue(root.from),
    countedThrough: stringValue(root.to),
    reason: null,
  };
}

export function attachInstaboxMachineUsage(
  overview: InstaboxOverview,
  raw: unknown | null,
  error?: string,
): InstaboxOverview {
  const warnings = overview.warnings.filter(warning => !warning.startsWith("本月出口流量"));
  if (raw === null) {
    const reason = error || "机器级月度 Usage API 暂不可用";
    warnings.push("本月出口流量暂不可用：" + reason);
    return {
      ...overview,
      egressGiB: metric(null, overview.limits.maxEgressGiB, "usage/machines[].egressBytes"),
      egressUsage: {
        source: "unavailable",
        bytes: null,
        machineCount: null,
        machineNames: [],
        from: null,
        countedThrough: null,
        reason,
      },
      partial: warnings.length > 0,
      warnings,
    };
  }

  try {
    const usage = parseInstaboxMachineUsage(raw);
    const egressGiB = usage.bytes === null ? null : usage.bytes / GIB_BYTES;
    const egressMetric = metric(egressGiB, overview.limits.maxEgressGiB, "usage/machines[].egressBytes");
    if (egressMetric.state !== "available") warnings.push("本月出口流量暂不可用：" + egressMetric.reason);
    return {
      ...overview,
      egressGiB: egressMetric,
      egressUsage: usage,
      partial: warnings.length > 0,
      warnings,
    };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "机器级 Usage API 数据格式无效";
    warnings.push("本月出口流量暂不可用：" + reason);
    return {
      ...overview,
      egressGiB: metric(null, overview.limits.maxEgressGiB, "usage/machines[].egressBytes"),
      egressUsage: {
        source: "unavailable",
        bytes: null,
        machineCount: null,
        machineNames: [],
        from: null,
        countedThrough: null,
        reason,
      },
      partial: warnings.length > 0,
      warnings,
    };
  }
}
