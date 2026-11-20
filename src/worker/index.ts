import { Hono } from "hono";
import { authRoutes,requireAdmin } from "./auth";
import { accountRoutes } from "./accounts";
import type { AppEnv } from "./types";

const app=new Hono<AppEnv>();
app.use("/api/*",async(c,next)=>{
  c.header("Cache-Control","no-store");
  c.header("X-Content-Type-Options","nosniff");
  c.header("X-Frame-Options","DENY");
  c.header("Referrer-Policy","no-referrer");
  if(c.req.path==="/api/health")return next();
  if(c.req.method!=="GET"){
    const origin=c.req.header("origin");
    if(origin&&origin!==new URL(c.req.url).origin)return c.json({error:"跨站请求被拒绝"},403);
    if(c.req.path!=="/api/auth/login"&&(!origin||origin!==new URL(c.req.url).origin))
      return c.json({error:"请求来源无法验证"},403);
  }
  if(c.req.path==="/api/auth/login")return next();
  return requireAdmin(c,next);
});
app.get("/api/health",c=>c.json({status:"ok",service:"freequota"}));
app.route("/api/auth",authRoutes);
app.route("/api/accounts",accountRoutes);
app.notFound(c=>c.json({error:"Not found"},404));
app.onError((e,c)=>{console.error("request failure",e instanceof Error?e.name:"unknown");return c.json({error:"服务暂时不可用"},500);});
export default app;
