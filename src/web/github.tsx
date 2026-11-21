import { useEffect, useState } from "react";
import { api } from "./api";
import {
  GITHUB_FREE_LIMITS,
  type GitHubOverview,
  type GitHubStatus,
  type GitHubProductSummary,
} from "../shared/github";
import "./github.css";

type LoadState = { loading: boolean; data?: GitHubOverview; error?: string };

export function GitHubDashboard() {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [live, setLive] = useState<LoadState>({ loading: false });
  const [credentialOpen, setCredentialOpen] = useState(false);
  const [username, setUsername] = useState("gamehack");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [credentialError, setCredentialError] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    setLive({ loading: true });
    setError("");
    try {
      const data = await api<GitHubOverview>("/github/live");
      setLive({ loading: false, data });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setLive({ loading: false, error: message });
      setError(message);
    }
  }

  async function initialize() {
    try {
      const current = await api<GitHubStatus>("/github/status");
      setStatus(current);
      if (current.username) setUsername(current.username);
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
      await api("/github/credential", {
        method: "PUT",
        body: JSON.stringify({ username, token }),
      });
      setToken("");
      setCredentialOpen(false);
      const current = await api<GitHubStatus>("/github/status");
      setStatus(current);
      await refresh();
    } catch (e) {
      setCredentialError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteCredential() {
    if (!confirm("确认删除 FreeQuota 中保存的 GitHub Token？不会删除 GitHub 账号、仓库或工作流。")) return;
    try {
      await api("/github/credential", { method: "DELETE" });
      setStatus({ configured: false, username: null, updatedAt: null });
      setLive({ loading: false });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (statusLoading) {
    return <main className="main gh-main"><div className="gh-state"><span className="spinner" /> 正在读取 GitHub 配置…</div></main>;
  }

  const data = live.data;
  const actions = data?.summary.products.find(item => item.product.toLowerCase() === "actions") ?? null;

  return <main className="main gh-main">
    <section className="page-heading gh-page-heading">
      <div>
        <div className="eyebrow">GITHUB / BILLING USAGE</div>
        <h1>GitHub 免费额度</h1>
        <p>单账号实时查询个人账单、Actions 计算用量及仓库消耗。所有 GitHub 请求均为只读。</p>
      </div>
      <div className="actions">
        {status?.configured && <button onClick={() => void refresh()} disabled={live.loading}>{live.loading ? "查询中…" : "↻ 刷新用量"}</button>}
        {status?.configured && <button className="danger-text" onClick={() => void deleteCredential()}>删除 Token</button>}
        <button className="primary" onClick={() => { setCredentialError(""); setToken(""); setCredentialOpen(true); }}>
          {status?.configured ? "更换 Token" : "＋ 配置 GitHub"}
        </button>
      </div>
    </section>

    {error && !data && <p className="error">{error}</p>}

    {!status?.configured && <section className="gh-setup">
      <div className="gh-setup-mark">GH</div>
      <h2>尚未配置 GitHub Fine-grained PAT</h2>
      <p>创建只读个人访问令牌，仅授予个人账户的 Plan: Read 权限。FreeQuota 会先验证个人账单汇总接口，再使用现有 AES-256-GCM 密钥加密保存到 Neon。</p>
      <button className="primary" onClick={() => { setCredentialError(""); setCredentialOpen(true); }}>配置 GitHub Token</button>
      <div className="gh-permissions">
        <strong>Fine-grained PAT 最小权限</strong>
        <ul><li>User permissions → Plan → Read</li></ul>
        <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">创建 Fine-grained PAT ↗</a>
        <span>不需要 Contents、Actions、Administration 或仓库写入权限。</span>
      </div>
    </section>}

    {status?.configured && live.loading && <div className="gh-state"><span className="spinner" /> 正在查询 GitHub 官方 Billing API…</div>}
    {status?.configured && live.error && <div className="gh-alert error">查询失败：{live.error}<button onClick={() => void refresh()}>重试</button></div>}

    {data && <>
      <div className="gh-meta">
        <span>GitHub 用户：<strong>{data.username}</strong></span>
        <span>账单月份：{data.period.year}-{String(data.period.month).padStart(2, "0")}</span>
        <span>查询时间：{new Date(data.queriedAt).toLocaleString("zh-CN")}</span>
      </div>
      <div className="gh-note">
        GitHub Free 套餐额度为参考值，不代表已自动识别账号当前套餐。$12 是按美元计价的共享计算额度，不再等同于固定 2,000 分钟。页面按官方原始账单字段展示，不从折扣金额推算免费额度剩余量。
      </div>
      {data.partial && <div className="gh-alert warning">
        账户级汇总可用，但仓库级明细暂不可用：{data.details.reason}
      </div>}

      <section className="gh-summary-grid" aria-label="GitHub 账单概览">
        <Summary label="GitHub Free 计算额度参考" value={"$" + GITHUB_FREE_LIMITS.includedComputeUsd.toFixed(2)} detail="每月共享计算额度" />
        <Summary label="Actions 折前计量金额" value={actions ? money(actions.grossAmount) : "$0.00"} detail="官方 grossAmount" />
        <Summary label="Actions 官方折扣" value={actions ? money(actions.discountAmount) : "$0.00"} detail="官方 discountAmount" />
        <Summary label="Actions 净计费" value={actions ? money(actions.netAmount) : "$0.00"} detail="官方 netAmount" />
      </section>

      <section className="gh-card">
        <header className="gh-card-heading">
          <div><h2>本月产品用量汇总</h2><p>来源：个人 Billing Usage Summary API。金额保持官方返回口径。</p></div>
          <span className="gh-state-tag available">汇总接口成功</span>
        </header>
        {data.summary.products.length ? <div className="gh-table-wrap">
          <table className="gh-table">
            <thead><tr><th>产品</th><th>SKU</th><th>折前金额</th><th>折扣金额</th><th>净计费</th></tr></thead>
            <tbody>{data.summary.products.map((item: GitHubProductSummary) => <tr key={item.product}>
              <td><strong>{item.product}</strong><small>{item.records} 条汇总记录</small></td>
              <td>{item.skus.join("、") || "—"}</td>
              <td>{money(item.grossAmount)}</td><td>{money(item.discountAmount)}</td><td>{money(item.netAmount)}</td>
            </tr>)}</tbody>
          </table>
        </div> : <div className="gh-empty">本月 Billing API 未返回计费用量记录。</div>}
      </section>

      <section className="gh-card">
        <header className="gh-card-heading">
          <div><h2>Actions 仓库消耗排行</h2><p>按官方账单明细中的 repositoryName 汇总，仅统计 product=Actions。</p></div>
          <span className={"gh-state-tag " + data.details.state}>{data.details.state === "available" ? "明细接口成功" : "明细不可用"}</span>
        </header>
        {data.details.state === "unavailable" ? <div className="gh-empty warning-text">{data.details.reason}</div> :
          data.details.repositories.length ? <div className="gh-table-wrap">
            <table className="gh-table">
              <thead><tr><th>仓库</th><th>SKU</th><th>折前金额</th><th>折扣金额</th><th>净计费</th></tr></thead>
              <tbody>{data.details.repositories.map(item => <tr key={item.repositoryName}>
                <td><strong>{item.repositoryName}</strong><small>{item.records} 条账单明细</small></td>
                <td>{item.skus.join("、") || "—"}</td>
                <td>{money(item.grossAmount)}</td><td>{money(item.discountAmount)}</td><td>{money(item.netAmount)}</td>
              </tr>)}</tbody>
            </table>
          </div> : <div className="gh-empty">本月没有返回 Actions 仓库级账单记录。</div>}
      </section>

      <section className="gh-card">
        <header className="gh-card-heading"><div><h2>GitHub Free 套餐额度参考</h2><p>官方包含额度；不代表本次 API 已读取到相同粒度的当前占用量。</p></div></header>
        <div className="gh-limit-grid">
          <Limit label="Actions 共享计算额度" value="$12 / 月" note="按 Runner 与计算资源单价扣减" />
          <Limit label="Actions Artifacts + Packages 存储" value="500 MB" note="两者共享额度，不可重复相加" />
          <Limit label="Actions Cache" value="10 GB / 仓库" note="独立于 Artifacts / Packages" />
          <Limit label="Packages 带宽" value="1 GB / 月" note="Billing API 有记录时展示实际用量" />
          <Limit label="Git LFS 存储" value="10 GB" note="Free 套餐参考值" />
          <Limit label="Git LFS 带宽" value="10 GB / 月" note="Free 套餐参考值" />
          <Limit label="Codespaces 计算" value="120 core-hours / 月" note="与 Actions 计算额度分开" />
          <Limit label="Codespaces 存储" value="15 GB / 月" note="Free 套餐参考值" />
        </div>
      </section>

      <div className="gh-note">
        数据边界：Billing Usage Summary API 处于公开预览；仓库级 Usage Report API 可能要求账号已开放增强账单平台。Artifacts / Packages 存储的计费周期用量不等于当前瞬时占用；Actions Cache 当前容量也不由本版 Plan: Read 权限查询。缺失数据不会按 0 处理。
      </div>
      <div className="gh-links">
        <a href="https://github.com/settings/billing" target="_blank" rel="noreferrer">GitHub Billing & Licensing ↗</a>
        <a href="https://docs.github.com/en/rest/billing/usage?apiVersion=2026-03-10" target="_blank" rel="noreferrer">Billing Usage API 文档 ↗</a>
      </div>
    </>}

    {credentialOpen && <div className="overlay">
      <form className="modal gh-credential-modal" onSubmit={saveCredential}>
        <div className="modal-title"><h2>{status?.configured ? "更换 GitHub Token" : "配置 GitHub Token"}</h2>
          <button type="button" className="quiet" onClick={() => { setToken(""); setCredentialOpen(false); }}>✕</button>
        </div>
        <label>GitHub 用户名
          <input required minLength={1} maxLength={39} pattern="[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?" value={username} onChange={e => setUsername(e.target.value)} />
        </label>
        <label>Fine-grained Personal Access Token
          <input type="password" autoComplete="off" required minLength={20} maxLength={512} placeholder="github_pat_..." value={token} onChange={e => setToken(e.target.value)} />
        </label>
        <div className="gh-permissions gh-modal-permissions">
          <strong>只需要以下权限</strong>
          <ul><li>User permissions → Plan → Read</li></ul>
          <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">打开 GitHub Token 创建页面 ↗</a>
        </div>
        <p className="hint">提交后先调用个人账单汇总接口验证用户名、Token 和 Plan: Read 权限，再加密保存。Token 不会回显、写入前端或日志。不会请求或修改仓库内容。</p>
        {credentialError && <p className="error">{credentialError}</p>}
        <div className="actions">
          <button type="button" onClick={() => { setToken(""); setCredentialOpen(false); }}>取消</button>
          <button className="primary" disabled={saving || !token.trim()}>{saving ? "验证并加密保存…" : "验证并保存"}</button>
        </div>
      </form>
    </div>}
  </main>;
}

function Summary({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="gh-summary"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function Limit({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="gh-limit"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function money(value: number | null): string {
  return value === null ? "不可用" : "$" + value.toFixed(2);
}
