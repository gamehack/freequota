import {
  emptyNeonMetric,
  parseBranchMetrics,
  parseProjectMetrics,
  type NeonOrganization,
  type NeonOverview,
  type NeonProjectLive,
  type NeonProjectSummary,
} from "../shared/neon";

type Obj = Record<string, unknown>;
const API_BASE = "https://console.neon.tech/api/v2";
const REQUEST_TIMEOUT_MS = 9000;
const MAX_ORGANIZATIONS = 40;
const PROJECT_PAGE_SIZE = 400;
const BRANCH_PAGE_SIZE = 1000;

export class NeonApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    const message =
      status === 401 ? "Neon API Key 无效或已撤销（401）" :
      status === 403 ? "当前 Neon API Key 无权访问该资源（403）" :
      status === 404 ? "Neon 未找到该资源，或当前 API Key 无访问权限（404）" :
      status === 429 ? "Neon API 请求过于频繁，请稍后重试（429）" :
      status === 504 ? "Neon API 请求超时" :
      status >= 500 ? "Neon 官方 API 暂时不可用（" + status + "）" :
      "Neon API 请求失败（" + status + "）";
    super(message);
    this.name = "NeonApiError";
    this.status = status;
  }
}

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

function textValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

async function neonGet(token: string, path: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(API_BASE + path, {
      method: "GET",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new NeonApiError(response.status);
    return await response.json();
  } catch (error) {
    if (error instanceof NeonApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new NeonApiError(504);
    }
    throw new NeonApiError(502);
  } finally {
    clearTimeout(timeout);
  }
}

export function safeNeonError(error: unknown): string {
  return error instanceof NeonApiError
    ? error.message
    : "Neon 官方 API 查询失败，请稍后重试";
}

export function neonErrorStatus(error: unknown): number {
  if (!(error instanceof NeonApiError)) return 502;
  if ([401, 403, 404, 429].includes(error.status)) return error.status;
  return 502;
}

export async function listNeonOrganizations(token: string): Promise<Array<{
  id: string;
  name: string;
  handle: string;
  plan: string | null;
}>> {
  const raw = object(await neonGet(token, "/users/me/organizations"));
  return array(raw?.organizations)
    .map(org => ({
      id: textValue(org.id),
      name: textValue(org.name, textValue(org.handle, textValue(org.id, "未命名组织"))),
      handle: textValue(org.handle),
      plan: typeof org.plan === "string" ? org.plan : null,
    }))
    .filter(org => org.id.length > 0);
}

async function listOrganizationProjects(
  token: string,
  orgId: string,
): Promise<{ projects: NeonProjectSummary[]; complete: boolean }> {
  const query = "?org_id=" + encodeURIComponent(orgId) + "&limit=" + PROJECT_PAGE_SIZE;
  const raw = object(await neonGet(token, "/projects" + query));
  if (!raw || !Array.isArray(raw.projects)) throw new NeonApiError(502);
  const projects = array(raw.projects).map(project => ({
    id: textValue(project.id),
    name: textValue(project.name, textValue(project.id, "未命名项目")),
    orgId: textValue(project.org_id, orgId),
    region: textValue(project.region_id),
    pgVersion: numberValue(project.pg_version),
    createdAt: typeof project.created_at === "string" ? project.created_at : null,
  })).filter(project => project.id.length > 0);
  const pagination = object(raw.pagination);
  return {
    projects,
    complete: !pagination?.cursor,
  };
}

async function mapBatched<T, U>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<U>,
): Promise<U[]> {
  const output: U[] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    output.push(...await Promise.all(items.slice(index, index + batchSize).map(fn)));
  }
  return output;
}

