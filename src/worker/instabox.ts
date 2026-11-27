import {
  parseInstaboxUsage,
  attachInstaboxMachineUsage,
  type InstaboxOverview,
} from "../shared/instabox";

const API_BASE = "https://api.instabox.sh";
const REQUEST_TIMEOUT_MS = 12000;
const MACHINE_USAGE_PAGE_SIZE = 100;
const MACHINE_USAGE_MAX_PAGES = 10;

type Obj = Record<string, unknown>;

function asObject(value: unknown): Obj | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Obj
    : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export class InstaboxApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    const message =
      status === 401 ? "InstaBox API Key 无效、已过期或已撤销（401）" :
      status === 403 ? "InstaBox API Key 权限不足（403）：查询机器月度用量需要 machines:read" :
      status === 404 ? "InstaBox Usage API 未找到对应 Workspace（404）" :
      status === 429 ? "InstaBox API 请求过于频繁，请稍后重试（429）" :
      status === 504 ? "InstaBox 官方 API 请求超时" :
      status >= 500 ? "InstaBox 官方 API 暂时不可用（" + status + "）" :
      "InstaBox API 请求失败（" + status + "）";
    super(message);
    this.name = "InstaboxApiError";
    this.status = status;
  }
}

async function instaboxGet(token: string, path: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(API_BASE + path, {
      method: "GET",
      headers: {
        "X-API-Key": token,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new InstaboxApiError(response.status);
    return await response.json();
  } catch (error) {
    if (error instanceof InstaboxApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new InstaboxApiError(504);
    throw new InstaboxApiError(502);
  } finally {
    clearTimeout(timeout);
  }
}

async function getInstaboxMachineUsage(token: string, now = new Date()): Promise<unknown> {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const to = now.toISOString();
  const rows: unknown[] = [];
  let total = 0;
  let countedThrough = to;

  for (let page = 0; page < MACHINE_USAGE_MAX_PAGES; page++) {
    const query = new URLSearchParams({
      from,
      to,
      limit: String(MACHINE_USAGE_PAGE_SIZE),
    });
    if (rows.length > 0) query.set("offset", String(rows.length));

    const raw = await instaboxGet(token, "/v1/usage/machines?" + query.toString());
    const root = asObject(raw);
    if (!root || !Array.isArray(root.machines)) throw new InstaboxApiError(502);

    rows.push(...root.machines);
    total = asNumber(root.total) ?? rows.length;
    countedThrough = asString(root.to) ?? countedThrough;

    if (rows.length >= total) {
      return {
        from: asString(root.from) ?? from,
        to: countedThrough,
        total,
        machines: rows,
      };
    }
  }

  throw new InstaboxApiError(502);
}

export function safeInstaboxError(error: unknown): string {
  return error instanceof InstaboxApiError
    ? error.message
    : "InstaBox 官方 API 查询失败，请稍后重试";
}

export function instaboxErrorStatus(error: unknown): 401 | 403 | 404 | 429 | 502 | 504 {
  if (!(error instanceof InstaboxApiError)) return 502;
  switch (error.status) {
    case 401: return 401;
    case 403: return 403;
    case 404: return 404;
    case 429: return 429;
    case 504: return 504;
    default: return 502;
  }
}

export async function getInstaboxOverview(token: string): Promise<InstaboxOverview> {
  const raw = await instaboxGet(token, "/v1/usage");
  let overview: InstaboxOverview;
  try {
    overview = parseInstaboxUsage(raw);
  } catch {
    throw new InstaboxApiError(502);
  }

  try {
    const machineUsage = await getInstaboxMachineUsage(token);
    return attachInstaboxMachineUsage(overview, machineUsage);
  } catch (error) {
    return attachInstaboxMachineUsage(overview, null, safeInstaboxError(error));
  }
}

export async function validateInstaboxApiKey(token: string): Promise<void> {
  const usage = await instaboxGet(token, "/v1/usage");
  try {
    parseInstaboxUsage(usage);
    await getInstaboxMachineUsage(token);
  } catch (error) {
    if (error instanceof InstaboxApiError) throw error;
    throw new InstaboxApiError(502);
  }
}
