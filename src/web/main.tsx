import { useEffect,useState } from "react";
import { createRoot } from "react-dom/client";
import { api,type Account,type Live } from "./api";
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
 if(logged===null)return <div className="center"><span className="spinner"/> 加载中</div>;
 if(!logged)return <main className="auth-page">
   <form className="auth-card" onSubmit={login}>
    <div className="mark">FQ</div><h1>FreeQuota</h1><p>Supabase 多账号免费额度管理</p>
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
    <p>打开页面即查询官方实时数据；无定时任务，也不保存用量历史。</p></div>
    <div className="actions"><button onClick={()=>void refreshAll(accounts)} disabled={!accounts.length}>↻ 刷新全部</button>
    <button className="primary" onClick={()=>{setForm({alias:"",remark:"",token:""});setFormError("");}}>＋ 添加账号</button></div>
   </section>
   <div className="stats"><div className="stat"><span>已管理账号</span><strong>{accounts.length}</strong></div>
    <div className="stat"><span>成功查询</span><strong>{Object.values(live).filter(x=>!!x.data).length}</strong></div>
    <div className="stat"><span>可访问项目（已去重）</span><strong>{new Set(Object.values(live).flatMap(x=>x.data?.projects.map(p=>p.id)||[])).size}</strong></div>
   </div>
   {listError&&<p className="error">{listError}</p>}
   {!accounts.length&&!listError?<div className="empty"><strong>尚未添加 Supabase 账号</strong><p>点击右上角「添加账号」，输入账号别名与 Personal Access Token。</p></div>:null}
   <section className="cards">{accounts.map(a=><article className="card" key={a.id}>
      <div className="card-head"><div><h2>{a.alias}</h2><span className="muted">{a.remark||"未填写备注"}</span></div>
       <div className="card-actions"><button title="刷新" onClick={()=>void refreshOne(a.id)}>↻</button>
       <button onClick={()=>{setForm({id:a.id,alias:a.alias,remark:a.remark,token:""});setFormError("");}}>编辑</button>
       <button className="danger-text" onClick={()=>void deleteAccount(a)}>删除</button></div>
      </div>
      <div className="card-body">{live[a.id]?.loading?<div className="loading"><span className="spinner"/> 正在向 Supabase 查询…</div>:
        live[a.id]?.error?<div className="error">查询失败：{live[a.id].error}<br/><button onClick={()=>void refreshOne(a.id)}>重试</button></div>:
        live[a.id]?.data?<LiveView data={live[a.id].data!}/>:<div className="muted">尚未查询</div>}
      </div>
     </article>)}</section>
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
function formatBytes(bytes:number|null) {
 if(bytes===null)return "—";
 if(bytes===0)return "0 B";
 const units=["B","KiB","MiB","GiB","TiB"];
 const i=Math.min(Math.floor(Math.log(bytes)/Math.log(1024)),units.length-1);
 return (bytes/Math.pow(1024,i)).toLocaleString("zh-CN",{maximumFractionDigits:2})+" "+units[i];
}
function formatCount(n:number|null) {
 return n===null?"—":n.toLocaleString("zh-CN");
}
function statusLine(state:string,reason:string|null) {
 return state==="available" ? "" : (reason || "官方接口未提供数据");
}
function ProjectUsage({p}:{p:import("./api").Project}) {
 const disk=p.usage.disk, req=p.usage.apiRequests;
 return <div className="project-usage">
  <div className="usage-group">
   <div className="usage-heading">
    <strong>数据库磁盘（运行指标）</strong>
    <a href="https://supabase.com/docs/reference/api/v1-get-disk-utilization" rel="noreferrer" target="_blank">官方接口</a>
   </div>
   {disk.state==="available"?<>
    <div className="usage-grid">
     <div><span>已占用</span><b>{formatBytes(disk.usedBytes)}</b></div>
     <div><span>文件系统可用</span><b>{formatBytes(disk.freeBytes)}</b></div>
     <div><span>总容量</span><b>{formatBytes(disk.capacityBytes)}</b></div>
    </div>
    <p className="usage-caption">物理文件系统容量，不等于账单中的数据库大小。
     {disk.sampleAt?" 采样时间："+new Date(disk.sampleAt).toLocaleString("zh-CN"):""}</p>
   </>:<p className="metric-unavailable">{statusLine(disk.state,disk.reason)}</p>}
  </div>
  <div className="usage-group">
   <div className="usage-heading">
    <strong>API 请求统计</strong>
    <a href="https://supabase.com/docs/reference/api/v1-get-project-usage-api-count" rel="noreferrer" target="_blank">官方接口</a>
   </div>
   {req.state==="available"?<>
    <div className="usage-grid">
     <div><span>REST</span><b>{formatCount(req.rest)}</b></div>
     <div><span>Auth</span><b>{formatCount(req.auth)}</b></div>
     <div><span>Storage</span><b>{formatCount(req.storage)}</b></div>
     <div><span>Realtime</span><b>{formatCount(req.realtime)}</b></div>
    </div>
    <p className="usage-caption">官方统计接口返回的请求数，不是本月计费量。
     {req.sampleStart && req.sampleEnd ?
       " 采样范围："+new Date(req.sampleStart).toLocaleString("zh-CN")+" 至 "+new Date(req.sampleEnd).toLocaleString("zh-CN")
       :" 统计窗口由官方接口决定，当前未提供完整起止时间。"}
    </p>
   </>:<p className="metric-unavailable">{statusLine(req.state,req.reason)}</p>}
  </div>
 </div>;
}
function LiveView({data}:{data:Live}) {
 const unique=data.projects.filter((p,i,all)=>all.findIndex(q=>q.id===p.id)===i);
 const freeOrgs=data.organizations.filter(o=>o.plan?.toLowerCase().includes("free"));
 return <div className="live">
  <div className="sync-line"><span className="dot green"/> 查询时间：{new Date(data.queriedAt).toLocaleString("zh-CN")}
   {data.partial&&<span className="warn">部分统计不可用</span>}</div>
  <div className="mini-stats">
   <span>组织 <b>{data.organizations.length}</b></span>
   <span>项目 <b>{unique.length}</b></span>
   <span>运行中 <b>{unique.filter(p=>p.status.toUpperCase().startsWith("ACTIVE")).length}</b></span>
  </div>
  <h3>组织及套餐</h3>
  {data.organizations.length?data.organizations.map(o=><div className="item" key={o.id||o.slug}>
   <span>{o.name} <small>({o.slug})</small>{o.warning&&<small className="metric-unavailable">{o.warning}</small>}</span>
   <span className="pill">{o.plan||"套餐未知"}</span>
  </div>):<p className="muted">没有返回组织详情</p>}
  <h3>项目实际运行数据</h3>
  {unique.length?unique.map(p=><div className="project-section" key={p.id}>
   <div className="item">
    <div><strong>{p.name}</strong><small>{p.id}{p.region?" · "+p.region:""}</small></div>
    <span className={"pill "+(p.status.toUpperCase().startsWith("ACTIVE")?"active":"")}>{p.status}</span>
   </div>
   <ProjectUsage p={p}/>
  </div>):<p className="muted">当前账号无可访问项目</p>}
  <h3>Free 官方套餐限额</h3>
  {freeOrgs.length ? <>
   <p className="usage-caption">适用于 Free 组织：{freeOrgs.map(o=>o.name).join("、")}。标注“组织”的额度不能按项目重复计算；标注“项目”的额度逐项目计算。</p>
   <div className="quota-list">
    {data.freePlanLimits.map(q=><div className="quota-row" key={q.key}>
     <span>{q.label} <small>（{q.scope==="organization"?"组织":"项目"}）</small></span>
     <strong>{q.quota}</strong>
    </div>)}
   </div>
   <p className="usage-caption">上述数值是官方套餐上限，不表示已使用或剩余额度。
    <a href="https://supabase.com/dashboard/org/_/usage" rel="noreferrer" target="_blank"> 查看 Supabase 官方账单用量</a>
   </p>
  </>:<p className="metric-unavailable">目前未识别到已确认的 Free 套餐组织，因此不按 Free 额度估算剩余容量。</p>}
  <div className="quota-note">
   <strong>免费项目参考上限：每用户 2 个活跃 Free 项目</strong>
   <p>新建资格还受组织 Owner/Admin 关系影响。所有用量均为本次按需查询，不保存历史快照。</p>
  </div>
 </div>;
}
createRoot(document.getElementById("root")!).render(<App/>);
