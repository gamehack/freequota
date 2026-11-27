import { useEffect, useState } from "react";
import { api } from "./api";
import {
  INSTABOX_FREE_REFERENCE_LIMITS,
  type InstaboxMetric,
  type InstaboxOverview,
  type InstaboxStatus,
} from "../shared/instabox";
import "./instabox.css";

type LoadState = { loading: boolean; data?: InstaboxOverview; error?: string };

export function InstaboxDashboard() {
  const [status, setStatus] = useState<InstaboxStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [live, setLive] = useState<LoadState>({ loading: false });
  const [credentialOpen, setCredentialOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [credentialError, setCredentialError] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    setLive({ loading: true });
    setError("");
    try {
      const data = await api<InstaboxOverview>("/instabox/live");
      setLive({ loading: false, data });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setLive({ loading: false, error: message });
      setError(message);
    }
  }

  async function initialize() {
    try {
      const current = await api<InstaboxStatus>("/instabox/status");
      setStatus(current);
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
      await api("/instabox/credential", {
        method: "PUT",
        body: JSON.stringify({ apiKey }),
      });
      setApiKey("");
      setCredentialOpen(false);
      const current = await api<InstaboxStatus>("/instabox/status");
      setStatus(current);
      await refresh();
    } catch (e) {
      setCredentialError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteCredential() {
    if (!confirm("确认删除 FreeQuota 中保存的 InstaBox API Key？不会删除 InstaBox Workspace、机器或 Snapshot。")) return;
    try {
      await api("/instabox/credential", { method: "DELETE" });
      setStatus({ configured: false, updatedAt: null });
      setLive({ loading: false });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (statusLoading) {
    return <main className="main ib-main"><div className="ib-state"><span className="spinner" /> 正在读取 InstaBox 配置…</div></main>;
  }

  const data = live.data;

  return <main className="main ib-main">
    <section className="page-heading ib-page-heading">
      <div>
        <div className="eyebrow">INSTABOX / FREE PLAN USAGE</div>
        <h1>InstaBox 免费额度</h1>
        <p>通过官方 Usage API 查询 API Key 所属 Workspace 的机器、Snapshot、存储及月度出口流量。</p>
      </div>
      <div className="actions">
        {status?.configured && <button onClick={() => void refresh()} disabled={live.loading}>{live.loading ? "查询中…" : "↻ 刷新用量"}</button>}
        {status?.configured && <button className="danger-text" onClick={() => void deleteCredential()}>删除 Key</button>}
        <button className="primary" onClick={() => { setCredentialError(""); setApiKey(""); setCredentialOpen(true); }}>
          {status?.configured ? "更换 API Key" : "＋ 配置 InstaBox"}
        </button>
      </div>
    </section>

    {error && !data && <p className="error">{error}</p>}

    {!status?.configured && <section className="ib-setup">
      <div className="ib-setup-mark">IB</div>
      <h2>尚未配置 InstaBox API Key</h2>
      <p>创建一个只读 API Key，FreeQuota 会在服务端验证后使用现有 AES-256-GCM 密钥加密保存。</p>
      <button className="primary" onClick={() => { setCredentialError(""); setCredentialOpen(true); }}>配置 InstaBox API Key</button>
      <div className="ib-permissions">
        <strong>最小权限</strong>
        <ul><li><code>machines:read</code> — 读取机器、操作记录、Metrics 和 Usage</li></ul>
        <a href="https://dashboard.instabox.sh/dashboard/api-keys" target="_blank" rel="noreferrer">打开 InstaBox API Keys 页面 ↗</a>
        <span>创建 Restricted Key，仅勾选 machines:read。不要授予 machines:write、machines:delete 或 workspace:admin。</span>
      </div>
      <div className="ib-doc-links">
        <a href="https://instabox.sh/docs/account/billing" target="_blank" rel="noreferrer">官方 Billing and Usage 文档 ↗</a>
        <a href="https://instabox.sh/docs/account/limits" target="_blank" rel="noreferrer">官方 Limits 文档 ↗</a>
      </div>
    </section>}

    {status?.configured && live.loading && <div className="ib-state"><span className="spinner" /> 正在查询 InstaBox 官方 Usage API…</div>}
    {status?.configured && live.error && <div className="ib-alert error">查询失败：{live.error}<button onClick={() => void refresh()}>重试</button></div>}

    {data && <>
      <div className="ib-meta">
        <span>Workspace：<strong>{data.workspaceName || "API Key 对应 Workspace"}</strong></span>
        <span>套餐：<strong>{data.plan || "官方 API 未返回"}</strong></span>
        <span>查询时间：{new Date(data.queriedAt).toLocaleString("zh-CN")}</span>
        {data.computedAt && <span>用量快照：{formatDate(data.computedAt)}</span>}
        {status?.updatedAt && <span>Key 更新：{formatDate(status.updatedAt)}</span>}
      </div>

      <div className="ib-note">
        机器数量、Snapshot 和存储占用来自 Usage API 的当前计数；月度出口流量来自 cost.egressGiB。官方账单按小时计量，出口流量及费用数据最多可能滞后约 1 小时。
      </div>

      {data.partial && <div className="ib-alert warning">
        部分指标不可用或额度上限未返回。缺失数据不会按 0 处理。
        <ul>{data.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
      </div>}

      <section className="ib-metric-grid" aria-label="InstaBox 当前用量">
        <MetricCard emphasis label="本月出口流量" metric={data.egressGiB} formatter={formatGiB}
          note="重点监控指标。Free 套餐包含 100 GiB/月；优先采用官方 API 返回的动态上限。" />
        <MetricCard label="机器数量" metric={data.machines} formatter={formatCount} />
        <MetricCard label="Snapshot 数量" metric={data.snapshots} formatter={formatCount} />
        <MetricCard label="已存储数据" metric={data.storedBytes} formatter={formatBytes} />
      </section>

      <section className="ib-card">
        <header className="ib-card-heading">
          <div><h2>Workspace 动态限制</h2><p>优先显示官方 API 返回的 limits，不以静态套餐表覆盖实际账户限制。</p></div>
        </header>
        <div className="ib-limit-grid">
          <Limit label="最多机器" value={data.limits.maxMachines} suffix=" 台" />
          <Limit label="同时运行" value={data.limits.maxRunning} suffix=" 台" />
          <Limit label="最多 Snapshot" value={data.limits.maxSnapshots} suffix=" 个" />
          <Limit label="存储上限" value={data.limits.maxStoredGiB} suffix=" GiB" />
          <Limit label="月度 Egress 上限" value={data.limits.maxEgressGiB} suffix=" GiB" missingLabel="未列明" />
          <Limit label="每分钟启动" value={data.limits.maxStartsPerMinute} suffix=" 次" />
        </div>
      </section>

      <section className="ib-card">
        <header className="ib-card-heading">
          <div><h2>本月计量与费用</h2><p>来自官方 cost 对象；Free 套餐机器不收费，但仍可观察运行资源与出口流量。</p></div>
          {data.cost.ratedUntil && <span className="ib-state-tag available">计量截至 {formatDate(data.cost.ratedUntil)}</span>}
        </header>
        <div className="ib-cost-grid">
          <Cost label="本月费用" value={money(data.cost.costUSD)} />
          <Cost label="套餐包含额度" value={money(data.cost.allowanceUSD)} />
          <Cost label="剩余积分" value={money(data.cost.creditsUSD)} />
          <Cost label="已用积分" value={money(data.cost.creditsUsedUSD)} />
          <Cost label="超额用量" value={money(data.cost.overageUSD)} />
          <Cost label="已扣款" value={money(data.cost.chargedUSD)} />
          <Cost label="vCPU Hours" value={quantity(data.cost.vcpuHours, " h")} />
          <Cost label="Memory" value={quantity(data.cost.memGiBHours, " GiB·h")} />
          <Cost label="Storage" value={quantity(data.cost.storageGiBHours, " GiB·h")} />
        </div>
        {(data.cost.periodStart || data.cost.periodEnd) && <p className="ib-period">统计周期（UTC）：{data.cost.periodStart ? formatDate(data.cost.periodStart) : "未知"} — {data.cost.periodEnd ? formatDate(data.cost.periodEnd) : "未知"}</p>}
      </section>

      <section className="ib-card">
        <header className="ib-card-heading"><div><h2>Free 套餐官方参考限制</h2><p>静态参考值仅用于解释套餐，不替代上方账户动态限制。</p></div></header>
        <div className="ib-reference-grid">
          <Limit label="机器数量" value={INSTABOX_FREE_REFERENCE_LIMITS.machines} suffix=" 台" />
          <Limit label="同时运行" value={INSTABOX_FREE_REFERENCE_LIMITS.running} suffix=" 台" />
          <Limit label="Snapshot" value={INSTABOX_FREE_REFERENCE_LIMITS.snapshots} suffix=" 个" />
          <Limit label="Stored Data" value={INSTABOX_FREE_REFERENCE_LIMITS.storedGiB} suffix=" GiB" />
          <Limit label="月度 Egress" value={INSTABOX_FREE_REFERENCE_LIMITS.egressGiB} suffix=" GiB" />
          <Limit label="每分钟启动" value={INSTABOX_FREE_REFERENCE_LIMITS.startsPerMinute} suffix=" 次" />
        </div>
        <p className="ib-period">免费层还限制单机规格（4 vCPU / 8 GiB）、固定空闲暂停时间和单次最长运行时间；具体值以 InstaBox 当前官方 Limits 文档为准。</p>
      </section>

      <div className="ib-doc-links">
        <a href="https://instabox.sh/docs/account/billing" target="_blank" rel="noreferrer">Billing and Usage ↗</a>
        <a href="https://instabox.sh/docs/account/limits" target="_blank" rel="noreferrer">Limits ↗</a>
        <a href="https://instabox.sh/docs/security/api-keys" target="_blank" rel="noreferrer">API Keys & Scopes ↗</a>
      </div>
    </>}

    {credentialOpen && <div className="overlay">
      <form className="modal ib-credential-modal" onSubmit={saveCredential}>
        <div className="modal-title"><h2>{status?.configured ? "更换 InstaBox API Key" : "配置 InstaBox API Key"}</h2>
          <button type="button" className="quiet" onClick={() => { setApiKey(""); setCredentialOpen(false); }}>✕</button>
        </div>
        <label>InstaBox API Key
          <input type="password" autoComplete="off" required minLength={14} maxLength={512} placeholder="ibk_..." value={apiKey} onChange={e => setApiKey(e.target.value)} />
        </label>
        <div className="ib-permissions ib-modal-permissions">
          <strong>只需要以下权限</strong>
          <ul><li><code>machines:read</code></li></ul>
          <a href="https://dashboard.instabox.sh/dashboard/api-keys" target="_blank" rel="noreferrer">打开 InstaBox API Keys 页面 ↗</a>
        </div>
        <p className="hint">提交后先调用 GET /v1/usage 验证 Key 与只读权限，再加密保存到 Neon。Key 不会回显、写入前端或日志。FreeQuota 只调用官方 GET 接口，不创建、启动、暂停或删除任何机器。</p>
        {credentialError && <p className="error">{credentialError}</p>}
        <div className="actions">
          <button type="button" onClick={() => { setApiKey(""); setCredentialOpen(false); }}>取消</button>
          <button className="primary" disabled={saving || !apiKey.trim()}>{saving ? "验证并加密保存…" : "验证并保存"}</button>
        </div>
      </form>
    </div>}
  </main>;
}

function MetricCard({ label, metric, formatter, note, emphasis = false }: {
  label: string;
  metric: InstaboxMetric;
  formatter: (value: number) => string;
  note?: string;
  emphasis?: boolean;
}) {
  const percent = metric.state === "available" && metric.used !== null && metric.quota !== null && metric.quota > 0
    ? metric.used / metric.quota * 100
    : null;
  const used = metric.state === "available" && metric.used !== null ? formatter(metric.used) : "不可用";
  const quota = metric.quota === null ? "" : " / " + formatter(metric.quota);
  return <div className={emphasis ? "ib-metric ib-metric-primary" : "ib-metric"}>
    <span>{label}</span>
    <strong>{used}{quota}</strong>
    {percent !== null && <div className="ib-progress"><div className={percent >= 95 ? "critical" : percent >= 80 ? "warning" : ""} style={{ width: Math.min(100, Math.max(0, percent)) + "%" }} /></div>}
    {note && <small>{note}</small>}
    {metric.state !== "available" && metric.reason && <small>{metric.reason}</small>}
  </div>;
}

function Limit({ label, value, suffix, missingLabel = "未返回" }: { label: string; value: number | null; suffix: string; missingLabel?: string }) {
  return <div className="ib-limit">
    <span>{label}</span>
    <strong>{value === null ? missingLabel : formatCount(value) + suffix}</strong>
  </div>;
}

function Cost({ label, value }: { label: string; value: string }) {
  return <div className="ib-cost"><span>{label}</span><strong>{value}</strong></div>;
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString("zh-CN");
}

function formatBytes(value: number): string {
  if (value === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return (value / Math.pow(1024, index)).toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + " " + units[index];
}

function formatGiB(value: number): string {
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + " GiB";
}

function money(value: number | null): string {
  return value === null ? "不可用" : "$" + value.toFixed(2);
}

function quantity(value: number | null, suffix: string): string {
  return value === null ? "不可用" : value.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) + suffix;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}
