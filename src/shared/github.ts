export const GITHUB_FREE_LIMITS = {
  includedComputeUsd: 12,
  actionsAndPackagesStorageBytes: 500 * 1024 * 1024,
  actionsCachePerRepositoryBytes: 10 * 1024 * 1024 * 1024,
  codespacesCoreHours: 120,
  codespacesStorageGb: 15,
  packagesBandwidthGb: 1,
  gitLfsStorageGb: 10,
  gitLfsBandwidthGb: 10,
} as const;

export type GitHubUsageItem = {
  date: string | null;
  product: string;
  sku: string;
  unitType: string | null;
  quantity: number | null;
  pricePerUnit: number | null;
  grossAmount: number | null;
  discountAmount: number | null;
  netAmount: number | null;
  repositoryName: string | null;
};

export type GitHubProductSummary = {
  product: string;
  grossAmount: number | null;
  discountAmount: number | null;
  netAmount: number | null;
  records: number;
  skus: string[];
};

export type GitHubRepositoryUsage = {
  repositoryName: string;
  grossAmount: number | null;
  discountAmount: number | null;
  netAmount: number | null;
  records: number;
  skus: string[];
};

export type GitHubOverview = {
  username: string;
  queriedAt: string;
  period: { year: number; month: number };
  planReference: "GitHub Free";
  summary: {
    usageItems: GitHubUsageItem[];
    products: GitHubProductSummary[];
    grossAmount: number | null;
    discountAmount: number | null;
    netAmount: number | null;
  };
  details: {
    state: "available" | "unavailable";
    reason: string | null;
    usageItems: GitHubUsageItem[];
    repositories: GitHubRepositoryUsage[];
  };
  partial: boolean;
  notes: string[];
};

export type GitHubStatus = {
  configured: boolean;
  username: string | null;
  updatedAt: string | null;
};

type Obj = Record<string, unknown>;

function array(value: unknown): Obj[] {
  return Array.isArray(value)
    ? value.filter((item): item is Obj => !!item && typeof item === "object" && !Array.isArray(item))
    : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sum(values: Array<number | null>): number | null {
  if (values.length === 0) return 0;
  if (values.some(value => value === null)) return null;
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

export function parseGitHubUsageItems(value: unknown): GitHubUsageItem[] {
  return array(value).map(item => ({
    date: text(item.date),
    product: text(item.product) ?? "Unknown",
    sku: text(item.sku) ?? "Unknown",
    unitType: text(item.unitType),
    quantity: numeric(item.quantity),
    pricePerUnit: numeric(item.pricePerUnit),
    grossAmount: numeric(item.grossAmount),
    discountAmount: numeric(item.discountAmount),
    netAmount: numeric(item.netAmount),
    repositoryName: text(item.repositoryName),
  }));
}

export function aggregateGitHubProducts(items: GitHubUsageItem[]): GitHubProductSummary[] {
  const grouped = new Map<string, GitHubUsageItem[]>();
  for (const item of items) {
    const current = grouped.get(item.product) ?? [];
    current.push(item);
    grouped.set(item.product, current);
  }
  return [...grouped.entries()].map(([product, rows]) => ({
    product,
    grossAmount: sum(rows.map(row => row.grossAmount)),
    discountAmount: sum(rows.map(row => row.discountAmount)),
    netAmount: sum(rows.map(row => row.netAmount)),
    records: rows.length,
    skus: [...new Set(rows.map(row => row.sku))].sort(),
  })).sort((a, b) => (b.grossAmount ?? -1) - (a.grossAmount ?? -1));
}

export function aggregateGitHubRepositories(items: GitHubUsageItem[]): GitHubRepositoryUsage[] {
  const grouped = new Map<string, GitHubUsageItem[]>();
  for (const item of items) {
    if (item.product.toLowerCase() !== "actions") continue;
    const key = item.repositoryName ?? "（未归属仓库）";
    const current = grouped.get(key) ?? [];
    current.push(item);
    grouped.set(key, current);
  }
  return [...grouped.entries()].map(([repositoryName, rows]) => ({
    repositoryName,
    grossAmount: sum(rows.map(row => row.grossAmount)),
    discountAmount: sum(rows.map(row => row.discountAmount)),
    netAmount: sum(rows.map(row => row.netAmount)),
    records: rows.length,
    skus: [...new Set(rows.map(row => row.sku))].sort(),
  })).sort((a, b) => (b.grossAmount ?? -1) - (a.grossAmount ?? -1));
}
