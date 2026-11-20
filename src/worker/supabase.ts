type Obj=Record<string,unknown>;
const ENDPOINT="https://api.supabase.com/v1";
function arr(x:unknown):Obj[]{return Array.isArray(x)?x.filter(z=>z&&typeof z==="object") as Obj[]:[];}
export async function supabaseGet(token:string,path:string):Promise<unknown>{
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),9000);
  try{
    const r=await fetch(ENDPOINT+path,{headers:{Authorization:"Bearer "+token,Accept:"application/json"},signal:controller.signal});
    if(!r.ok) throw new Error("Supabase API "+r.status);
    return await r.json();
  }finally{clearTimeout(timeout);}
}
export async function validateSupabase(token:string):Promise<void>{
  await supabaseGet(token,"/projects");
}
function plan(x:Obj):string|null{
  const p=x.plan??x.subscription;
  if(typeof p==="string")return p.toLowerCase();
  if(p&&typeof p==="object"){
    const id=(p as Obj).id??(p as Obj).name??(p as Obj).plan;
    if(typeof id==="string")return id.toLowerCase();
  }
  return null;
}
export async function getSupabaseLive(token:string){
  const [projectResult,orgResult]=await Promise.allSettled([
    supabaseGet(token,"/projects"),
    supabaseGet(token,"/organizations"),
  ]);
  if(projectResult.status==="rejected") throw projectResult.reason;
  const projects=arr(projectResult.value).map(x=>({
    id:String(x.id??""),name:String(x.name??""),
    organization_id:String(x.organization_id??x.organization_slug??""),
    region:String(x.region??""),status:String(x.status??"unknown"),
    created_at:x.created_at??null
  }));
  const rawOrgs=orgResult.status==="fulfilled"?arr(orgResult.value):[];
  // The account/organization relationship can be complex; do not fabricate available project slots.
  const organizations=await Promise.all(rawOrgs.slice(0,12).map(async o=>{
    const slug=String(o.slug??o.id??"");
    let details:Obj=o, warning:string|undefined;
    if(slug){
      try{details=await supabaseGet(token,"/organizations/"+encodeURIComponent(slug)) as Obj;}
      catch(e){warning=String(e);}}
    return {id:String(o.id??details.id??""),slug,
      name:String(o.name??details.name??slug),plan:plan(details)??plan(o),warning};
  }));
  return {
    queriedAt:new Date().toISOString(),
    projects,
    organizations,
    partial:orgResult.status==="rejected" || rawOrgs.length>12 ||
      organizations.some(o=>!!o.warning),
    accountFreeProjectReferenceLimit:2,
    notes:"2 是官方参考活跃免费项目限制，实际剩余创建名额受组织 Owner/Admin 成员关系影响，不能仅以项目数计算。完整计费用量尚无已验证公开接口。",
    metrics:[
      {key:"db_used",name:"数据库实际占用",used:null,limit:null,remaining:null,status:"unsupported"},
      {key:"egress",name:"Egress 流量",used:null,limit:null,remaining:null,status:"unsupported"},
      {key:"storage",name:"Storage 占用",used:null,limit:null,remaining:null,status:"unsupported"},
      {key:"mau",name:"MAU",used:null,limit:null,remaining:null,status:"unsupported"}
    ]
  };
}
