export type Account = { id: string; alias: string; remark: string; created_at: string; updated_at?: string };
export type DiskUsage = {
  state: "available" | "unavailable" | "error" | "skipped";
  usedBytes: number | null; freeBytes: number | null; capacityBytes: number | null;
  sampleAt: string | null; reason: string | null;
};
export type ApiUsage = {
  state: "available" | "unavailable" | "error" | "skipped";
  auth: number | null; rest: number | null; realtime: number | null; storage: number | null;
  sampleStart: string | null; sampleEnd: string | null; reason: string | null;
};
export type Project = {
  id: string; name: string; organization_id: string; region: string; status: string;
  created_at: string | null;
  usage: { disk: DiskUsage; apiRequests: ApiUsage };
};
export type Org = { id: string; slug: string; name: string; plan: string | null; warning?: string };
export type PlanLimit = { key: string; label: string; quota: string; scope: "project" | "organization"; source: string };
export type Live = {
  queriedAt: string; projects: Project[]; organizations: Org[];
  freePlanLimits: PlanLimit[]; partial: boolean;
  accountFreeProjectReferenceLimit: number; notes: string;
};
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch("/api" + path, {
    credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) }, ...init,
  });
  const json: any = await response.json().catch(() => ({ error: "服务返回无效内容" }));
  if (!response.ok) throw new Error(json.error || "HTTP " + response.status);
  return json as T;
}

export type {
  NeonBranch,
  NeonMetric,
  NeonMetricState,
  NeonOrganization,
  NeonOverview,
  NeonProjectLive,
  NeonProjectSummary,
  NeonStatus,
} from "../shared/neon";
