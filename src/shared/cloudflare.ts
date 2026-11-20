export const CLOUDFLARE_DEFAULT_ACCOUNT_ID = "ceb5fb8c6f427ea71ca6d4bce7c278f1";

export const CLOUDFLARE_FREE_LIMITS = {
  workersRequestsPerDay: 100_000,
  workersCpuTimeMsPerInvocation: 10,
  d1RowsReadPerDay: 5_000_000,
  d1RowsWrittenPerDay: 100_000,
  d1StorageBytes: 5_000_000_000,
  d1Databases: 10,
  r2StorageBytesPerMonth: 10_000_000_000,
  r2ClassAOperationsPerMonth: 1_000_000,
  r2ClassBOperationsPerMonth: 10_000_000,
  kvReadsPerDay: 100_000,
  kvWritesPerDay: 1_000,
  kvDeletesPerDay: 1_000,
  kvListsPerDay: 1_000,
  kvStorageBytes: 1_000_000_000,
  kvNamespaces: 1_000,
  pagesBuildsPerMonth: 500,
  pagesProjects: 100,
} as const;

export type CloudflareMetricState = "available" | "unavailable" | "error";
export type CloudflareProductState = "available" | "partial" | "error";

export type CloudflareMetric = {
  state: CloudflareMetricState;
  used: number | null;
  quota: number | null;
  unit: string;
  period: string;
  estimated: boolean;
  note: string | null;
  reason: string | null;
};

export function cloudflareMetric(
  used: number,
  quota: number | null,
  unit: string,
  period: string,
  estimated = false,
  note: string | null = null,
): CloudflareMetric {
  if (!Number.isFinite(used) || used < 0) {
    return cloudflareUnavailable("unavailable", "官方接口未返回有效用量", unit, period, quota);
  }
  return { state: "available", used, quota, unit, period, estimated, note, reason: null };
}

export function cloudflareUnavailable(
  state: "unavailable" | "error",
  reason: string,
  unit: string,
  period: string,
  quota: number | null = null,
): CloudflareMetric {
  return { state, used: null, quota, unit, period, estimated: false, note: null, reason };
}

export type CloudflareWorkerItem = {
  name: string;
  requests: number;
  errors: number;
  subrequests: number;
  cpuTimeP50Ms: number | null;
  cpuTimeP99Ms: number | null;
};

export type CloudflareWorkersData = {
  state: CloudflareProductState;
  resourceState: CloudflareProductState;
  resourceReason: string | null;
  count: number | null;
  requests: CloudflareMetric;
  errors: CloudflareMetric;
  subrequests: CloudflareMetric;
  cpuTimeP99Ms: CloudflareMetric;
  items: CloudflareWorkerItem[];
};

export type CloudflareD1DatabaseItem = {
  id: string;
  name: string;
  rowsRead: CloudflareMetric;
  rowsWritten: CloudflareMetric;
  storage: CloudflareMetric;
};

export type CloudflareD1Data = {
  state: CloudflareProductState;
  resourceState: CloudflareProductState;
  resourceReason: string | null;
  databases: CloudflareMetric;
  rowsRead: CloudflareMetric;
  rowsWritten: CloudflareMetric;
  storage: CloudflareMetric;
  items: CloudflareD1DatabaseItem[];
};

export type CloudflareR2BucketItem = {
  name: string;
  classA: CloudflareMetric;
  classB: CloudflareMetric;
  currentStorageBytes: CloudflareMetric;
  objectCount: CloudflareMetric;
  uploadBytes: CloudflareMetric;
  downloadBytes: CloudflareMetric;
  unknownOperations: number;
};

export type CloudflareR2Data = {
  state: CloudflareProductState;
  resourceState: CloudflareProductState;
  resourceReason: string | null;
  buckets: CloudflareMetric;
  classA: CloudflareMetric;
  classB: CloudflareMetric;
  monthlyStorage: CloudflareMetric;
  currentStorageBytes: CloudflareMetric;
  uploadBytes: CloudflareMetric;
  downloadBytes: CloudflareMetric;
  unknownOperations: number;
  items: CloudflareR2BucketItem[];
};

export type CloudflareKvNamespaceItem = {
  id: string;
  title: string;
  read: CloudflareMetric;
  write: CloudflareMetric;
  delete: CloudflareMetric;
  list: CloudflareMetric;
  storageBytes: CloudflareMetric;
  keyCount: CloudflareMetric;
};

export type CloudflareKvData = {
  state: CloudflareProductState;
  resourceState: CloudflareProductState;
  resourceReason: string | null;
  namespaces: CloudflareMetric;
  read: CloudflareMetric;
  write: CloudflareMetric;
  delete: CloudflareMetric;
  list: CloudflareMetric;
  storageBytes: CloudflareMetric;
  items: CloudflareKvNamespaceItem[];
};

