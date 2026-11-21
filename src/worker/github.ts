import {
  aggregateGitHubProducts,
  aggregateGitHubRepositories,
  parseGitHubUsageItems,
  type GitHubOverview,
} from "../shared/github";

type Obj = Record<string, unknown>;
const API_BASE = "https://api.github.com";
const API_VERSION = "2026-03-10";
const REQUEST_TIMEOUT_MS = 12000;

function object(value: unknown): Obj | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Obj
    : null;
}

export class GitHubApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    const message =
      status === 401 ? "GitHub Token 无效、已过期或已撤销（401）" :
      status === 403 ? "GitHub 账单接口拒绝访问（403）：请确认 Fine-grained PAT 已授予 User permissions → Plan: Read，且个人账号已开放该账单接口" :
      status === 404 ? "未找到该账号的个人账单数据（404）：请检查 GitHub 用户名与 Token 是否属于同一账号，以及增强账单平台是否已开放" :
      status === 422 ? "GitHub 账单查询参数无效（422）" :
      status === 429 ? "GitHub API 请求过于频繁，请稍后重试（429）" :
      status === 504 ? "GitHub 官方 API 请求超时" :
      status >= 500 ? "GitHub 官方 API 暂时不可用（" + status + "）" :
      "GitHub API 请求失败（" + status + "）";
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
  }
}

async function githubGet(token: string, path: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(API_BASE + path, {
      method: "GET",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new GitHubApiError(response.status);
    return await response.json();
  } catch (error) {
    if (error instanceof GitHubApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new GitHubApiError(504);
    throw new GitHubApiError(502);
  } finally {
    clearTimeout(timeout);
  }
}

function billingPath(username: string, report: "summary" | "usage", year: number, month: number): string {
  const query = new URLSearchParams({ year: String(year), month: String(month) });
  const suffix = report === "summary" ? "/summary" : "";
  return "/users/" + encodeURIComponent(username) +
    "/settings/billing/usage" + suffix + "?" + query.toString();
}

async function getBillingItems(token: string, path: string) {
  const raw = object(await githubGet(token, path));
  if (!raw || !Array.isArray(raw.usageItems)) throw new GitHubApiError(502);
  return parseGitHubUsageItems(raw.usageItems);
}

export function safeGitHubError(error: unknown): string {
  return error instanceof GitHubApiError
    ? error.message
    : "GitHub 官方 API 查询失败，请稍后重试";
}

export function githubErrorStatus(error: unknown): 401 | 403 | 404 | 429 | 502 | 504 {
  if (!(error instanceof GitHubApiError)) return 502;
  switch (error.status) {
    case 401: return 401;
    case 403: return 403;
    case 404: return 404;
    case 429: return 429;
    case 504: return 504;
    default: return 502;
  }
}

export async function validateGitHubToken(token: string, username: string): Promise<void> {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  await getBillingItems(token, billingPath(username, "summary", year, month));
}

export async function getGitHubOverview(
  token: string,
  username: string,
  now = new Date(),
): Promise<GitHubOverview> {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const [summaryResult, detailResult] = await Promise.allSettled([
    getBillingItems(token, billingPath(username, "summary", year, month)),
    getBillingItems(token, billingPath(username, "usage", year, month)),
  ]);
  if (summaryResult.status === "rejected") throw summaryResult.reason;

  const summaryItems = summaryResult.value;
  const detailItems = detailResult.status === "fulfilled" ? detailResult.value : [];
  const detailsReason = detailResult.status === "rejected"
    ? safeGitHubError(detailResult.reason)
    : null;

  return {
    username,
    queriedAt: new Date().toISOString(),
    period: { year, month },
    planReference: "GitHub Free",
    summary: {
      usageItems: summaryItems,
      products: aggregateGitHubProducts(summaryItems),
      grossAmount: sumAmount(summaryItems.map(item => item.grossAmount)),
      discountAmount: sumAmount(summaryItems.map(item => item.discountAmount)),
      netAmount: sumAmount(summaryItems.map(item => item.netAmount)),
    },
    details: {
      state: detailResult.status === "fulfilled" ? "available" : "unavailable",
      reason: detailsReason,
      usageItems: detailItems,
      repositories: aggregateGitHubRepositories(detailItems),
    },
    partial: detailResult.status === "rejected",
    notes: [
      "GitHub Free 的 $12 是每月共享计算额度的美元价值，不是所有 Runner 通用的固定分钟数。",
      "套餐额度为 GitHub Free 参考值，当前 API 不用于自动识别账号实际套餐。",
      "账单 API 的 grossAmount、discountAmount、netAmount 按官方原值展示；不把折扣直接等同于已消耗免费额度，也不推算未经证实的剩余额度。",
      "仓库明细接口可能受增强账单平台开放状态限制；不可用时仍保留账户级汇总。",
      "Artifacts 与 Packages 共用 500 MB 参考存储额度；Billing usage 是计费周期内用量，不等同于当前瞬时占用。",
    ],
  };
}

function sumAmount(values: Array<number | null>): number | null {
  if (values.some(value => value === null)) return null;
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}
