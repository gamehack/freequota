import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const compiled=ts.transpileModule(readFileSync("src/web/overview.ts","utf8"),{
 compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}
}).outputText;
const {summarizeDashboard,isProjectRunning,isProjectPaused,hasVisibleIssues}=
 await import("data:text/javascript,"+encodeURIComponent(compiled));
const project=(id,status,disk="available")=>({id,status,usage:{disk:{state:disk},apiRequests:{state:"error"}}});
const live=(org,items)=>({organizations:org?[{id:org,slug:org,name:org}]:[],projects:items,partial:true});
test("3 accounts, 3 organizations, 6 projects, and 3 running are deduplicated",()=>{
 const a=live("org-a",[project("p1","ACTIVE_HEALTHY"),project("p2","ACTIVE_HEALTHY")]);
 const b=live("org-b",[project("p3","INACTIVE","skipped"),project("p4","INACTIVE","skipped")]);
 const c=live("org-c",[project("p5","ACTIVE_HEALTHY"),project("p6","INACTIVE","skipped")]);
 assert.deepEqual(summarizeDashboard(3,[a,b,c]),{accounts:3,organizations:3,projects:6,active:3});
 assert.deepEqual(summarizeDashboard(4,[a,b,c,a]),{accounts:4,organizations:3,projects:6,active:3});
});
test("paused projects never cause a visible warning",()=>{
 const account=live("org-paused",[project("p1","INACTIVE","skipped"),project("p2","PAUSED","skipped")]);
 assert.equal(hasVisibleIssues(account),false);
 assert.equal(isProjectPaused("INACTIVE"),true);
 assert.equal(isProjectPaused("PAUSED"),true);
 assert.equal(isProjectRunning("INACTIVE"),false);
});
test("hidden API statistics errors do not cause warnings, but disk failures do",()=>{
 const account=live("org-a",[project("p1","ACTIVE_HEALTHY")]);
 assert.equal(hasVisibleIssues(account),false);
 account.projects[0].usage.disk.state="error";
 assert.equal(hasVisibleIssues(account),true);
});
