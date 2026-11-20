export type NeonMetricState = "available" | "unavailable" | "error" | "skipped";

export type NeonMetric = {
  state: NeonMetricState;
  used: number | null;
  reason: string | null;
};

export type NeonBranch = {
  id: string;
  name: string;
  currentState: string;
  isDefault: boolean;
  logicalSizeBytes: number | null;
};

export type NeonProjectSummary = {
  id: string;
  name: string;
  orgId: string;
  region: string;
  pgVersion: number | null;
  createdAt: string | null;
};

export type NeonOrganization = {
  id: string;
  name: string;
  handle: string;
  plan: string | null;
  projects: NeonProjectSummary[];
  projectCount: number;
  projectListComplete: boolean;
  warning: string | null;
};

export type NeonOverview = {
  queriedAt: string;
  organizations: NeonOrganization[];
  projectCount: number;
  partial: boolean;
  warnings: string[];
};

export type NeonProjectLive = {
  projectId: string;
  compute: NeonMetric;
  transfer: NeonMetric;
  storage: NeonMetric;
  branches: NeonMetric;
  branchItems: NeonBranch[];
  periodStart: string | null;
  periodEnd: string | null;
  lastComputeActiveAt: string | null;
};

export type NeonStatus = {
  configured: boolean;
  updatedAt: string | null;
};

export const NEON_FREE_LIMITS = {
  projectsPerOrganization: 100,
  computeCuHoursPerProject: 100,
  postgresStorageBytesPerProject: 1_000_000_000,
  postgresStorageBytesPerOrganization: 20_000_000_000,
  publicTransferBytesPerProject: 5_000_000_000,
  branchesPerProject: 10,
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
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function emptyNeonMetric(
  state: NeonMetricState,
  reason: string,
): NeonMetric {
  return { state, used: null, reason };
}

function availableMetric(value: unknown, divisor = 1, missingReason: string): NeonMetric {
  const number = numberValue(value);
  if (number === null) return emptyNeonMetric("unavailable", missingReason);
  return { state: "available", used: number / divisor, reason: null };
}

export function parseProjectMetrics(raw: unknown): {
  compute: NeonMetric;
  transfer: NeonMetric;
  periodStart: string | null;
  periodEnd: string | null;
  lastComputeActiveAt: string | null;
} {
  const root = object(raw);
  const project = object(root?.project) ?? root;
  if (!project) {
    return {
      compute: emptyNeonMetric("unavailable", "Neon 项目接口未返回项目数据"),
      transfer: emptyNeonMetric("unavailable", "Neon 项目接口未返回项目数据"),
      periodStart: null,
      periodEnd: null,
      lastComputeActiveAt: null,
    };
  }
  return {
    compute: availableMetric(
      project.compute_time_seconds,
      3600,
      "官方接口未返回 compute_time_seconds",
    ),
    transfer: availableMetric(
      project.data_transfer_bytes,
      1,
      "官方接口未返回 data_transfer_bytes",
    ),
    periodStart: stringValue(project.consumption_period_start),
    periodEnd: stringValue(project.consumption_period_end),
    lastComputeActiveAt: stringValue(project.compute_last_active_at),
  };
}

export function parseBranchMetrics(raw: unknown): {
  storage: NeonMetric;
  branches: NeonMetric;
  branchItems: NeonBranch[];
} {
  const root = object(raw);
  const source = root?.branches;
  if (!Array.isArray(source)) {
    const unavailable = emptyNeonMetric("unavailable", "官方接口未返回分支列表");
    return { storage: unavailable, branches: unavailable, branchItems: [] };
  }

  const branchItems = source.map((value): NeonBranch => {
    const branch = object(value) ?? {};
    return {
      id: stringValue(branch.id) ?? "",
      name: stringValue(branch.name) ?? stringValue(branch.id) ?? "未命名分支",
      currentState: stringValue(branch.current_state) ?? "unknown",
      isDefault: branch.default === true,
      logicalSizeBytes: numberValue(branch.logical_size),
    };
  });

  const branches: NeonMetric = {
    state: "available",
    used: branchItems.length,
    reason: null,
  };

  if (branchItems.length === 0) {
    return {
      storage: { state: "available", used: 0, reason: null },
      branches,
      branchItems,
    };
  }

  if (branchItems.some(branch => branch.logicalSizeBytes === null)) {
    return {
      storage: emptyNeonMetric(
        "unavailable",
        "至少一个 Branch 未返回 logical_size，不能计算项目总存储",
      ),
      branches,
      branchItems,
    };
  }

  const totalBytes = branchItems.reduce(
    (sum, branch) => sum + (branch.logicalSizeBytes ?? 0),
    0,
  );
  return {
    storage: { state: "available", used: totalBytes, reason: null },
    branches,
    branchItems,
  };
}

export function isFreeNeonPlan(plan: string | null | undefined): boolean {
  return typeof plan === "string" && plan.trim().toLowerCase().startsWith("free");
}
