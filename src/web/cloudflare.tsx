import { useEffect, useState } from "react";
import { api } from "./api";
import {
  CLOUDFLARE_DEFAULT_ACCOUNT_ID,
  type CloudflareMetric,
  type CloudflareOverview,
  type CloudflareStatus,
} from "../shared/cloudflare";
import "./cloudflare.css";

type Props = { };
type LoadState = { loading: boolean; data?: CloudflareOverview; error?: string };

export function CloudflareDashboard(_props: Props) {
  const [status, setStatus] = useState<CloudflareStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [live, setLive] = useState<LoadState>({ loading: false });
  const [error, setError] = useState("");
  const [credentialOpen, setCredentialOpen] = useState(false);
  const [accountId, setAccountId] = useState(CLOUDFLARE_DEFAULT_ACCOUNT_ID);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [credentialError, setCredentialError] = useState("");

  async function refresh() {
    setLive({ loading: true });
    setError("");
    try {
      const data = await api<CloudflareOverview>("/cloudflare/live");
      setLive({ loading: false, data });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setLive({ loading: false, error: message });
      setError(message);
    }
  }

  async function initialize() {
    try {
      const current = await api<CloudflareStatus>("/cloudflare/status");
      setStatus(current);
      if (current.accountId) setAccountId(current.accountId);
      if (current.configured) await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatusLoading(false);
    }
  }

  useEffect(() => { void initialize(); }, []);

  async function saveCredential(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setCredentialError("");
    try {
      await api("/cloudflare/credential", {
        method: "PUT",
        body: JSON.stringify({ accountId, token }),
      });
      setToken("");
      setCredentialOpen(false);
      const current = await api<CloudflareStatus>("/cloudflare/status");
      setStatus(current);
      await refresh();
    } catch (e) {
      setCredentialError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteCredential() {
    if (!confirm("确认删除 FreeQuota 中保存的 Cloudflare API Token？不会删除 Cloudflare 账号、Worker、数据库、Bucket 或域名。")) return;
    try {
      await api("/cloudflare/credential", { method: "DELETE" });
      setStatus({ configured: false, accountId: null, updatedAt: null });
      setLive({ loading: false });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (statusLoading) {
    return <main className="main cf-main"><div className="cf-state"><span className="spinner" /> 正在读取 Cloudflare 配置…</div></main>;
  }

  return <main className="main cf-main">
    <section className="page-heading cf-page-heading">
      <div>
        <div className="eyebrow">CLOUDFLARE / FREE PLAN REFERENCE</div>
        <h1>Cloudflare 免费额度</h1>
        <p>单账号实时查询 Workers、D1、R2、KV、Pages 和 DNS。所有 Cloudflare 请求均为只读。</p>
      </div>
      <div className="actions">
        {status?.configured && <button onClick={() => void refresh()} disabled={live.loading}>{live.loading ? "查询中…" : "↻ 刷新全部"}</button>}
        {status?.configured && <button className="danger-text" onClick={() => void deleteCredential()}>删除 Token</button>}
        <button className="primary" onClick={() => { setCredentialError(""); setToken(""); setCredentialOpen(true); }}>
          {status?.configured ? "更换 Token" : "＋ 配置 Cloudflare"}
        </button>
      </div>
    </section>

    {error && !live.data && <p className="error">{error}</p>}

    {!status?.configured && <section className="cf-setup">
      <div className="cf-setup-mark">CF</div>
      <h2>尚未配置 Cloudflare API Token</h2>
      <p>创建一个仅包含读取权限的 API Token。Token 验证后会使用现有 AES-256-GCM 密钥加密保存到 Neon。</p>
      <button className="primary" onClick={() => { setCredentialError(""); setCredentialOpen(true); }}>配置 Cloudflare Token</button>
      <div className="cf-permissions">
        <strong>需要的自定义 Token 权限</strong>
        <ul>
          <li>Account Analytics Read</li>
          <li>Workers Scripts Read</li>
          <li>D1 Read</li>
          <li>Workers R2 Storage Read</li>
          <li>Workers KV Storage Read</li>
          <li>Pages Read</li>
          <li>Zone Zone Read</li>
          <li>Account DNS Settings Read</li>
        </ul>
        <a href="https://developers.cloudflare.com/fundamentals/api/get-started/create-token/" target="_blank" rel="noreferrer">Cloudflare API Token 创建文档 ↗</a>
      </div>
    </section>}

    {status?.configured && live.loading && <div className="cf-state"><span className="spinner" /> 正在查询 Cloudflare 官方 API…</div>}
    {status?.configured && live.error && <div className="cf-alert error">查询失败：{live.error}<button onClick={() => void refresh()}>重试</button></div>}

    {live.data && <>
      <div className="cf-meta">
        <span>Account ID：<code>{live.data.accountId}</code></span>
        <span>统计日：UTC {live.data.dayStart.slice(0, 10)}</span>
        <span>统计月：UTC {live.data.monthStart.slice(0, 7)}</span>
        <span>查询时间：{new Date(live.data.queriedAt).toLocaleString("zh-CN")}</span>
      </div>
      <div className="cf-note">
        页面展示的是 Cloudflare Free 套餐参考额度，不代表已自动识别当前账号的付费计划。部分 GraphQL 指标为运行分析或估算值，具体口径在对应指标中标注。
      </div>
      {live.data.partial && <div className="cf-alert warning">
        部分指标不可用或不完整。缺失数据不会按 0 处理。
        <ul>{live.data.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
      </div>}

      <section className="cf-summary-grid" aria-label="Cloudflare 资源概览">
        <Summary label="Workers" value={live.data.workers.count} />
        <Summary label="D1 数据库" value={live.data.d1.databases.used} />
        <Summary label="R2 Buckets" value={live.data.r2.buckets.used} />
        <Summary label="KV Namespaces" value={live.data.kv.namespaces.used} />
        <Summary label="Pages 项目" value={live.data.pages.projects.used} />
        <Summary label="DNS Zones" value={live.data.dns.zones} />
      </section>

      <section className="cf-product-card">
        <ProductHeading title="Workers" state={live.data.workers.state} description="每日请求额度；CPU 分位数仅用于观察，不作为每日累计额度。" />
        <MetricGrid>
          <MetricCard label="请求次数" metric={live.data.workers.requests} />
          <MetricCard label="错误次数" metric={live.data.workers.errors} />
          <MetricCard label="Subrequests" metric={live.data.workers.subrequests} />
          <MetricCard label="最高 CPU P99" metric={live.data.workers.cpuTimeP99Ms} />
        </MetricGrid>
        <ResourceRows>
          {live.data.workers.items.map(item => <div className="cf-resource-row" key={item.name}>
            <strong title={item.name}>{item.name}</strong>
            <span>{formatNumber(item.requests)} 请求</span>
            <span>{formatNumber(item.errors)} 错误</span>
            <span>{item.cpuTimeP99Ms === null ? "CPU P99 —" : "CPU P99 " + item.cpuTimeP99Ms.toFixed(2) + " ms"}</span>
          </div>)}
        </ResourceRows>
      </section>

      <section className="cf-product-card">
        <ProductHeading title="D1" state={live.data.d1.state} description="Rows Read / Rows Written 按 UTC 日统计；存储按账户全部数据库汇总。" />
        <MetricGrid>
          <MetricCard label="Rows Read" metric={live.data.d1.rowsRead} />
          <MetricCard label="Rows Written" metric={live.data.d1.rowsWritten} />
          <MetricCard label="数据库存储" metric={live.data.d1.storage} formatter={formatBytes} />
          <MetricCard label="数据库数量" metric={live.data.d1.databases} />
        </MetricGrid>
        <ResourceRows>
          {live.data.d1.items.map(item => <div className="cf-resource-row" key={item.id}>
            <strong title={item.id}>{item.name}</strong>
            <span>Read {metricValue(item.rowsRead)}</span>
            <span>Written {metricValue(item.rowsWritten)}</span>
            <span>{formatMetric(item.storage, formatBytes)}</span>
          </div>)}
        </ResourceRows>
      </section>

      <section className="cf-product-card">
        <ProductHeading title="R2" state={live.data.r2.state} description="Class A / B 按月统计。GB-month 根据每日峰值存储采样估算；带宽数据不包含小于 100 KiB 的传输。" />
        <MetricGrid>
          <MetricCard label="Class A" metric={live.data.r2.classA} />
          <MetricCard label="Class B" metric={live.data.r2.classB} />
          <MetricCard label="月均存储（估算）" metric={live.data.r2.monthlyStorage} formatter={value => value.toFixed(3) + " GB-month"} />
          <MetricCard label="当前存储" metric={live.data.r2.currentStorageBytes} formatter={formatBytes} />
        </MetricGrid>
        <div className="cf-inline-stats">
          <span>本月上传：{formatMetric(live.data.r2.uploadBytes, formatBytes)}</span>
          <span>本月下载：{formatMetric(live.data.r2.downloadBytes, formatBytes)}</span>
          {live.data.r2.unknownOperations > 0 && <span className="warning-text">未分类操作：{formatNumber(live.data.r2.unknownOperations)}</span>}
        </div>
        <ResourceRows>
          {live.data.r2.items.map(item => <div className="cf-resource-row" key={item.name}>
            <strong>{item.name}</strong>
            <span>A {metricValue(item.classA)}</span>
            <span>B {metricValue(item.classB)}</span>
            <span>{formatMetric(item.currentStorageBytes, formatBytes)}</span>
          </div>)}
        </ResourceRows>
      </section>

      <section className="cf-product-card">
        <ProductHeading title="Workers KV" state={live.data.kv.state} description="Read、Write、Delete、List 分别按 UTC 日统计；存储按账户 Namespace 汇总。" />
        <MetricGrid>
          <MetricCard label="Read" metric={live.data.kv.read} />
          <MetricCard label="Write" metric={live.data.kv.write} />
          <MetricCard label="Delete" metric={live.data.kv.delete} />
          <MetricCard label="List" metric={live.data.kv.list} />
          <MetricCard label="存储" metric={live.data.kv.storageBytes} formatter={formatBytes} />
          <MetricCard label="Namespace 数量" metric={live.data.kv.namespaces} />
        </MetricGrid>
        <ResourceRows>
          {live.data.kv.items.map(item => <div className="cf-resource-row" key={item.id}>
            <strong title={item.id}>{item.title}</strong>
            <span>R {metricValue(item.read)}</span>
            <span>W {metricValue(item.write)}</span>
            <span>D {metricValue(item.delete)} / L {metricValue(item.list)}</span>
            <span>{formatMetric(item.storageBytes, formatBytes)}</span>
          </div>)}
        </ResourceRows>
      </section>

      <section className="cf-product-card">
        <ProductHeading title="Pages" state={live.data.pages.state} description="500 Builds / 月为 Free 套餐参考。实际展示为本月非跳过 Deployment 记录估算，不等同于最终计费计数。" />
        <MetricGrid>
          <MetricCard label="本月非跳过部署（估算）" metric={live.data.pages.builds} />
          <MetricCard label="项目数量" metric={live.data.pages.projects} />
        </MetricGrid>
        <ResourceRows>
          {live.data.pages.items.map(item => <div className="cf-resource-row cf-page-row" key={item.name}>
            <strong>{item.name}</strong>
            <span>{formatMetric(item.deployments, formatNumber)} 部署</span>
            <span>{item.domains.slice(0, 2).join("、") || "无自定义域名"}</span>
            <span>{item.partial ? "记录不完整" : "已检查 " + item.checkedPages + " 页"}</span>
          </div>)}
        </ResourceRows>
      </section>

      <section className="cf-product-card">
        <ProductHeading title="DNS" state={live.data.dns.state} description="DNS 记录额度由 Cloudflare Usage API 按 Zone 返回，不将多个 Zone 合并成一个全局额度。" />
        <div className="cf-dns-list">
          {live.data.dns.items.map(zone => <MetricCard key={zone.id} label={zone.name} metric={zone.records} formatter={formatNumber} />)}
        </div>
        <p className="cf-footnote">账户 DNS 记录总数：{metricValue(live.data.dns.records)} 条；每个 Zone 独立展示官方 quota。</p>
      </section>
    </>}

    {credentialOpen && <div className="overlay">
      <form className="modal cf-credential-modal" onSubmit={saveCredential}>
        <div className="modal-title"><h2>{status?.configured ? "更换 Cloudflare API Token" : "配置 Cloudflare API Token"}</h2>
          <button type="button" className="quiet" onClick={() => { setToken(""); setCredentialOpen(false); }}>✕</button>
        </div>
        <label>Cloudflare Account ID
          <input required minLength={32} maxLength={32} pattern="[0-9a-fA-F]{32}" value={accountId} onChange={e => setAccountId(e.target.value)} />
        </label>
        <label>Cloudflare API Token
          <input type="password" autoComplete="off" required minLength={20} maxLength={512} placeholder="粘贴自定义只读 API Token" value={token} onChange={e => setToken(e.target.value)} />
        </label>
        <div className="cf-permissions cf-modal-permissions">
          <strong>Token 必须包含以下权限</strong>
          <ul>
            <li>Account Analytics Read</li>
            <li>Workers Scripts Read</li>
            <li>D1 Read</li>
            <li>Workers R2 Storage Read</li>
            <li>Workers KV Storage Read</li>
            <li>Pages Read</li>
            <li>Zone Zone Read</li>
            <li>Account DNS Settings Read</li>
          </ul>
          <a href="https://developers.cloudflare.com/fundamentals/api/get-started/create-token/" target="_blank" rel="noreferrer">查看 Token 创建说明 ↗</a>
        </div>
        <p className="hint">提交时先通过 Cloudflare GraphQL 验证 Account ID 与 Analytics Read 权限，再加密保存。Token 不会回显、写入前端或日志。其余产品权限缺失时会在对应模块单独显示 403。</p>
        {credentialError && <p className="error">{credentialError}</p>}
        <div className="actions">
          <button type="button" onClick={() => { setToken(""); setCredentialOpen(false); }}>取消</button>
          <button className="primary" disabled={saving || !token.trim()}>{saving ? "验证并加密保存…" : "验证并保存"}</button>
        </div>
      </form>
    </div>}
  </main>;
}

function Summary({ label, value }: { label: string; value: number | null | undefined }) {
  return <div className="cf-summary">
    <span>{label}</span>
    <strong>{value === null || value === undefined ? "—" : formatNumber(value)}</strong>
  </div>;
}

function ProductHeading({ title, state, description }: { title: string; state: string; description: string }) {
  const label = state === "available" ? "查询成功" : state === "partial" ? "部分数据不可用" : "查询异常";
  return <header className="cf-product-heading">
    <div><h2>{title}</h2><p>{description}</p></div>
    <span className={"cf-state-tag " + state}>{label}</span>
  </header>;
}

function MetricGrid({ children }: { children: React.ReactNode }) {
  return <div className="cf-metric-grid">{children}</div>;
}

function ResourceRows({ children }: { children: React.ReactNode }) {
  return <div className="cf-resource-list">{children}</div>;
}

function MetricCard({
  label,
  metric,
  formatter = formatNumber,
}: {
  label: string;
  metric: CloudflareMetric;
  formatter?: (value: number) => string;
}) {
  const percent = metric.state === "available" && metric.used !== null && metric.quota !== null && metric.quota > 0
    ? metric.used / metric.quota * 100
    : null;
  const display = metric.state === "available" && metric.used !== null ? formatter(metric.used) : "不可用";
  const quota = metric.quota === null ? "" : " / " + formatter(metric.quota);
  return <div className="cf-metric">
    <div className="cf-metric-head"><span>{label}</span>{metric.estimated && <em>估算</em>}</div>
    <strong>{display}{quota}</strong>
    {percent !== null && <div className="cf-progress"><div className={percent >= 95 ? "critical" : percent >= 80 ? "warning" : ""} style={{ width: Math.min(100, Math.max(0, percent)) + "%" }} /></div>}
    {metric.state !== "available" && metric.reason && <small className="cf-metric-reason">{metric.reason}</small>}
    {metric.note && <small className="cf-metric-note">{metric.note}</small>}
    <small className="cf-period">{metric.period}</small>
  </div>;
}

function metricValue(metric: CloudflareMetric): string {
  return metric.state === "available" && metric.used !== null ? formatNumber(metric.used) : "—";
}

function formatMetric(metric: CloudflareMetric, formatter: (value: number) => string): string {
  return metric.state === "available" && metric.used !== null ? formatter(metric.used) : "不可用";
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("zh-CN");
}

function formatBytes(value: number): string {
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1000)), units.length - 1);
  return (value / Math.pow(1000, index)).toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + " " + units[index];
}
