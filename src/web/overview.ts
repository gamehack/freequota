import type {Live,Project} from "./api";
export function isProjectRunning(status:string):boolean {
 return typeof status==="string" && status.toUpperCase().startsWith("ACTIVE");
}
export function isProjectPaused(status:string):boolean {
 const value=status?.toUpperCase()??"";
 return value==="INACTIVE" || value.includes("PAUSED");
}
export function hasVisibleIssues(data:Live):boolean {
 const organizationUnavailable=data.projects.length>0 && data.organizations.length===0;
 const organizationFailed=data.organizations.some(o=>Boolean(o.warning));
 const diskFailed=data.projects.some(p=>isProjectRunning(p.status) && p.usage.disk.state!=="available");
 return organizationUnavailable || organizationFailed || diskFailed;
}
export function summarizeDashboard(
 accountCount:number, liveResults:ReadonlyArray<Live|undefined>
):{accounts:number;organizations:number;projects:number;active:number} {
 const organizations=new Set<string>();
 const projects=new Map<string,Project>();
 liveResults.forEach((result,accountIndex)=>{
  if(!result)return;
  result.organizations.forEach((org,orgIndex)=>{
   organizations.add(org.slug||org.id||"unknown-"+accountIndex+"-"+orgIndex);
  });
  result.projects.forEach((project,index)=>{
   const key=project.id||"unknown-"+accountIndex+"-"+index;
   if(!projects.has(key))projects.set(key,project);
   else if(isProjectRunning(project.status))projects.set(key,project);
  });
 });
 return {
  accounts:accountCount,
  organizations:organizations.size,
  projects:projects.size,
  active:[...projects.values()].filter(p=>isProjectRunning(p.status)).length,
 };
}
