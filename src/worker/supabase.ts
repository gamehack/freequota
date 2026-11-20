import {
  FREE_PLAN_LIMITS, type DiskUsage, type ApiUsage, type ProjectUsage,
  emptyDisk, emptyApi, parseDiskUtil, parseApiCounts,
} from "./supabase-usage";

type Obj = Record<string, unknown>;
const ENDPOINT = "https://api.supabase.com/v1";
const MAX_ORGS = 12;
const MAX_PROJECT_DETAILS = 12;

function arr(x: unknown): Obj[] {
  return Array.isArray(x) ? x.filter((z): z is Obj => !!z && typeof z === "object" && !Array.isArray(z)) : [];
}
export async function supabaseGet(token: string, path: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const r = await fetch(ENDPOINT + path, {
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!r.ok) throw new Error("Supabase API " + r.status);
    return await r.json();
  } finally {
    clearTimeout(timeout);
  }
}
export async function validateSupabase(token: string): Promise<void> {
  await supabaseGet(token, "/projects");
}
function plan(x: Obj): string | null {
  const p = x.plan ?? x.subscription;
  if (typeof p === "string") return p.toLowerCase();
  if (p && typeof p === "object") {
    const id = (p as Obj).id ?? (p as Obj).name ?? (p as Obj).plan;
    if (typeof id === "string") return id.toLowerCase();
  }
  return null;
}
async function mapBatched<T, U>(items: T[], batchSize: number, fn: (item: T) => Promise<U>): Promise<U[]> {
  const results: U[] = [];
  for (let i = 0; i < items.length; i += batchSize)
    results.push(...await Promise.all(items.slice(i, i + batchSize).map(fn)));
  return results;
}
function safeError(e: unknown): string {
  const s = e instanceof Error ? e.message : "";
  if (s.includes("401")) return "当前 PAT 无法访问该接口（401）";
  if (s.includes("403")) return "当前 PAT 无该指标的读取权限（403）";
  if (s.includes("404")) return "官方接口未返回此项目的数据（404）";
  if (s.includes("429")) return "Supabase API 限流，请稍后重试（429）";
  if (s.includes("500")) return "Supabase 官方接口暂时不可用（500）";
  if (s.includes("AbortError") || s.includes("abort")) return "请求超时";
  return "官方接口查询失败";
}
async function projectUsage(token: string, ref: string): Promise<ProjectUsage> {
  const p = "/projects/" + encodeURIComponent(ref);
  const [disk, stats] = await Promise.allSettled([
    supabaseGet(token, p + "/config/disk/util"),
    supabaseGet(token, p + "/analytics/endpoints/usage.api-counts"),
  ]);
  const diskUsage: DiskUsage = disk.status === "fulfilled"
    ? parseDiskUtil(disk.value)
    : emptyDisk("error", safeError(disk.reason));
  const apiRequests: ApiUsage = stats.status === "fulfilled"
    ? parseApiCounts(stats.value)
    : emptyApi("error", safeError(stats.reason));
  return { disk: diskUsage, apiRequests };
}
export async function getSupabaseLive(token: string) {
  const [projectResult, orgResult] = await Promise.allSettled([
    supabaseGet(token, "/projects"),
    supabaseGet(token, "/organizations"),
  ]);
  if (projectResult.status === "rejected") throw projectResult.reason;

  const projects = arr(projectResult.value).map(x => ({
    id: String(x.id ?? ""), name: String(x.name ?? ""),
    organization_id: String(x.organization_id ?? x.organization_slug ?? ""),
    region: String(x.region ?? ""), status: String(x.status ?? "unknown"),
    created_at: x.created_at ?? null,
  }));
  const rawOrgs = orgResult.status === "fulfilled" ? arr(orgResult.value) : [];
  const organizations = await mapBatched(rawOrgs.slice(0, MAX_ORGS), 3, async o => {
    const slug = String(o.slug ?? o.id ?? "");
    let details: Obj = o;
    let warning: string | undefined;
    if (slug) {
      try {
        const response = await supabaseGet(token, "/organizations/" + encodeURIComponent(slug));
        details = response && typeof response === "object" && !Array.isArray(response) ? response as Obj : o;
      } catch (e) {
        warning = safeError(e);
      }
    }
    return { id: String(o.id ?? details.id ?? ""), slug, name: String(o.name ?? details.name ?? slug), plan: plan(details) ?? plan(o), warning };
  });

  const inspected = await mapBatched(projects.slice(0, MAX_PROJECT_DETAILS), 2, async p => {
    if (!p.id) return {
      disk: emptyDisk("unavailable", "项目没有有效 ID"),
      apiRequests: emptyApi("unavailable", "项目没有有效 ID"),
    };
    if (p.status.toUpperCase().includes("PAUSED") || p.status.toUpperCase().includes("INACTIVE"))
      return {
        disk: emptyDisk("skipped", "项目已暂停，未发起磁盘查询"),
        apiRequests: emptyApi("skipped", "项目已暂停，未发起统计查询"),
      };
    return projectUsage(token, p.id);
  });
  const withUsage = projects.map((p, i) => ({
    ...p, usage: inspected[i] ?? {
      disk: emptyDisk("skipped", "本次按需查询最多处理 12 个项目的详细用量"),
      apiRequests: emptyApi("skipped", "本次按需查询最多处理 12 个项目的详细统计"),
    },
  }));
  const hasProjectWarnings = withUsage.some(p =>
    p.usage.disk.state !== "available" || p.usage.apiRequests.state !== "available"
  );
  return {
    queriedAt: new Date().toISOString(),
    projects: withUsage,
    organizations,
    freePlanLimits: FREE_PLAN_LIMITS,
    partial: orgResult.status === "rejected" || rawOrgs.length > MAX_ORGS ||
      organizations.some(o => !!o.warning) || hasProjectWarnings,
    accountFreeProjectReferenceLimit: 2,
    notes: "套餐限额来自 Supabase 官方定价，实际计费量以组织 Usage 页面为准。磁盘文件系统占用及 API 请求量为官方运行统计，不是账单用量。",
  };
}