export type CloudflarePagesProjectItem = {
  name: string;
  domains: string[];
  deployments: CloudflareMetric;
  checkedPages: number;
  partial: boolean;
  latestDeploymentAt: string | null;
};

export type CloudflarePagesData = {
  state: CloudflareProductState;
  resourceState: CloudflareProductState;
  resourceReason: string | null;
  projects: CloudflareMetric;
  builds: CloudflareMetric;
  items: CloudflarePagesProjectItem[];
};

export type CloudflareDnsZoneItem = {
  id: string;
  name: string;
  records: CloudflareMetric;
};

export type CloudflareDnsData = {
  state: CloudflareProductState;
  resourceState: CloudflareProductState;
  resourceReason: string | null;
  zones: number | null;
  records: CloudflareMetric;
  items: CloudflareDnsZoneItem[];
};

export type CloudflareOverview = {
  accountId: string;
  queriedAt: string;
  dayStart: string;
  monthStart: string;
  partial: boolean;
  warnings: string[];
  workers: CloudflareWorkersData;
  d1: CloudflareD1Data;
  r2: CloudflareR2Data;
  kv: CloudflareKvData;
  pages: CloudflarePagesData;
  dns: CloudflareDnsData;
};

export type CloudflareStatus = {
  configured: boolean;
  accountId: string | null;
  updatedAt: string | null;
};

export function classifyR2Operation(actionType: string): "classA" | "classB" | "unknown" {
  const action = actionType.trim().toLowerCase();
  const classA = new Set([
    "listbuckets", "putbucket", "listobjects", "putobject", "copyobject",
    "completemultipartupload", "createmultipartupload", "lifecyclestoragetransition",
    "listmultipartuploads", "uploadpart", "uploadpartcopy", "listparts",
    "putbucketencryption", "putbucketcors", "putbucketlifecycleconfiguration",
  ]);
  const classB = new Set([
    "headbucket", "headobject", "getobject", "usagesummary", "getbucketencryption",
    "getbucketlocation", "getbucketcors", "getbucketlifecycleconfiguration",
  ]);
  if (classA.has(action)) return "classA";
  if (classB.has(action)) return "classB";
  return "unknown";
}

type Obj = Record<string, unknown>;

function object(value: unknown): Obj | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Obj
    : null;
}

function array(value: unknown): Obj[] {
  return Array.isArray(value)
    ? value.filter((item): item is Obj => !!item && typeof item === "object" && !Array.isArray(item))
    : [];
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

export function computeR2MonthlyAverage(
  buckets: Array<{ name: string; creationDate: string | null }>,
  storageRows: unknown,
  monthStart: string,
  today: string,
  truncated = false,
): { averageBytes: number | null; coverageDays: number; expectedDays: number } {
  const daily = new Map<string, Map<string, number>>();
  for (const row of array(storageRows)) {
    const dimensions = object(row.dimensions);
    const values = object(row.max);
    const bucketName = typeof dimensions?.bucketName === "string" ? dimensions.bucketName : "";
    const timestamp = typeof dimensions?.datetime === "string" ? dimensions.datetime : "";
    const payloadSize = numeric(values?.payloadSize);
    if (!bucketName || !timestamp || payloadSize === null) continue;
    const day = dateOnly(timestamp);
    if (!daily.has(bucketName)) daily.set(bucketName, new Map());
    const bucketDays = daily.get(bucketName)!;
    bucketDays.set(day, Math.max(bucketDays.get(day) ?? 0, payloadSize));
  }

  const start = new Date(dateOnly(monthStart) + "T00:00:00.000Z");
  const end = new Date(dateOnly(today) + "T00:00:00.000Z");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return { averageBytes: null, coverageDays: 0, expectedDays: 0 };
  }

  const days: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end && days.length < 32) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  let totalBytes = 0;
  let coverageDays = 0;
  let complete = !truncated;
  for (const day of days) {
    let dayBytes = 0;
    let dayComplete = true;
    for (const bucket of buckets) {
      const created = bucket.creationDate ? dateOnly(bucket.creationDate) : dateOnly(monthStart);
      if (created > day) continue;
      const value = daily.get(bucket.name)?.get(day);
      if (value === undefined) {
        dayComplete = false;
        complete = false;
      } else {
        dayBytes += value;
      }
    }
    if (dayComplete) coverageDays += 1;
    totalBytes += dayBytes;
  }

  return {
    averageBytes: complete && days.length > 0 ? totalBytes / days.length : null,
    coverageDays,
    expectedDays: days.length,
  };
}
