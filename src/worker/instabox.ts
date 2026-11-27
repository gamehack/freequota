import { parseInstaboxUsage, type InstaboxOverview } from "../shared/instabox";

const API_BASE = "https://api.instabox.sh";
const REQUEST_TIMEOUT_MS = 12000;

export class InstaboxApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    const message =
      status === 401 ? "InstaBox API Key 无效、已过期或已撤销（401）" :
      status === 403 ? "InstaBox API Key 权限不足（403）：请授予 machines:read，或 images:read" :
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
  try {
    return parseInstaboxUsage(raw);
  } catch {
    throw new InstaboxApiError(502);
  }
}

export async function validateInstaboxApiKey(token: string): Promise<void> {
  await getInstaboxOverview(token);
}
