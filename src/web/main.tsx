import { useEffect,useState } from "react";
import { createRoot } from "react-dom/client";
import { api,type Account,type Live,type Project } from "./api";
import { NEON_FREE_LIMITS,isFreeNeonPlan,type NeonMetric,type NeonOrganization,type NeonOverview,type NeonProjectLive,type NeonProjectSummary,type NeonStatus } from "../shared/neon";
import { summarizeDashboard, isProjectRunning, isProjectPaused, hasVisibleIssues } from "./overview";
import "./styles.css";

type LoadState={loading:boolean;data?:Live;error?:string};
function App(){
 const [logged,setLogged]=useState<boolean|null>(null);
 const [activeModule,setActiveModule]=useState<"supabase"|"neon">("supabase");
 const [username,setUsername]=useState("admin");
 const [password,setPassword]=useState("");
 const [authError,setAuthError]=useState("");
 const [authBusy,setAuthBusy]=useState(false);
 const [accounts,setAccounts]=useState<Account[]>([]);
 const [live,setLive]=useState<Record<string,LoadState>>({});
 const [listError,setListError]=useState("");
 const [form,setForm]=useState<{id?:string;alias:string;remark:string;token:string}|null>(null);
 const [formError,setFormError]=useState("");
 const [formBusy,setFormBusy]=useState(false);
 const [changing,setChanging]=useState(false);
 const [oldPassword,setOldPassword]=useState("");
 const [newPassword,setNewPassword]=useState("");
 const [changeError,setChangeError]=useState("");
 useEffect(()=>{void api<{ok:boolean}>("/auth/me").then(()=>setLogged(true)).catch(()=>setLogged(false));},[]);
 useEffect(()=>{if(logged)void loadAccounts(true);},[logged]);
 async function loadAccounts(refresh:boolean){
   setListError("");
   try{
     const result=await api<{accounts:Account[]}>("/accounts");
     setAccounts(result.accounts);
     if(refresh)void refreshAll(result.accounts);
   }catch(e){setListError(String(e));}
 }
 async function refreshOne(id:string){
   setLive(old=>({...old,[id]:{loading:true}}));
   try{
     const data=await api<Live>("/accounts/"+encodeURIComponent(id)+"/live");
     setLive(old=>({...old,[id]:{loading:false,data}}));
   }catch(e){
     setLive(old=>({...old,[id]:{loading:false,error:e instanceof Error?e.message:String(e)}}));
   }
 }
 async function refreshAll(items:Account[]){
   let cursor=0;
   await Promise.all(Array.from({length:Math.min(2,items.length)},async()=>{
     while(cursor<items.length){const current=items[cursor++];await refreshOne(current.id);}
   }));
 }
 async function login(e:React.FormEvent){
   e.preventDefault();setAuthBusy(true);setAuthError("");
   try{await api("/auth/login",{method:"POST",body:JSON.stringify({username,password})});
     setPassword("");setLogged(true);}
   catch(e){setAuthError(e instanceof Error?e.message:String(e));}
   finally{setAuthBusy(false);}
 }
 async function logout(){
   try{await api("/auth/logout",{method:"POST"});}catch{}
   setAccounts([]);setLive({});setLogged(false);
 }
 async function saveAccount(e:React.FormEvent){
   e.preventDefault();if(!form)return;
   setFormBusy(true);setFormError("");
   try{
     await api("/accounts"+(form.id?"/"+form.id:""),{
       method:form.id?"PATCH":"POST",body:JSON.stringify({alias:form.alias,remark:form.remark,token:form.token})});
     setForm(null);void loadAccounts(true);
   }catch(e){setFormError(e instanceof Error?e.message:String(e));}
   finally{setFormBusy(false);}
 }
 async function deleteAccount(a:Account){
   if(!confirm("仅删除 FreeQuota 中的账号配置，不删除 Supabase 项目。确认删除 "+a.alias+"？"))return;
   try{await api("/accounts/"+a.id,{method:"DELETE"});setLive(old=>{const next={...old};delete next[a.id];return next;});void loadAccounts(false);}
   catch(e){alert(e instanceof Error?e.message:String(e));}
 }
 async function changePassword(e:React.FormEvent){
   e.preventDefault();setChangeError("");
   try{
     await api("/auth/password",{method:"PUT",body:JSON.stringify({oldPassword,newPassword})});
     setChanging(false);setOldPassword("");setNewPassword("");setLogged(false);
   }catch(e){setChangeError(e instanceof Error?e.message:String(e));}
 }
 const overview=summarizeDashboard(accounts.length,Object.values(live).map(entry=>entry.data));
 if(logged===null)return <div className="center"><span className="spinner"/> 加载中</div>;
 if(!logged)return <main className="auth-page">
   <form className="auth-card" onSubmit={login}>
    <div className="mark">FQ</div><h1>FreeQuota</h1><p>Supabase 多账号管理控制台</p>
    <label>管理员用户名<input autoComplete="username" maxLength={64} required value={username} onChange={e=>setUsername(e.target.value)}/></label>
    <label>密码<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>
    {authError&&<p className="error">{authError}</p>}
    <button className="primary wide" disabled={authBusy}>{authBusy?"登录中…":"登录"}</button>
    <small>仅供授权管理员使用</small>
   </form>
 </main>;
 return <div className="app">
  <header className="header">
   <div className="brand"><div className="mark small">FQ</div><div><strong>FreeQuota</strong><span>多账号免费额度控制台</span></div></div>
   <div className="header-actions"><button className="quiet" onClick={()=>setChanging(true)}>修改密码</button><button className="quiet" onClick={()=>void logout()}>退出登录</button></div>
  </header>
  <nav className="module-nav" aria-label="资源模块">
   <button type="button" className={activeModule==="supabase"?"selected":""} onClick={()=>setActiveModule("supabase")}>Supabase</button>
   <button type="button" className={activeModule==="neon"?"selected":""} onClick={()=>setActiveModule("neon")}>Neon</button>
  </nav>
  {activeModule==="supabase" ? <main className="main">
   <section className="page-heading"><div><div className="eyebrow">SUPABASE / MANAGEMENT</div><h1>Supabase 账号</h1>
    <p>实时查询组织、项目状态及数据库磁盘运行指标。</p></div>
    <div className="actions"><button onClick={()=>void refreshAll(accounts)} disabled={!accounts.length}>↻ 刷新全部</button>
    <button className="primary" onClick={()=>{setForm({alias:"",remark:"",token:""});setFormError("");}}>＋ 添加账号</button></div>
   </section>
   <div className="stats" aria-label="全局概览">
    <div className="stat"><span>Supabase 账号</span><strong>{overview.accounts}</strong></div>
    <div className="stat"><span>组织（已去重）</span><strong>{overview.organizations}</strong></div>
    <div className="stat"><span>项目（已去重）</span><strong>{overview.projects}</strong></div>
    <div className="stat"><span>运行中</span><strong>{overview.active}</strong></div>
   </div>
   {listError&&<p className="error">{listError}</p>}
   {!accounts.length&&!listError?<div className="empty"><strong>尚未添加 Supabase 账号</strong><p>点击右上角「添加账号」，输入账号别名与 Personal Access Token。</p></div>:null}
   <section className="cards" aria-label="Supabase 账号列表">{accounts.map(a=>{
    const state=live[a.id];
    const queryLabel=state?.loading?"查询中":state?.error?"查询异常":state?.data?(hasVisibleIssues(state.data)?"部分数据异常":"查询成功"):"待查询";
    const queryClass=state?.error?"error":state?.loading?"loading":state?.data?(hasVisibleIssues(state.data)?"warning":"success"):"idle";
    return <article className="card" key={a.id}>
     <header className="card-head">
      <div className="account-identity">
       <h2 title={a.alias}>{a.alias}</h2>
       {a.remark&&<span className="muted account-remark">{a.remark}</span>}
      </div>
      <div className="account-controls">
       <span className={"query-tag "+queryClass} aria-live="polite">{queryLabel}</span>
       <div className="card-actions">
        <button title="刷新此账号" aria-label={"刷新账号 "+a.alias} onClick={()=>void refreshOne(a.id)}>↻</button>
        <button onClick={()=>{setForm({id:a.id,alias:a.alias,remark:a.remark,token:""});setFormError("");}}>编辑</button>
        <button className="danger-text" onClick={()=>void deleteAccount(a)}>删除</button>
       </div>
      </div>
     </header>
     <div className="card-body">
      {state?.loading?<div className="loading"><span className="spinner"/> 正在查询 Supabase 组织及项目…</div>:
       state?.error?<div className="error">查询失败：{state.error}<div><button onClick={()=>void refreshOne(a.id)}>重试</button></div></div>:
       state?.data?<LiveView data={state.data}/>:<div className="muted">尚未查询</div>}
     </div>
    </article>;
   })}</section>
  </main> : <NeonDashboard/>}
  <footer>FreeQuota · 官方 API 实时查询 · 无历史用量存储</footer>
  {form&&<div className="overlay" role="presentation"><form className="modal" onSubmit={saveAccount}>
    <div className="modal-title"><h2>{form.id?"编辑账号":"添加 Supabase 账号"}</h2><button type="button" className="quiet" onClick={()=>setForm(null)}>✕</button></div>
    <label>账号别名<input maxLength={80} required value={form.alias} onChange={e=>setForm({...form,alias:e.target.value})}/></label>
    <label>备注（可选）<input maxLength={500} value={form.remark} onChange={e=>setForm({...form,remark:e.target.value})}/></label>
    <label>Supabase Personal Access Token<input type="password" autoComplete="off" required={!form.id} placeholder={form.id?"留空则保持当前 Token":"输入只读权限 PAT"} value={form.token} onChange={e=>setForm({...form,token:e.target.value})}/></label>
    <p className="hint">Token 仅发送到 Worker 后端，验证后加密保存到 Neon。不会回显。</p>
    {formError&&<p className="error">{formError}</p>}
    <div className="actions"><button type="button" onClick={()=>setForm(null)}>取消</button><button className="primary" disabled={formBusy}>{formBusy?"验证并保存中…":"验证并保存"}</button></div>
   </form></div>}
  {changing&&<div className="overlay"><form className="modal" onSubmit={changePassword}>
    <div className="modal-title"><h2>修改管理员密码</h2><button type="button" className="quiet" onClick={()=>setChanging(false)}>✕</button></div>
    <label>原密码<input type="password" required value={oldPassword} onChange={e=>setOldPassword(e.target.value)}/></label>
    <label>新密码（至少14位）<input type="password" minLength={14} required value={newPassword} onChange={e=>setNewPassword(e.target.value)}/></label>
    {changeError&&<p className="error">{changeError}</p>}
    <button className="primary wide">修改密码并退出所有会话</button>
   </form></div>}
 </div>;
}
function formatBytes(bytes:number|null):string {
 if(bytes===null)return "—";
 if(bytes===0)return "0 B";
 const units=["B","KiB","MiB","GiB","TiB"];
 const i=Math.min(Math.floor(Math.log(bytes)/Math.log(1024)),units.length-1);
 return (bytes/Math.pow(1024,i)).toLocaleString("zh-CN",{maximumFractionDigits:2})+" "+units[i];
}
function projectStatus(status:string):{label:string;type:string} {
 if(isProjectRunning(status))return {label:"运行中",type:"active"};
 if(isProjectPaused(status))return {label:"已暂停",type:"paused"};
 return {label:status||"未知",type:"other"};
}
function ProjectRow({project}:{project:Project}) {
 const status=projectStatus(project.status);
 const disk=project.usage.disk;
 const available=isProjectRunning(project.status)&&disk.state==="available";
 const reason=isProjectPaused(project.status)
   ?"项目已暂停，未查询磁盘指标"
   :disk.reason||"磁盘指标暂不可用";
 return <div className="project-line" role="row">
  <div className="project-identity" role="cell">
   <strong title={project.name}>{project.name}</strong>
   <span title={project.id}>{project.region}{project.region&&" · "}{project.id}</span>
  </div>
  <div role="cell" className="project-state"><span className={"status-tag "+status.type} title={project.status}>{status.label}</span></div>
  <div role="cell" className="project-metrics">
   {available?<div className="project-metrics-grid">
     <div className="project-metric"><span>已占用</span><strong>{formatBytes(disk.usedBytes)}</strong></div>
     <div className="project-metric"><span>可用空间</span><strong>{formatBytes(disk.freeBytes)}</strong></div>
     <div className="project-metric"><span>总容量</span><strong>{formatBytes(disk.capacityBytes)}</strong></div>
    </div>:<span className={"project-unavailable "+(isProjectPaused(project.status)?"muted":"warning")}>{reason}</span>}
  </div>
 </div>;
}
function LiveView({data}:{data:Live}) {
 const unique=data.projects.filter((p,i,all)=>all.findIndex(q=>q.id===p.id)===i);
 const running=unique.filter(p=>isProjectRunning(p.status)).length;
 const warned=hasVisibleIssues(data);
 return <div className="live">
  <div className="account-overview">
   <div className="account-organizations">
    {data.organizations.length?data.organizations.map(o=><div className="org-line" key={o.slug||o.id}>
      <div className="org-identity">
       <strong title={o.name}>{o.name}</strong>
       <small title={o.slug}>{o.slug}</small>
       {o.warning&&<small className="metric-unavailable">{o.warning}</small>}
      </div>
      <span className="plan-tag">{o.plan||"套餐未知"}</span>
     </div>):<span className="metric-unavailable">未获得组织信息</span>}
   </div>
   <div className="account-meta">
    <span className="count-tag">项目 <b>{unique.length}</b></span>
    <span className="count-tag">运行中 <b>{running}</b></span>
    <time dateTime={data.queriedAt} title={"查询于 "+new Date(data.queriedAt).toLocaleString("zh-CN")}>
     {new Date(data.queriedAt).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",second:"2-digit"})} 更新
    </time>
   </div>
   {warned&&<p className="account-warning">部分可见项目的磁盘数据或组织信息不可用</p>}
  </div>
  <div className="projects-heading">项目列表</div>
  {unique.length?<div className="project-table" role="table" aria-label="项目状态与数据库磁盘运行指标">
   <div className="project-table-head" role="row">
    <span role="columnheader">项目</span><span role="columnheader">状态</span>
    <div className="project-metrics-grid" role="columnheader"><span>已占用</span><span>可用空间</span><span>总容量</span></div>
   </div>
   {unique.map(p=><ProjectRow project={p} key={p.id}/>)}
  </div>:<p className="muted empty-projects">暂无可访问项目</p>}
  <p className="disk-footnote">磁盘数据是文件系统运行指标，不代表 Supabase 账单用量。</p>
 </div>;
}

type NeonProjectLoad={loading:boolean;data?:NeonProjectLive;error?:string};

function NeonDashboard(){
 const [status,setStatus]=useState<NeonStatus|null>(null);
 const [statusLoading,setStatusLoading]=useState(true);
 const [overview,setOverview]=useState<NeonOverview|null>(null);
 const [projectLoads,setProjectLoads]=useState<Record<string,NeonProjectLoad>>({});
 const [refreshing,setRefreshing]=useState(false);
 const [error,setError]=useState("");
 const [credentialOpen,setCredentialOpen]=useState(false);
 const [apiKey,setApiKey]=useState("");
 const [saving,setSaving]=useState(false);
 const [credentialError,setCredentialError]=useState("");
 const [progress,setProgress]=useState({done:0,total:0});

 async function loadProjectDetails(projects:NeonProjectSummary[]){
  const initial:Record<string,NeonProjectLoad>={};
  projects.forEach(p=>{initial[p.id]={loading:true};});
  setProjectLoads(initial);
  setProgress({done:0,total:projects.length});
  let cursor=0;
  let done=0;
  await Promise.all(Array.from({length:Math.min(3,projects.length)},async()=>{
   while(true){
    const index=cursor++;
    if(index>=projects.length)return;
    const project=projects[index];
    try{
     const data=await api<NeonProjectLive>("/neon/projects/"+encodeURIComponent(project.id)+"/live");
     setProjectLoads(old=>({...old,[project.id]:{loading:false,data}}));
    }catch(e){
     setProjectLoads(old=>({...old,[project.id]:{loading:false,error:e instanceof Error?e.message:String(e)}}));
    }
    done++;
    setProgress({done,total:projects.length});
   }
  }));
 }

 async function refresh(){
  setRefreshing(true);
  setError("");
  try{
   const data=await api<NeonOverview>("/neon/live");
   setOverview(data);
   const projects=data.organizations.flatMap(org=>org.projects);
   await loadProjectDetails(projects);
  }catch(e){
   setError(e instanceof Error?e.message:String(e));
  }finally{
   setRefreshing(false);
  }
 }

 async function initialize(){
  try{
   const current=await api<NeonStatus>("/neon/status");
   setStatus(current);
   if(current.configured)await refresh();
  }catch(e){
   setError(e instanceof Error?e.message:String(e));
  }finally{
   setStatusLoading(false);
  }
 }

 useEffect(()=>{void initialize();},[]);

 async function refreshProject(projectId:string){
  setProjectLoads(old=>({...old,[projectId]:{loading:true}}));
  try{
   const data=await api<NeonProjectLive>("/neon/projects/"+encodeURIComponent(projectId)+"/live");
   setProjectLoads(old=>({...old,[projectId]:{loading:false,data}}));
  }catch(e){
   setProjectLoads(old=>({...old,[projectId]:{loading:false,error:e instanceof Error?e.message:String(e)}}));
  }
 }

 async function saveCredential(e:React.FormEvent){
  e.preventDefault();
  setSaving(true);
  setCredentialError("");
  try{
   await api("/neon/credential",{method:"PUT",body:JSON.stringify({apiKey})});
   setApiKey("");
   setCredentialOpen(false);
   const current=await api<NeonStatus>("/neon/status").catch(()=>({configured:true,updatedAt:new Date().toISOString()}));
   setStatus(current);
   await refresh();
  }catch(e){
   setCredentialError(e instanceof Error?e.message:String(e));
  }finally{
   setSaving(false);
  }
 }

 async function deleteCredential(){
  if(!confirm("确认删除 FreeQuota 中保存的 Neon API Key？不会删除任何 Neon Organization 或 Project。"))return;
  try{
   await api("/neon/credential",{method:"DELETE"});
   setStatus({configured:false,updatedAt:null});
   setOverview(null);
   setProjectLoads({});
   setProgress({done:0,total:0});
   setError("");
  }catch(e){
   setError(e instanceof Error?e.message:String(e));
  }
 }

 const organizations=overview?.organizations??[];
 const projectCount=overview?.projectCount??0;
 const freeOrganizations=organizations.filter(org=>isFreeNeonPlan(org.plan)).length;

 return <main className="main neon-main">
  <section className="page-heading">
   <div><div className="eyebrow">NEON / FREE PLAN</div><h1>Neon 免费额度</h1>
    <p>按需查询当前 API Key 可访问的组织、项目和 PostgreSQL 用量。</p></div>
   <div className="actions">
    {status?.configured&&<button onClick={()=>void refresh()} disabled={refreshing}>{refreshing?"查询中…":"↻ 刷新全部"}</button>}
    {status?.configured&&<button onClick={()=>{setCredentialError("");setApiKey("");setCredentialOpen(true);}}>更换 API Key</button>}
    {status?.configured&&<button className="danger-text" onClick={()=>void deleteCredential()}>删除 Key</button>}
    {!statusLoading&&<button className="primary" onClick={()=>{setCredentialError("");setApiKey("");setCredentialOpen(true);}}>{status?.configured?"管理凭证":"＋ 配置 Neon"}</button>}
   </div>
  </section>

  {statusLoading?<div className="neon-state"><span className="spinner"/> 正在读取 Neon 配置…</div>:
   status===null?<p className="error">{error||"无法读取 Neon 凭证状态"}</p>:
   !status.configured?<section className="neon-setup">
    <div className="neon-setup-mark">N</div>
    <h2>尚未配置 Neon API Key</h2>
    <p>添加一个 Neon Personal API Key，即可读取该账号有权限访问的全部 Organization 和 Project。</p>
    <button className="primary" onClick={()=>{setCredentialError("");setApiKey("");setCredentialOpen(true);}}>配置 Neon API Key</button>
    <div className="neon-setup-note">
     <strong>推荐使用 Personal API Key</strong>
     <span>Personal API Key 可访问当前用户所属组织中有权限访问的项目。Organization API Key 仅覆盖单个组织，Project-scoped API Key 仅覆盖单个项目。</span>
     <a href="https://console.neon.tech/app/settings/api-keys" target="_blank" rel="noreferrer">前往 Neon 创建 API Key</a>
    </div>
   </section>:
   <>
    {error&&<p className="error">{error}</p>}
    {overview&&<div className="neon-summary-stats">
     <div className="stat"><span>已加载 Organizations</span><strong>{organizations.length}</strong></div>
     <div className="stat"><span>已列出 Projects</span><strong>{projectCount}</strong></div>
     <div className="stat"><span>已加载 Free Organizations</span><strong>{freeOrganizations}</strong></div>
     <div className="stat"><span>项目用量详情</span><strong>{progress.done}/{progress.total}</strong></div>
    </div>}
    {overview&&<div className="neon-data-note">
     <span>查询时间：{new Date(overview.queriedAt).toLocaleString("zh-CN")}</span>
     {status.updatedAt&&<span>API Key 更新：{formatNeonDate(status.updatedAt)}</span>}
     <span>Compute / 数据传输为项目快照，可能延迟，不是账单计量数据；PostgreSQL Storage 按 Branch logical_size 汇总。</span>
    </div>}
    {overview?.partial&&<div className="neon-warning">{overview.warnings.join("；")}</div>}
    {overview&&organizations.length===0&&<div className="empty">当前 API Key 没有可访问的 Organization。</div>}
    {organizations.map(org=><NeonOrganizationCard key={org.id} org={org} projectLoads={projectLoads} onRefreshProject={refreshProject}/>)}
   </>
  }

  {credentialOpen&&<div className="overlay"><form className="modal" onSubmit={saveCredential}>
   <div className="modal-title"><h2>{status?.configured?"更换 Neon API Key":"配置 Neon API Key"}</h2><button type="button" className="quiet" onClick={()=>{setApiKey("");setCredentialOpen(false);}}>✕</button></div>
   <label>Neon Personal API Key
    <input type="password" autoComplete="off" required minLength={10} maxLength={512} placeholder="粘贴 Neon API Key" value={apiKey} onChange={e=>setApiKey(e.target.value)}/>
   </label>
   <p className="hint">提交后 Worker 会先调用 Neon 官方接口验证可访问的 Organization，再使用现有 AES-256-GCM 密钥加密保存。Key 不会回显，也不会写入前端或日志。</p>
   <p className="hint">推荐 Personal API Key。Organization API Key 和 Project-scoped API Key 只会显示其权限范围内的资源。</p>
   {credentialError&&<p className="error">{credentialError}</p>}
   <div className="actions"><button type="button" onClick={()=>{setApiKey("");setCredentialOpen(false);}}>取消</button><button className="primary" disabled={saving||!apiKey.trim()}>{saving?"验证并保存中…":"验证并保存"}</button></div>
  </form></div>}
 </main>;
}

function NeonOrganizationCard({org,projectLoads,onRefreshProject}:{org:NeonOrganization;projectLoads:Record<string,NeonProjectLoad>;onRefreshProject:(id:string)=>void}){
 const free=isFreeNeonPlan(org.plan);
 const storageMetrics=org.projects.map(project=>projectLoads[project.id]?.data?.storage);
 const storageComplete=org.projectListComplete&&(org.projects.length===0||storageMetrics.every(metric=>metric?.state==="available"));
 const storageUsed=storageComplete?storageMetrics.reduce((sum,metric)=>sum+(metric?.used??0),0):null;
 const storageMetric:NeonMetric=storageComplete
  ?{state:"available",used:storageUsed??0,reason:null}
  :{state:"unavailable",used:null,reason:"项目用量尚未全部查询完成"};
 const loaded=org.projects.filter(project=>projectLoads[project.id]?.data||projectLoads[project.id]?.error).length;
 return <section className="neon-org-card">
  <header className="neon-org-head">
   <div className="neon-org-identity"><h2>{org.name}</h2><span>{org.handle||org.id}</span><small>{org.id}</small></div>
   <div className="neon-org-meta"><span className="plan-tag">{org.plan||"套餐未知"}</span><span className="count-tag">{loaded}/{org.projectCount} 项目已查询</span></div>
  </header>
  <div className="neon-org-metrics">
   <NeonMetricRow label="组织 Projects" metric={org.projectListComplete?{state:"available",used:org.projectCount,reason:null}:{state:"unavailable",used:null,reason:org.warning||"组织项目列表未完整获取"}} quota={free?NEON_FREE_LIMITS.projectsPerOrganization:null} format={v=>String(v)+" 个"}/>
   <NeonMetricRow label="组织 PostgreSQL Storage" metric={storageMetric} quota={free?NEON_FREE_LIMITS.postgresStorageBytesPerOrganization:null} format={formatNeonBytes}/>
  </div>
  {org.warning&&<p className="neon-warning">{org.warning}</p>}
  {org.projects.length===0?<p className="muted neon-empty-projects">该组织没有可访问项目。</p>:
   <div className="neon-project-list">{org.projects.map(project=><NeonProjectCard key={project.id} project={project} free={free} load={projectLoads[project.id]} onRefresh={()=>onRefreshProject(project.id)}/>)}</div>}
 </section>;
}

function NeonProjectCard({project,free,load,onRefresh}:{project:NeonProjectSummary;free:boolean;load?:NeonProjectLoad;onRefresh:()=>void}){
 const data=load?.data;
 return <article className="neon-project-card">
  <header className="neon-project-head">
   <div><strong>{project.name}</strong><span>{project.region||"Region 未知"}{project.pgVersion?" · PostgreSQL "+project.pgVersion:""}</span><small>{project.id}</small></div>
   <button onClick={onRefresh} disabled={load?.loading}>{load?.loading?"查询中…":"↻ 刷新"}</button>
  </header>
  {load?.loading?<div className="neon-project-loading"><span className="spinner"/> 正在查询项目快照与 Branch 存储…</div>:
   load?.error?<div className="neon-project-error"><span>{load.error}</span><button onClick={onRefresh}>重试</button></div>:
   data?<div className="neon-project-usage">
    <NeonMetricRow label="Compute" metric={data.compute} quota={free?NEON_FREE_LIMITS.computeCuHoursPerProject:null} format={v=>v.toFixed(2)+" CU-hours"}/>
    <NeonMetricRow label="PostgreSQL Storage" metric={data.storage} quota={free?NEON_FREE_LIMITS.postgresStorageBytesPerProject:null} format={formatNeonBytes}/>
    <NeonMetricRow label="数据传输（项目快照）" metric={data.transfer} quota={free?NEON_FREE_LIMITS.publicTransferBytesPerProject:null} format={formatNeonBytes}/>
    <NeonMetricRow label="Branches" metric={data.branches} quota={free?NEON_FREE_LIMITS.branchesPerProject:null} format={v=>String(v)+" 个"}/>
    {(data.periodStart||data.periodEnd)&&<p className="neon-period">Compute / 数据传输统计周期：{data.periodStart?formatNeonDate(data.periodStart):"未知"} — {data.periodEnd?formatNeonDate(data.periodEnd):"未知"}</p>}
    {data.branchItems.length>0&&<details className="neon-branches"><summary>查看 Branch 明细（{data.branchItems.length}）</summary>
     {data.branchItems.map(branch=><div className="neon-branch-row" key={branch.id}>
      <span><strong>{branch.name}</strong>{branch.isDefault&&<em>默认</em>}<small>{branch.currentState}</small></span>
      <b>{branch.logicalSizeBytes===null?"存储不可用":formatNeonBytes(branch.logicalSizeBytes)}</b>
     </div>)}
    </details>}
   </div>:<div className="neon-project-loading">等待查询…</div>}
 </article>;
}

function NeonMetricRow({label,metric,quota,format}:{label:string;metric:NeonMetric;quota:number|null;format:(value:number)=>string}){
 const percent=metric.state==="available"&&metric.used!==null&&quota!==null?metric.used/quota*100:null;
 const used=metric.state==="available"&&metric.used!==null?format(metric.used):"不可用";
 return <div className="neon-metric-row">
  <div className="neon-metric-heading"><span>{label}</span><strong>{used}{quota!==null?" / "+format(quota):""}</strong></div>
  {percent!==null&&<div className="neon-progress"><div className={percent>=95?"critical":percent>=80?"warning":""} style={{width:Math.min(100,Math.max(0,percent))+"%"}}/></div>}
  {metric.state!=="available"&&metric.reason&&<small className="neon-metric-reason">{metric.reason}</small>}
 </div>;
}

function formatNeonBytes(bytes:number):string{
 if(bytes===0)return "0 B";
 const units=["B","KB","MB","GB","TB"];
 const index=Math.min(Math.floor(Math.log(bytes)/Math.log(1000)),units.length-1);
 return (bytes/Math.pow(1000,index)).toLocaleString("zh-CN",{maximumFractionDigits:2})+" "+units[index];
}

function formatNeonDate(value:string):string{
 const date=new Date(value);
 return Number.isNaN(date.getTime())?value:date.toLocaleString("zh-CN");
}

createRoot(document.getElementById("root")!).render(<App/>);
