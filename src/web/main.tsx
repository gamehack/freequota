import { useEffect,useState } from "react";
import { createRoot } from "react-dom/client";
import { api,type Account,type Live,type Project } from "./api";
import { summarizeDashboard, isProjectRunning, isProjectPaused, hasVisibleIssues } from "./overview";
import "./styles.css";

type LoadState={loading:boolean;data?:Live;error?:string};
function App(){
 const [logged,setLogged]=useState<boolean|null>(null);
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
  <main className="main">
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
  </main>
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
createRoot(document.getElementById("root")!).render(<App/>);
