// Supabase Management API data contracts; values are never treated as billing usage.
export type MetricState = "available" | "unavailable" | "error" | "skipped";

export type DiskUsage = {
  state: MetricState;
  usedBytes: number | null;
  freeBytes: number | null;
  capacityBytes: number | null;
  sampleAt: string | null;
  reason: string | null;
};

export type ApiUsage = {
  state: MetricState;
  auth: number | null;
  rest: number | null;
  realtime: number | null;
  storage: number | null;
  sampleStart: string | null;
  sampleEnd: string | null;
  reason: string | null;
};

export type ProjectUsage = { disk: DiskUsage; apiRequests: ApiUsage };

export const FREE_PLAN_LIMITS = [
  { key: "database", label: "数据库大小", quota: "500 MB", scope: "project", source: "https://supabase.com/docs/guides/platform/billing-on-supabase" },
  { key: "egress", label: "Egress 流量", quota: "5 GB", scope: "organization", source: "https://supabase.com/docs/guides/platform/billing-on-supabase" },
  { key: "cached_egress", label: "Cached Egress", quota: "5 GB", scope: "organization", source: "https://supabase.com/pricing" },
  { key: "storage", label: "Storage 文件容量", quota: "1 GB", scope: "organization", source: "https://supabase.com/docs/guides/platform/billing-on-supabase" },
  { key: "auth_mau", label: "Auth 月活用户", quota: "50,000", scope: "organization", source: "https://supabase.com/docs/guides/platform/billing-on-supabase" },
  { key: "functions", label: "Edge Function 调用", quota: "500,000 / 月", scope: "organization", source: "https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations" },
  { key: "logs_ingest", label: "Logs Ingest", quota: "1 GB", scope: "organization", source: "https://supabase.com/pricing" },
  { key: "logs_query", label: "Logs Query", quota: "100 GB", scope: "organization", source: "https://supabase.com/pricing" },
] as const;

type Obj = Record<string, unknown>;
function object(v: unknown): Obj | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Obj : null;
}
function nonNegativeNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}
function time(v: unknown): string | null {
  return typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null;
}
export function emptyDisk(state: MetricState, reason: string): DiskUsage {
  return { state, usedBytes: null, freeBytes: null, capacityBytes: null, sampleAt: null, reason };
}
export function emptyApi(state: MetricState, reason: string): ApiUsage {
  return { state, auth: null, rest: null, realtime: null, storage: null, sampleStart: null, sampleEnd: null, reason };
}
export function parseDiskUtil(raw: unknown): DiskUsage {
  const data = object(raw);
  const metrics = object(data?.metrics);
  const usedBytes = nonNegativeNumber(metrics?.fs_used_bytes);
  const freeBytes = nonNegativeNumber(metrics?.fs_avail_bytes);
  const capacityBytes = nonNegativeNumber(metrics?.fs_size_bytes);
  if (usedBytes === null && freeBytes === null && capacityBytes === null)
    return emptyDisk("unavailable", "官方接口未提供可识别的磁盘容量字段");
  return {
    state: "available",
    usedBytes,
    freeBytes,
    capacityBytes,
    sampleAt: time(data?.timestamp),
    reason: null,
  };
}
export function parseApiCounts(raw: unknown): ApiUsage {
  const data = object(raw);
  if (!data || typeof data.error === "string" && data.error.trim())
    return emptyApi("unavailable", "官方统计接口返回错误或无有效数据");
  const rows = Array.isArray(data.result) ? data.result.map(object).filter((x): x is Obj => !!x) : [];
  // Do not turn an empty result into a fabricated zero.
  if (!rows.length) return emptyApi("unavailable", "官方统计接口暂无数据");
  const keys = {
    auth: "total_auth_requests",
    rest: "total_rest_requests",
    realtime: "total_realtime_requests",
    storage: "total_storage_requests",
  } as const;
  function aggregate(key: string): number | null {
    const values = rows.map(row => nonNegativeNumber(row[key])).filter((v): v is number => v !== null);
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0);
  }
  const counts = {
    auth: aggregate(keys.auth), rest: aggregate(keys.rest),
    realtime: aggregate(keys.realtime), storage: aggregate(keys.storage),
  };
  if (Object.values(counts).every(v => v === null))
    return emptyApi("unavailable", "官方接口返回的数据中缺少请求计数字段");
  const timestamps = rows.map(row => time(row.timestamp)).filter((v): v is string => v !== null).sort();
  return {
    state: "available", ...counts,
    sampleStart: timestamps[0] ?? null, sampleEnd: timestamps.at(-1) ?? null,
    reason: null,
  };
}
