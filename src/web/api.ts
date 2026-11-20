export type Account={id:string;alias:string;remark:string;created_at:string;updated_at?:string};
export type Project={id:string;name:string;organization_id:string;region:string;status:string;created_at:string|null};
export type Org={id:string;slug:string;name:string;plan:string|null;warning?:string};
export type Live={
  queriedAt:string;projects:Project[];organizations:Org[];
  partial:boolean;accountFreeProjectReferenceLimit:number;notes:string;
  metrics:{key:string;name:string;used:number|null;limit:number|null;remaining:number|null;status:string}[];
};
export async function api<T>(path:string, init:RequestInit={}):Promise<T>{
  const response=await fetch("/api"+path,{credentials:"same-origin",cache:"no-store",
    headers:{"Content-Type":"application/json",...(init.headers||{})},...init});
  const json=await response.json().catch(()=>({error:"服务返回无效内容"}));
  if(!response.ok) throw new Error(json.error||"HTTP "+response.status);
  return json as T;
}
