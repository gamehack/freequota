import {
  classifyR2Operation,
  cloudflareMetric,
  cloudflareUnavailable,
  computeR2MonthlyAverage,
  CLOUDFLARE_FREE_LIMITS,
  type CloudflareD1Data,
  type CloudflareDnsData,
  type CloudflareKvData,
  type CloudflareMetric,
  type CloudflareOverview,
  type CloudflarePagesData,
  type CloudflarePagesProjectItem,
  type CloudflareProductState,
  type CloudflareR2Data,
  type CloudflareR2BucketItem,
  type CloudflareWorkersData,
} from "../shared/cloudflare";

type Obj = Record<string, unknown>;
const API_BASE = "https://api.cloudflare.com/client/v4";
const REQUEST_TIMEOUT_MS = 9_000;
const MAX_LIST_PAGES = 10;
const MAX_PAGES_PROJECTS = 50;
const MAX_DEPLOYMENT_PAGES = 12;

export class CloudflareApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    const message =
      status === 401 ? "Cloudflare API Token 无效或已撤销（401）" :
      status === 403 ? "Cloudflare API Token 缺少对应只读权限（403）" :
      status === 404 ? "Cloudflare 未找到资源，或当前 Token 无访问权限（404）" :
      status === 429 ? "Cloudflare API 请求过于频繁，请稍后重试（429）" :
      status === 504 ? "Cloudflare API 请求超时" :
      status >= 500 ? "Cloudflare 官方 API 暂时不可用（" + status + "）" :
      "Cloudflare API 查询失败（" + status + "）";
    super(message);
    this.name = "CloudflareApiError";
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
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function sumField(rows: Obj[], field: string): number {
  return rows.reduce((sum, row) => {
    const value = numberValue(object(row.sum)?.[field]);
    return sum + (value ?? 0);
  }, 0);
}

function productState(listOk: boolean, analyticsOk: boolean, extraPartial = false): CloudflareProductState {
  if (!listOk && !analyticsOk) return "error";
  if (!listOk || !analyticsOk || extraPartial) return "partial";
  return "available";
}

function errorMetric(error: unknown, unit: string, period: string, quota: number | null = null): CloudflareMetric {
  return cloudflareUnavailable("error", safeCloudflareError(error), unit, period, quota);
}

function missingMetric(reason: string, unit: string, period: string, quota: number | null = null): CloudflareMetric {
  return cloudflareUnavailable("unavailable", reason, unit, period, quota);
}

async function fetchJson(url: string, token: string, init: RequestInit): Promise<Obj> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json",
        ...(init.headers || {}),
      },
      signal: controller.signal,
    });
    const payload = object(await response.json().catch(() => null));
    if (!response.ok || !payload || payload.success === false) {
      throw new CloudflareApiError(response.status || 502);
    }
    return payload;
  } catch (error) {
    if (error instanceof CloudflareApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new CloudflareApiError(504);
    throw new CloudflareApiError(502);
  } finally {
    clearTimeout(timeout);
  }
}

async function cloudflareGet(
  token: string,
  path: string,
  query: Record<string, string | number> = {},
): Promise<Obj> {
  const url = new URL(API_BASE + path);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  return fetchJson(url.toString(), token, { method: "GET" });
}

async function cloudflareGraphql(token: string, query: string): Promise<Obj> {
  const payload = await fetchJson(API_BASE + "/graphql", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  if (errors.length > 0) throw new CloudflareApiError(403);
  const data = object(payload.data);
  const viewer = object(data?.viewer);
  const accounts = array(viewer?.accounts);
  if (!accounts.length) throw new CloudflareApiError(404);
  return accounts[0];
}

export async function validateCloudflareToken(token: string, accountId: string): Promise<void> {
  const query = "query { viewer { accounts(filter:{accountTag:\"" + accountId + "\"}) { accountTag } } }";
  const account = await cloudflareGraphql(token, query);
  if (account.accountTag !== accountId) throw new CloudflareApiError(404);
}

export function safeCloudflareError(error: unknown): string {
  if (error instanceof CloudflareApiError) return error.message;
  return "Cloudflare 官方 API 查询失败，请稍后重试";
}

export function cloudflareErrorStatus(error: unknown): 401 | 403 | 404 | 429 | 502 | 504 {
  if (!(error instanceof CloudflareApiError)) return 502;
  if (error.status === 401) return 401;
  if (error.status === 403) return 403;
  if (error.status === 404) return 404;
  if (error.status === 429) return 429;
  if (error.status === 504) return 504;
  return 502;
}

async function listPaged(
  token: string,
  path: string,
  perPage: number,
  maxPages = MAX_LIST_PAGES,
  filters: Record<string, string | number> = {},
): Promise<{ items: Obj[]; complete: boolean }> {
  const items: Obj[] = [];
  let page = 1;
  let totalPages = 1;
  let complete = true;
  while (page <= totalPages && page <= maxPages) {
    const response = await cloudflareGet(token, path, { ...filters, page, per_page: perPage });
    items.push(...array(response.result));
    const info = object(response.result_info);
    totalPages = numberValue(info?.total_pages) ?? page;
    if (page >= totalPages) break;
    if (page >= maxPages) {
      complete = false;
      break;
    }
    page += 1;
  }
  return { items, complete };
}

async function listWorkers(token: string, accountId: string): Promise<Obj[]> {
  const response = await cloudflareGet(token, "/accounts/" + accountId + "/workers/scripts");
  return array(response.result);
}

async function listD1(token: string, accountId: string): Promise<{ items: Obj[]; complete: boolean }> {
  return listPaged(token, "/accounts/" + accountId + "/d1/database", 100);
}

async function listR2(token: string, accountId: string): Promise<{ items: Obj[]; complete: boolean }> {
  const items: Obj[] = [];
  let cursor = "";
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const query: Record<string, string | number> = { per_page: 1000 };
    if (cursor) query.cursor = cursor;
    const response = await cloudflareGet(token, "/accounts/" + accountId + "/r2/buckets", query);
    const result = object(response.result);
    items.push(...array(result?.buckets));
    const info = object(response.result_info);
    const next = textValue(result?.cursor, textValue(info?.cursor));
    if (!next) return { items, complete: true };
    cursor = next;
  }
  return { items, complete: false };
}