export async function getNeonOverview(token: string): Promise<NeonOverview> {
  const allOrganizations = await listNeonOrganizations(token);
  const selectedOrganizations = allOrganizations.slice(0, MAX_ORGANIZATIONS);
  const warnings: string[] = [];

  if (allOrganizations.length > MAX_ORGANIZATIONS) {
    warnings.push(
      "当前账号可访问 " + allOrganizations.length + " 个组织，本次最多展示前 " +
      MAX_ORGANIZATIONS + " 个组织。",
    );
  }

  const organizations: NeonOrganization[] = await mapBatched(
    selectedOrganizations,
    4,
    async org => {
      try {
        const result = await listOrganizationProjects(token, org.id);
        const warning = result.complete
          ? null
          : "该组织项目超过 " + PROJECT_PAGE_SIZE + " 个，本次仅展示第一页。";
        if (warning) warnings.push(org.name + "：" + warning);
        return {
          ...org,
          projects: result.projects,
          projectCount: result.projects.length,
          projectListComplete: result.complete,
          warning,
        };
      } catch (error) {
        const warning = safeNeonError(error);
        warnings.push(org.name + "：" + warning);
        return {
          ...org,
          projects: [],
          projectCount: 0,
          projectListComplete: false,
          warning,
        };
      }
    },
  );

  const projectIds = new Set<string>();
  for (const org of organizations) {
    for (const project of org.projects) projectIds.add(project.id);
  }

  return {
    queriedAt: new Date().toISOString(),
    organizations,
    projectCount: projectIds.size,
    partial: warnings.length > 0,
    warnings,
  };
}

export async function getNeonProjectLive(
  token: string,
  projectId: string,
): Promise<NeonProjectLive> {
  const [projectResult, branchResult] = await Promise.allSettled([
    neonGet(token, "/projects/" + encodeURIComponent(projectId)),
    neonGet(
      token,
      "/projects/" + encodeURIComponent(projectId) +
      "/branches?limit=" + BRANCH_PAGE_SIZE,
    ),
  ]);

  let projectMetrics = {
    compute: emptyNeonMetric("error", "项目用量查询失败"),
    transfer: emptyNeonMetric("error", "项目用量查询失败"),
    periodStart: null as string | null,
    periodEnd: null as string | null,
    lastComputeActiveAt: null as string | null,
  };

  if (projectResult.status === "fulfilled") {
    projectMetrics = parseProjectMetrics(projectResult.value);
  } else {
    const reason = safeNeonError(projectResult.reason);
    projectMetrics = {
      compute: emptyNeonMetric("error", reason),
      transfer: emptyNeonMetric("error", reason),
      periodStart: null,
      periodEnd: null,
      lastComputeActiveAt: null,
    };
  }

  let branchMetrics = {
    storage: emptyNeonMetric("error", "Branch 查询失败"),
    branches: emptyNeonMetric("error", "Branch 查询失败"),
    branchItems: [] as ReturnType<typeof parseBranchMetrics>["branchItems"],
  };

  if (branchResult.status === "fulfilled") {
    const branchBody = object(branchResult.value);
    branchMetrics = parseBranchMetrics(branchResult.value);
    const pagination = object(branchBody?.pagination);
    if (pagination?.next) {
      const reason = "Branch 超过 " + BRANCH_PAGE_SIZE + " 个，本次未完整读取，不能计算总量";
      branchMetrics = {
        storage: emptyNeonMetric("unavailable", reason),
        branches: emptyNeonMetric("unavailable", reason),
        branchItems: branchMetrics.branchItems,
      };
    }
  } else {
    const reason = safeNeonError(branchResult.reason);
    branchMetrics = {
      storage: emptyNeonMetric("error", reason),
      branches: emptyNeonMetric("error", reason),
      branchItems: [],
    };
  }

  return {
    projectId,
    compute: projectMetrics.compute,
    transfer: projectMetrics.transfer,
    storage: branchMetrics.storage,
    branches: branchMetrics.branches,
    branchItems: branchMetrics.branchItems,
    periodStart: projectMetrics.periodStart,
    periodEnd: projectMetrics.periodEnd,
    lastComputeActiveAt: projectMetrics.lastComputeActiveAt,
  };
}
