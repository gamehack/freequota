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
function LiveView({data}:{data:Live}){
 const unique=data.projects.filter((p,i,all)=>all.findIndex(q=>q.id===p.id)===i);
 return <div className="live">
  <div className="sync-line"><span className="dot green"/> 查询时间：{new Date(data.queriedAt).toLocaleString("zh-CN")}
   {data.partial&&<span className="warn">部分组织信息未获取</span>}</div>
  <div className="mini-stats"><span>组织 <b>{data.organizations.length}</b></span>
   <span>可访问项目 <b>{unique.length}</b></span>
   <span>运行中 <b>{unique.filter(p=>p.status.toUpperCase().startsWith("ACTIVE")).length}</b></span></div>
  <h3>组织及套餐</h3>
  {data.organizations.length?data.organizations.map(o=><div className="item" key={o.id||o.slug}>
    <span>{o.name} <small>({o.slug})</small></span><span className="pill">{o.plan||"未知套餐"}</span>
   </div>):<p className="muted">未获得组织详情</p>}
  <h3>项目</h3>
  {unique.length?unique.map(p=><div className="item" key={p.id}>
    <div><strong>{p.name}</strong><small>{p.id}{p.region?" · "+p.region:""}</small></div>
    <span className={"pill "+(p.status.toUpperCase().startsWith("ACTIVE")?"active":"")}>{p.status}</span>
   </div>):<p className="muted">当前账号无可访问项目</p>}
  <div className="quota-note"><strong>免费项目参考限制：每用户 2 个活跃 Free 项目</strong>
   <p>实际能否新建项目受组织 Owner/Admin 成员关系影响，不能简单用 2 减去项目数量。</p></div>
  <details><summary>其他免费额度指标</summary>
   {data.metrics.map(m=><div className="item" key={m.key}><span>{m.name}</span><span className="muted">官方完整用量接口尚未验证</span></div>)}
  </details>
 </div>;
}
createRoot(document.getElementById("root")!).render(<App/>);