async function listKv(token: string, accountId: string): Promise<{ items: Obj[]; complete: boolean }> {
  return listPaged(token, "/accounts/" + accountId + "/storage/kv/namespaces", 100);
}

async function listPages(token: string, accountId: string): Promise<{ items: Obj[]; complete: boolean }> {
  return listPaged(token, "/accounts/" + accountId + "/pages/projects", 10, 4);
}

async function listZones(token: string, accountId: string): Promise<{ items: Obj[]; complete: boolean }> {
  const result = await listPaged(token, "/zones", 50, 4, { "account.id": accountId });
  return {
    ...result,
    items: result.items.filter(zone => textValue(object(zone.account)?.id) === accountId),
  };
}

function graphqlQuery(accountId: string, body: string): string {
  return "query { viewer { accounts(filter:{accountTag:\"" + accountId + "\"}) { " + body + " } } }";
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

function buildWorkers(
  scripts: Obj[],
  analyticsRows: Obj[],
  listError: unknown | null,
  analyticsError: unknown | null,
): CloudflareWorkersData {
  const scriptNames = new Set<string>();
  for (const script of scripts) {
    const name = textValue(script.id, textValue(script.script, textValue(script.name)));
    if (name) scriptNames.add(name);
  }
  const rowsByName = new Map<string, Obj>();
  for (const row of analyticsRows) {
    const name = textValue(object(row.dimensions)?.scriptName);
    if (name) {
      scriptNames.add(name);
      rowsByName.set(name, row);
    }
  }
  const items = [...scriptNames].sort().map(name => {
    const row = rowsByName.get(name);
    const sum = object(row?.sum);
    const quantiles = object(row?.quantiles);
    const p50 = numberValue(quantiles?.cpuTimeP50);
    const p99 = numberValue(quantiles?.cpuTimeP99);
    return {
      name,
      requests: numberValue(sum?.requests) ?? 0,
      errors: numberValue(sum?.errors) ?? 0,
      subrequests: numberValue(sum?.subrequests) ?? 0,
      cpuTimeP50Ms: p50 === null ? null : p50 / 1000,
      cpuTimeP99Ms: p99 === null ? null : p99 / 1000,
    };
  });
  const analyticsOk = analyticsError === null;
  const listOk = listError === null;
  const p99Values = items.map(item => item.cpuTimeP99Ms).filter((value): value is number => value !== null);
  return {
    state: productState(listOk, analyticsOk),
    resourceState: listOk ? "available" : "error",
    resourceReason: listOk ? null : safeCloudflareError(listError),
    count: listOk ? scripts.length : null,
    requests: analyticsOk
      ? cloudflareMetric(sumField(analyticsRows, "requests"), CLOUDFLARE_FREE_LIMITS.workersRequestsPerDay, "次", "每日")
      : errorMetric(analyticsError, "次", "每日", CLOUDFLARE_FREE_LIMITS.workersRequestsPerDay),
    errors: analyticsOk
      ? cloudflareMetric(sumField(analyticsRows, "errors"), null, "次", "每日")
      : errorMetric(analyticsError, "次", "每日"),
    subrequests: analyticsOk
      ? cloudflareMetric(sumField(analyticsRows, "subrequests"), null, "次", "每日")
      : errorMetric(analyticsError, "次", "每日"),
    cpuTimeP99Ms: p99Values.length
      ? cloudflareMetric(Math.max(...p99Values), null, "ms", "每日", false, "各 Worker CPU P99 的最大值；GraphQL 原始微秒已换算为毫秒")
      : missingMetric("当前统计周期没有可用的 CPU 分位数样本", "ms", "每日"),
    items,
  };
}

function buildD1(
  databases: Obj[],
  analyticsRows: Obj[],
  storageRows: Obj[],
  listError: unknown | null,
  analyticsError: unknown | null,
  storageError: unknown | null,
): CloudflareD1Data {
  const analytics = new Map<string, { rowsRead: number; rowsWritten: number }>();
  for (const row of analyticsRows) {
    const id = textValue(object(row.dimensions)?.databaseId);
    if (!id) continue;
    const current = analytics.get(id) ?? { rowsRead: 0, rowsWritten: 0 };
    current.rowsRead += numberValue(object(row.sum)?.rowsRead) ?? 0;
    current.rowsWritten += numberValue(object(row.sum)?.rowsWritten) ?? 0;
    analytics.set(id, current);
  }
  const storage = new Map<string, { date: string; bytes: number }>();
  for (const row of storageRows) {
    const dimensions = object(row.dimensions);
    const id = textValue(dimensions?.databaseId);
    const date = textValue(dimensions?.date);
    const bytes = numberValue(object(row.max)?.databaseSizeBytes);
    if (!id || !date || bytes === null) continue;
    const previous = storage.get(id);
    if (!previous || date > previous.date) storage.set(id, { date, bytes });
  }

  const items = databases.map(database => {
    const id = textValue(database.uuid, textValue(database.id));
    const name = textValue(database.name, id || "未命名 D1");
    const usage = analytics.get(id) ?? { rowsRead: 0, rowsWritten: 0 };
    const storageBytes = storage.get(id)?.bytes ?? numberValue(database.file_size);
    const storageMetric = storageBytes === null
      ? missingMetric("官方接口未返回数据库大小", "B", "当前")
      : cloudflareMetric(
          storageBytes,
          null,
          "B",
          "当前",
          !storage.has(id),
          storage.has(id) ? null : "使用 D1 REST API 的 file_size 字段作为当前存储回退值",
        );
    return {
      id,
      name,
      rowsRead: analyticsError === null
        ? cloudflareMetric(usage.rowsRead, null, "行", "每日")
        : errorMetric(analyticsError, "行", "每日"),
      rowsWritten: analyticsError === null
        ? cloudflareMetric(usage.rowsWritten, null, "行", "每日")
        : errorMetric(analyticsError, "行", "每日"),
      storage: storageBytes !== null
        ? storageMetric
        : storageError
          ? errorMetric(storageError, "B", "当前")
          : storageMetric,
    };
  });

  const listOk = listError === null;
  const analyticsOk = analyticsError === null;
  const storageOk = items.every(item => item.storage.state === "available");
  const totalStorage = listOk && storageOk
    ? items.reduce((sum, item) => sum + (item.storage.used ?? 0), 0)
    : null;
  return {
    state: productState(listOk, analyticsOk && storageOk),
    resourceState: listOk ? "available" : "error",
    resourceReason: listOk ? null : safeCloudflareError(listError),
    databases: listOk
      ? cloudflareMetric(databases.length, CLOUDFLARE_FREE_LIMITS.d1Databases, "个", "当前")
      : errorMetric(listError, "个", "当前", CLOUDFLARE_FREE_LIMITS.d1Databases),
    rowsRead: analyticsOk
      ? cloudflareMetric(sumField(analyticsRows, "rowsRead"), CLOUDFLARE_FREE_LIMITS.d1RowsReadPerDay, "行", "每日")
      : errorMetric(analyticsError, "行", "每日", CLOUDFLARE_FREE_LIMITS.d1RowsReadPerDay),
    rowsWritten: analyticsOk
      ? cloudflareMetric(sumField(analyticsRows, "rowsWritten"), CLOUDFLARE_FREE_LIMITS.d1RowsWrittenPerDay, "行", "每日")
      : errorMetric(analyticsError, "行", "每日", CLOUDFLARE_FREE_LIMITS.d1RowsWrittenPerDay),
    storage: totalStorage === null
      ? (storageError ? errorMetric(storageError, "B", "当前", CLOUDFLARE_FREE_LIMITS.d1StorageBytes) : missingMetric("至少一个数据库未返回存储数据", "B", "当前", CLOUDFLARE_FREE_LIMITS.d1StorageBytes))
      : cloudflareMetric(totalStorage, CLOUDFLARE_FREE_LIMITS.d1StorageBytes, "B", "当前", storageError !== null, storageError ? "使用 REST file_size 回退" : null),
    items,
  };
}

function buildR2(
  buckets: Obj[],
  operationRows: Obj[],
  storageRows: Obj[],
  bandwidthRows: Obj[],
  listError: unknown | null,
  operationsError: unknown | null,
  storageError: unknown | null,
  bandwidthError: unknown | null,
  monthStart: string,
  today: string,
): CloudflareR2Data {
  const classAByBucket = new Map<string, number>();
  const classBByBucket = new Map<string, number>();
  const unknownByBucket = new Map<string, number>();
  let classATotal = 0;
  let classBTotal = 0;
  let unknownTotal = 0;
  for (const row of operationRows) {
    const action = textValue(object(row.dimensions)?.actionType);
    const bucketName = textValue(object(row.dimensions)?.bucketName);
    const requests = numberValue(object(row.sum)?.requests) ?? 0;
    const type = classifyR2Operation(action);
    if (type === "classA") {
      classATotal += requests;
      if (bucketName) classAByBucket.set(bucketName, (classAByBucket.get(bucketName) ?? 0) + requests);
    } else if (type === "classB") {
      classBTotal += requests;
      if (bucketName) classBByBucket.set(bucketName, (classBByBucket.get(bucketName) ?? 0) + requests);
    } else {
      unknownTotal += requests;
      if (bucketName) unknownByBucket.set(bucketName, (unknownByBucket.get(bucketName) ?? 0) + requests);
    }
  }

  const latestStorage = new Map<string, { datetime: string; payloadSize: number; objectCount: number }>();
  for (const row of storageRows) {
    const dimensions = object(row.dimensions);
    const values = object(row.max);
    const name = textValue(dimensions?.bucketName);
    const datetime = textValue(dimensions?.datetime);
    const payloadSize = numberValue(values?.payloadSize);
    const objectCount = numberValue(values?.objectCount);
    if (!name || !datetime || payloadSize === null || objectCount === null) continue;
    const previous = latestStorage.get(name);
    if (!previous || datetime > previous.datetime) {
      latestStorage.set(name, { datetime, payloadSize, objectCount });
    }
  }

  const uploadByBucket = new Map<string, number>();
  const downloadByBucket = new Map<string, number>();
  for (const row of bandwidthRows) {
    const name = textValue(object(row.dimensions)?.bucketName);
    if (!name) continue;
    uploadByBucket.set(name, (uploadByBucket.get(name) ?? 0) + (numberValue(object(row.sum)?.bytesUpload) ?? 0));
    downloadByBucket.set(name, (downloadByBucket.get(name) ?? 0) + (numberValue(object(row.sum)?.bytesDownload) ?? 0));
  }

  const items: CloudflareR2BucketItem[] = buckets.map(bucket => {
    const name = textValue(bucket.name);
    const current = latestStorage.get(name);
    return {
      name,
      classA: operationsError === null
        ? cloudflareMetric(classAByBucket.get(name) ?? 0, null, "次", "每月")
        : errorMetric(operationsError, "次", "每月"),
      classB: operationsError === null
        ? cloudflareMetric(classBByBucket.get(name) ?? 0, null, "次", "每月")
        : errorMetric(operationsError, "次", "每月"),
      currentStorageBytes: current
        ? cloudflareMetric(current.payloadSize, null, "B", "当前")
        : storageError
          ? errorMetric(storageError, "B", "当前")
          : missingMetric("当前没有可用的存储快照", "B", "当前"),
      objectCount: current
        ? cloudflareMetric(current.objectCount, null, "个", "当前")
        : missingMetric("当前没有可用的对象数量快照", "个", "当前"),
      uploadBytes: bandwidthError === null
        ? cloudflareMetric(uploadByBucket.get(name) ?? 0, null, "B", "本月")
        : errorMetric(bandwidthError, "B", "本月"),
      downloadBytes: bandwidthError === null
        ? cloudflareMetric(downloadByBucket.get(name) ?? 0, null, "B", "本月")
        : errorMetric(bandwidthError, "B", "本月"),
      unknownOperations: unknownByBucket.get(name) ?? 0,
    };
  });

  const monthlyAverage = storageError === null && listError === null
    ? computeR2MonthlyAverage(
        buckets.map(bucket => ({
          name: textValue(bucket.name),
          creationDate: typeof bucket.creation_date === "string" ? bucket.creation_date : null,
        })),
        storageRows,
        monthStart,
        today,
        storageRows.length >= 10_000,
      )
    : { averageBytes: null, coverageDays: 0, expectedDays: 0 };

  const listOk = listError === null;
  const operationsOk = operationsError === null;
  const storageOk = storageError === null && monthlyAverage.averageBytes !== null &&
    items.every(item => item.currentStorageBytes.state === "available");
  const bandwidthOk = bandwidthError === null;
  const totalCurrentStorage = listOk && items.every(item => item.currentStorageBytes.state === "available")
    ? items.reduce((sum, item) => sum + (item.currentStorageBytes.used ?? 0), 0)
    : null;
  const totalUpload = bandwidthOk ? sumField(bandwidthRows, "bytesUpload") : null;
  const totalDownload = bandwidthOk ? sumField(bandwidthRows, "bytesDownload") : null;

  return {
    state: productState(listOk, operationsOk && storageOk && bandwidthOk),
    resourceState: listOk ? "available" : "error",
    resourceReason: listOk ? null : safeCloudflareError(listError),
    buckets: listOk
      ? cloudflareMetric(buckets.length, null, "个", "当前")
      : errorMetric(listError, "个", "当前"),
    classA: operationsOk
      ? cloudflareMetric(classATotal, CLOUDFLARE_FREE_LIMITS.r2ClassAOperationsPerMonth, "次", "每月")
      : errorMetric(operationsError, "次", "每月", CLOUDFLARE_FREE_LIMITS.r2ClassAOperationsPerMonth),
    classB: operationsOk
      ? cloudflareMetric(classBTotal, CLOUDFLARE_FREE_LIMITS.r2ClassBOperationsPerMonth, "次", "每月")
      : errorMetric(operationsError, "次", "每月", CLOUDFLARE_FREE_LIMITS.r2ClassBOperationsPerMonth),
    monthlyStorage: monthlyAverage.averageBytes === null
      ? storageError
        ? errorMetric(storageError, "GB-month", "每月", 10)
        : missingMetric(
            "日峰值存储采样未覆盖完整周期（覆盖 " + monthlyAverage.coverageDays + "/" + monthlyAverage.expectedDays + " 天），不计算月度额度使用率",
            "GB-month",
            "每月",
            10,
          )
      : cloudflareMetric(
          monthlyAverage.averageBytes / 1_000_000_000,
          10,
          "GB-month",
          "每月",
          true,
          "按本月已覆盖日期的日峰值存储均值估算；不是最终账单值",
        ),
    currentStorageBytes: totalCurrentStorage === null
      ? missingMetric("至少一个 Bucket 缺少当前存储快照", "B", "当前")
      : cloudflareMetric(totalCurrentStorage, null, "B", "当前"),
    uploadBytes: totalUpload === null
      ? errorMetric(bandwidthError, "B", "本月")
      : cloudflareMetric(totalUpload, null, "B", "本月", true, "GraphQL 带宽数据不包含小于 100 KiB 的传输"),
    downloadBytes: totalDownload === null
      ? errorMetric(bandwidthError, "B", "本月")
      : cloudflareMetric(totalDownload, null, "B", "本月", true, "GraphQL 带宽数据不包含小于 100 KiB 的传输"),
    unknownOperations: unknownTotal,
    items,
  };
}

function buildKv(
  namespaces: Obj[],
  operationRows: Obj[],
  storageRows: Obj[],
  listError: unknown | null,
  operationsError: unknown | null,
  storageError: unknown | null,
): CloudflareKvData {
  const operationMap = new Map<string, Record<string, number>>();
  for (const row of operationRows) {
    const dimensions = object(row.dimensions);
    const id = textValue(dimensions?.namespaceId);
    const action = textValue(dimensions?.actionType).toLowerCase();
    if (!id || !action) continue;
    const current = operationMap.get(id) ?? { read: 0, write: 0, delete: 0, list: 0 };
    if (action === "read" || action === "write" || action === "delete" || action === "list") {
      current[action] += numberValue(object(row.sum)?.requests) ?? 0;
    }
    operationMap.set(id, current);
  }

  const latestStorage = new Map<string, { date: string; bytes: number; keys: number }>();
  for (const row of storageRows) {
    const dimensions = object(row.dimensions);
    const id = textValue(dimensions?.namespaceId);
    const date = textValue(dimensions?.date);
    const values = object(row.max);
    const bytes = numberValue(values?.byteCount);
    const keys = numberValue(values?.keyCount);
    if (!id || !date || bytes === null || keys === null) continue;
    const previous = latestStorage.get(id);
    if (!previous || date > previous.date) latestStorage.set(id, { date, bytes, keys });
  }

  const items = namespaces.map(namespace => {
    const id = textValue(namespace.id);
    const title = textValue(namespace.title, id);
    const counts = operationMap.get(id) ?? { read: 0, write: 0, delete: 0, list: 0 };
    const current = latestStorage.get(id);
    return {
      id,
      title,
      read: operationsError === null
        ? cloudflareMetric(counts.read, CLOUDFLARE_FREE_LIMITS.kvReadsPerDay, "次", "每日")
        : errorMetric(operationsError, "次", "每日", CLOUDFLARE_FREE_LIMITS.kvReadsPerDay),
      write: operationsError === null
        ? cloudflareMetric(counts.write, CLOUDFLARE_FREE_LIMITS.kvWritesPerDay, "次", "每日")
        : errorMetric(operationsError, "次", "每日", CLOUDFLARE_FREE_LIMITS.kvWritesPerDay),
      delete: operationsError === null
        ? cloudflareMetric(counts.delete, CLOUDFLARE_FREE_LIMITS.kvDeletesPerDay, "次", "每日")
        : errorMetric(operationsError, "次", "每日", CLOUDFLARE_FREE_LIMITS.kvDeletesPerDay),
      list: operationsError === null
        ? cloudflareMetric(counts.list, CLOUDFLARE_FREE_LIMITS.kvListsPerDay, "次", "每日")
        : errorMetric(operationsError, "次", "每日", CLOUDFLARE_FREE_LIMITS.kvListsPerDay),
      storageBytes: current
        ? cloudflareMetric(current.bytes, null, "B", "当前")
        : storageError
          ? errorMetric(storageError, "B", "当前")
          : missingMetric("官方接口未返回 Namespace 存储快照", "B", "当前"),
      keyCount: current
        ? cloudflareMetric(current.keys, null, "个", "当前")
        : missingMetric("官方接口未返回 Key 数量", "个", "当前"),
    };
  });

  const listOk = listError === null;
  const operationsOk = operationsError === null;
  const storageOk = storageError === null && items.every(item => item.storageBytes.state === "available");
  const totalStorage = listOk && storageOk
    ? items.reduce((sum, item) => sum + (item.storageBytes.used ?? 0), 0)
    : null;
  const total = (key: "read" | "write" | "delete" | "list") =>
    operationRows.reduce((sum, row) => {
      const action = textValue(object(row.dimensions)?.actionType).toLowerCase();
      return sum + (action === key ? (numberValue(object(row.sum)?.requests) ?? 0) : 0);
    }, 0);

  return {
    state: productState(listOk, operationsOk && storageOk),
    resourceState: listOk ? "available" : "error",
    resourceReason: listOk ? null : safeCloudflareError(listError),
    namespaces: listOk
      ? cloudflareMetric(namespaces.length, CLOUDFLARE_FREE_LIMITS.kvNamespaces, "个", "当前")
      : errorMetric(listError, "个", "当前", CLOUDFLARE_FREE_LIMITS.kvNamespaces),
    read: operationsOk
      ? cloudflareMetric(total("read"), CLOUDFLARE_FREE_LIMITS.kvReadsPerDay, "次", "每日")
      : errorMetric(operationsError, "次", "每日", CLOUDFLARE_FREE_LIMITS.kvReadsPerDay),
    write: operationsOk
      ? cloudflareMetric(total("write"), CLOUDFLARE_FREE_LIMITS.kvWritesPerDay, "次", "每日")
      : errorMetric(operationsError, "次", "每日", CLOUDFLARE_FREE_LIMITS.kvWritesPerDay),
    delete: operationsOk
      ? cloudflareMetric(total("delete"), CLOUDFLARE_FREE_LIMITS.kvDeletesPerDay, "次", "每日")
      : errorMetric(operationsError, "次", "每日", CLOUDFLARE_FREE_LIMITS.kvDeletesPerDay),
    list: operationsOk
      ? cloudflareMetric(total("list"), CLOUDFLARE_FREE_LIMITS.kvListsPerDay, "次", "每日")
      : errorMetric(operationsError, "次", "每日", CLOUDFLARE_FREE_LIMITS.kvListsPerDay),
    storageBytes: totalStorage === null
      ? (storageError ? errorMetric(storageError, "B", "当前", CLOUDFLARE_FREE_LIMITS.kvStorageBytes) : missingMetric("至少一个 Namespace 缺少存储快照", "B", "当前", CLOUDFLARE_FREE_LIMITS.kvStorageBytes))
      : cloudflareMetric(totalStorage, CLOUDFLARE_FREE_LIMITS.kvStorageBytes, "B", "当前"),
    items,
  };
}

async function getProjectBuilds(
  token: string,
  accountId: string,
  projectName: string,
  monthStart: string,
): Promise<{ count: number; checkedPages: number; partial: boolean; latestDeploymentAt: string | null }> {
  let page = 1;
  let totalPages = 1;
  let count = 0;
  let checkedPages = 0;
  let partial = false;
  let latestDeploymentAt: string | null = null;
  while (page <= totalPages && page <= MAX_DEPLOYMENT_PAGES) {
    const response = await cloudflareGet(
      token,
      "/accounts/" + accountId + "/pages/projects/" + encodeURIComponent(projectName) + "/deployments",
      { page, per_page: 25 },
    );
    const rows = array(response.result);
    checkedPages += 1;
    const info = object(response.result_info);
    totalPages = numberValue(info?.total_pages) ?? page;
    for (const row of rows) {
      const created = textValue(row.created_on);
      if (!latestDeploymentAt && created) latestDeploymentAt = created;
      if (created >= monthStart && row.is_skipped !== true) count += 1;
    }
    const oldest = textValue(rows[rows.length - 1]?.created_on);
    if (oldest && oldest < monthStart) break;
    if (page >= totalPages) break;
    page += 1;
  }
  if (page <= totalPages && checkedPages >= MAX_DEPLOYMENT_PAGES) partial = true;
  return { count, checkedPages, partial, latestDeploymentAt };
}

async function buildPages(
  token: string,
  accountId: string,
  projects: Obj[],
  listError: unknown | null,
  monthStart: string,
  listComplete: boolean,
): Promise<CloudflarePagesData> {
  if (listError) {
    return {
      state: "error",
      resourceState: "error",
      resourceReason: safeCloudflareError(listError),
      projects: errorMetric(listError, "个", "当前", CLOUDFLARE_FREE_LIMITS.pagesProjects),
      builds: errorMetric(listError, "次", "每月", CLOUDFLARE_FREE_LIMITS.pagesBuildsPerMonth),
      items: [],
    };
  }

  const selected = projects.slice(0, MAX_PAGES_PROJECTS);
  const buildResults = await mapBatched(selected, 2, async project => {
    const name = textValue(project.name);
    try {
      return await getProjectBuilds(token, accountId, name, monthStart);
    } catch (error) {
      return { error, count: 0, checkedPages: 0, partial: true, latestDeploymentAt: null };
    }
  });

  let partial = !listComplete || projects.length > MAX_PAGES_PROJECTS;
  let allSuccessful = true;
  let totalBuilds = 0;
  const items: CloudflarePagesProjectItem[] = selected.map((project, index) => {
    const result = buildResults[index];
    const name = textValue(project.name);
    const domains = Array.isArray(project.domains)
      ? project.domains.filter((value): value is string => typeof value === "string")
      : [];
    if ("error" in result) {
      allSuccessful = false;
      partial = true;
      return {
        name,
        domains,
        deployments: errorMetric(result.error, "次", "每月"),
        checkedPages: 0,
        partial: true,
        latestDeploymentAt: null,
      };
    }
    totalBuilds += result.count;
    if (result.partial) partial = true;
    return {
      name,
      domains,
      deployments: result.partial
        ? cloudflareUnavailable("unavailable", "部署记录分页达到查询上限，当前计数不完整", "次", "每月")
        : cloudflareMetric(result.count, null, "次", "每月", true, "按非跳过 Deployment 记录估算，不等同于 Cloudflare 最终计费计数"),
      checkedPages: result.checkedPages,
      partial: result.partial,
      latestDeploymentAt: result.latestDeploymentAt,
    };
  });

  const builds = allSuccessful && !partial
    ? cloudflareMetric(totalBuilds, CLOUDFLARE_FREE_LIMITS.pagesBuildsPerMonth, "次", "每月", true, "统计所有项目本月非跳过 Deployment 记录；用于构建次数观察，不冒充最终账单")
    : cloudflareUnavailable("unavailable", "至少一个项目的部署记录不完整，不能计算完整月度构建次数", "次", "每月", CLOUDFLARE_FREE_LIMITS.pagesBuildsPerMonth);

  return {
    state: partial ? "partial" : "available",
    resourceState: listComplete ? "available" : "partial",
    resourceReason: listComplete ? null : "Pages 项目列表达到分页查询上限",
    projects: cloudflareMetric(projects.length, CLOUDFLARE_FREE_LIMITS.pagesProjects, "个", "当前"),
    builds,
    items,
  };
}

async function buildDns(
  token: string,
  zones: Obj[],
  listError: unknown | null,
  listComplete: boolean,
): Promise<CloudflareDnsData> {
  if (listError) {
    return {
      state: "error",
      resourceState: "error",
      resourceReason: safeCloudflareError(listError),
      zones: null,
      records: errorMetric(listError, "条", "当前"),
      items: [],
    };
  }

  const results = await mapBatched(zones, 3, async zone => {
    const id = textValue(zone.id);
    const name = textValue(zone.name, id);
    try {
      const response = await cloudflareGet(token, "/zones/" + id + "/dns_records/usage");
      const result = object(response.result);
      const used = numberValue(result?.record_usage);
      const quota = numberValue(result?.record_quota);
      return {
        id,
        name,
        records: used === null
          ? missingMetric("DNS Usage API 未返回 record_usage", "条", "当前")
          : cloudflareMetric(used, quota, "条", "当前"),
      };
    } catch (error) {
      return { id, name, records: errorMetric(error, "条", "当前") };
    }
  });

  const complete = listComplete && results.every(item => item.records.state === "available");
  const total = complete ? results.reduce((sum, item) => sum + (item.records.used ?? 0), 0) : null;
  return {
    state: complete ? "available" : "partial",
    resourceState: listComplete ? "available" : "partial",
    resourceReason: listComplete ? null : "Zone 列表达到分页查询上限",
    zones: listComplete ? zones.length : null,
    records: total === null
      ? missingMetric("至少一个 Zone 的 DNS 使用量不可用", "条", "当前")
      : cloudflareMetric(total, null, "条", "当前"),
    items: results,
  };
}

export async function getCloudflareOverview(token: string, accountId: string): Promise<CloudflareOverview> {
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const today = dayStart.slice(0, 10);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const monthStartDate = monthStart.slice(0, 10);
  const nowIso = now.toISOString();

  const workersQuery = graphqlQuery(
    accountId,
    "workersInvocationsAdaptive(limit:1000,filter:{datetime_geq:\"" + dayStart + "\",datetime_leq:\"" + nowIso + "\"}) { sum { requests errors subrequests } quantiles { cpuTimeP50 cpuTimeP99 } dimensions { scriptName } }",
  );
  const d1Query = graphqlQuery(
    accountId,
    "d1AnalyticsAdaptiveGroups(limit:10000,filter:{date_geq:\"" + today + "\",date_leq:\"" + today + "\"}) { sum { rowsRead rowsWritten } dimensions { databaseId date } } " +
    "d1StorageAdaptiveGroups(limit:10000,filter:{date_geq:\"" + monthStartDate + "\",date_leq:\"" + today + "\"}) { max { databaseSizeBytes } dimensions { databaseId date } }",
  );
  const r2Query = graphqlQuery(
    accountId,
    "r2OperationsAdaptiveGroups(limit:10000,filter:{datetime_geq:\"" + monthStart + "\",datetime_lt:\"" + nowIso + "\"}) { sum { requests } dimensions { bucketName actionType } } " +
    "r2StorageAdaptiveGroups(limit:10000,filter:{datetime_geq:\"" + monthStart + "\",datetime_lt:\"" + nowIso + "\"}) { max { objectCount payloadSize metadataSize } dimensions { bucketName datetime } } " +
    "r2BandwidthUsageAdaptiveGroups(limit:10000,filter:{datetime_geq:\"" + monthStart + "\",datetime_lt:\"" + nowIso + "\"}) { sum { bytesUpload bytesDownload } dimensions { bucketName datetimeHour } }",
  );
  const kvQuery = graphqlQuery(
    accountId,
    "kvOperationsAdaptiveGroups(limit:10000,filter:{date_geq:\"" + today + "\",date_leq:\"" + today + "\"}) { sum { requests } dimensions { namespaceId actionType date } } " +
    "kvStorageAdaptiveGroups(limit:10000,filter:{date_geq:\"" + monthStartDate + "\",date_leq:\"" + today + "\"}) { max { keyCount byteCount } dimensions { namespaceId date } }",
  );

  const [
    workersListResult, d1ListResult, r2ListResult, kvListResult, pagesListResult, zonesListResult,
    workersAnalyticsResult, d1AnalyticsResult, r2AnalyticsResult, kvAnalyticsResult,
  ] = await Promise.allSettled([
    listWorkers(token, accountId),
    listD1(token, accountId),
    listR2(token, accountId),
    listKv(token, accountId),
    listPages(token, accountId),
    listZones(token, accountId),
    cloudflareGraphql(token, workersQuery),
    cloudflareGraphql(token, d1Query),
    cloudflareGraphql(token, r2Query),
    cloudflareGraphql(token, kvQuery),
  ]);

  const warnings: string[] = [];
  const warn = (label: string, result: PromiseSettledResult<unknown>) => {
    if (result.status === "rejected") warnings.push(label + "：" + safeCloudflareError(result.reason));
  };
  warn("Workers 资源清单", workersListResult);
  warn("Workers Analytics", workersAnalyticsResult);
  warn("D1 资源清单", d1ListResult);
  warn("D1 Analytics", d1AnalyticsResult);
  warn("R2 Bucket 清单", r2ListResult);
  warn("R2 Analytics", r2AnalyticsResult);
  warn("KV Namespace 清单", kvListResult);
  warn("KV Analytics", kvAnalyticsResult);
  warn("Pages 项目清单", pagesListResult);
  warn("DNS Zone 清单", zonesListResult);

  const workers = buildWorkers(
    workersListResult.status === "fulfilled" ? workersListResult.value : [],
    workersAnalyticsResult.status === "fulfilled" ? array(workersAnalyticsResult.value.workersInvocationsAdaptive) : [],
    workersListResult.status === "rejected" ? workersListResult.reason : null,
    workersAnalyticsResult.status === "rejected" ? workersAnalyticsResult.reason : null,
  );

  const d1List = d1ListResult.status === "fulfilled" ? d1ListResult.value : { items: [], complete: false };
  const d1Account = d1AnalyticsResult.status === "fulfilled" ? d1AnalyticsResult.value : {};
  const d1 = buildD1(
    d1List.items,
    array(d1Account.d1AnalyticsAdaptiveGroups),
    array(d1Account.d1StorageAdaptiveGroups),
    d1ListResult.status === "rejected" ? d1ListResult.reason : d1List.complete ? null : new CloudflareApiError(502),
    d1AnalyticsResult.status === "rejected" ? d1AnalyticsResult.reason : null,
    d1AnalyticsResult.status === "rejected" ? d1AnalyticsResult.reason : null,
  );
  if (d1ListResult.status === "fulfilled" && !d1List.complete) warnings.push("D1 数据库列表未完整加载");

  const r2List = r2ListResult.status === "fulfilled" ? r2ListResult.value : { items: [], complete: false };
  const r2Account = r2AnalyticsResult.status === "fulfilled" ? r2AnalyticsResult.value : {};
  const r2 = buildR2(
    r2List.items,
    array(r2Account.r2OperationsAdaptiveGroups),
    array(r2Account.r2StorageAdaptiveGroups),
    array(r2Account.r2BandwidthUsageAdaptiveGroups),
    r2ListResult.status === "rejected" ? r2ListResult.reason : r2List.complete ? null : new CloudflareApiError(502),
    r2AnalyticsResult.status === "rejected" ? r2AnalyticsResult.reason : null,
    r2AnalyticsResult.status === "rejected" ? r2AnalyticsResult.reason : null,
    r2AnalyticsResult.status === "rejected" ? r2AnalyticsResult.reason : null,
    monthStart,
    today,
  );
  if (r2ListResult.status === "fulfilled" && !r2List.complete) warnings.push("R2 Bucket 列表未完整加载");

  const kvList = kvListResult.status === "fulfilled" ? kvListResult.value : { items: [], complete: false };
  const kvAccount = kvAnalyticsResult.status === "fulfilled" ? kvAnalyticsResult.value : {};
  const kv = buildKv(
    kvList.items,
    array(kvAccount.kvOperationsAdaptiveGroups),
    array(kvAccount.kvStorageAdaptiveGroups),
    kvListResult.status === "rejected" ? kvListResult.reason : kvList.complete ? null : new CloudflareApiError(502),
    kvAnalyticsResult.status === "rejected" ? kvAnalyticsResult.reason : null,
    kvAnalyticsResult.status === "rejected" ? kvAnalyticsResult.reason : null,
  );
  if (kvListResult.status === "fulfilled" && !kvList.complete) warnings.push("KV Namespace 列表未完整加载");

  const pagesList = pagesListResult.status === "fulfilled" ? pagesListResult.value : { items: [], complete: false };
  const pages = await buildPages(
    token,
    accountId,
    pagesList.items,
    pagesListResult.status === "rejected" ? pagesListResult.reason : null,
    monthStartDate,
    pagesList.complete,
  );
  if (!pagesList.complete) warnings.push("Pages 项目列表未完整加载");
  if (pages.state === "partial") warnings.push("Pages 部分项目的部署记录不完整");

  const zonesList = zonesListResult.status === "fulfilled" ? zonesListResult.value : { items: [], complete: false };
  const dns = await buildDns(
    token,
    zonesList.items,
    zonesListResult.status === "rejected" ? zonesListResult.reason : null,
    zonesList.complete,
  );
  if (!zonesList.complete) warnings.push("DNS Zone 列表未完整加载");
  if (dns.state === "partial") warnings.push("部分 Zone 的 DNS 记录使用量不可用");

  return {
    accountId,
    queriedAt: nowIso,
    dayStart,
    monthStart,
    partial: warnings.length > 0,
    warnings,
    workers,
    d1,
    r2,
    kv,
    pages,
    dns,
  };
}
