import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { neon } from "@neondatabase/serverless";
import { newSessionToken, sha256 } from "./crypto";
import type { AppEnv } from "./types";

export const authRoutes = new Hono<AppEnv>();
export const COOKIE = "__Host-freequota";

export async function requireAdmin(c: any, next: () => Promise<void>) {
  const raw = getCookie(c, COOKIE);
  if (!raw) return c.json({error:"请先登录"},401);
  const sql = neon(c.env.DATABASE_URL);
  const rows = await sql`SELECT s.admin_id FROM admin_sessions s
    INNER JOIN admin_users a ON a.id=s.admin_id
    WHERE s.token_hash=${await sha256(raw)} AND s.expires_at>now()
    LIMIT 1`;
  if (!rows.length) return c.json({error:"登录已失效"},401);
  c.set("adminId",rows[0].admin_id as string);
  await next();
}

authRoutes.post("/login", async c => {
  const body = await c.req.json().catch(()=>null);
  const username = typeof body?.username==="string" ? body.username.trim() : "";
  const password = typeof body?.password==="string" ? body.password : "";
  if (!username || !password || username.length>64 || password.length>256)
    return c.json({error:"用户名或密码错误"},401);
  const sql = neon(c.env.DATABASE_URL);
  // One-time bootstrap: a high-entropy password stored only in Cloudflare Secrets.
  // Once an admin exists this branch is inert. Delete the secret after first login.
  if (username === "admin" && c.env.ADMIN_BOOTSTRAP_PASSWORD &&
      password.length >= 14 && password === c.env.ADMIN_BOOTSTRAP_PASSWORD) {
    const existing = await sql`SELECT count(*)::int AS n FROM admin_users`;
    if (Number(existing[0]?.n) === 0) {
      await sql`INSERT INTO admin_users(username,password_hash)
        VALUES('admin',crypt(${password},gen_salt('bf',10)))
        ON CONFLICT (username) DO NOTHING`;
    }
  }
  const users = await sql`SELECT id,password_hash,locked_until FROM admin_users WHERE username=${username} LIMIT 1`;
  const u = users[0];
  if (!u || (u.locked_until && new Date(String(u.locked_until)).getTime()>Date.now()))
    return c.json({error:"用户名或密码错误，或账户暂时锁定"},401);
  const result = await sql`SELECT (${password} = crypt(${password}, ${u.password_hash})) AS ok`;
  if (result[0]?.ok !== true) {
    await sql`UPDATE admin_users SET
      locked_until=CASE WHEN failed_attempts+1>=5 THEN now()+interval '15 minutes' ELSE locked_until END,
      failed_attempts=CASE WHEN locked_until<now() THEN 1 ELSE failed_attempts+1 END
      WHERE id=${u.id}`;
    return c.json({error:"用户名或密码错误"},401);
  }
  await sql`UPDATE admin_users SET failed_attempts=0,locked_until=NULL WHERE id=${u.id}`;
  const raw = newSessionToken();
  await sql`INSERT INTO admin_sessions(token_hash,admin_id,expires_at)
    VALUES(${await sha256(raw)},${u.id},now()+interval '7 days')`;
  setCookie(c,COOKIE,raw,{httpOnly:true,secure:true,sameSite:"Strict",path:"/",maxAge:604800});
  return c.json({ok:true,username});
});

authRoutes.get("/me", async c => c.json({ok:true}));
authRoutes.post("/logout", async c => {
  const raw=getCookie(c,COOKIE);
  if(raw){const sql=neon(c.env.DATABASE_URL);await sql`DELETE FROM admin_sessions WHERE token_hash=${await sha256(raw)}`;}
  deleteCookie(c,COOKIE,{path:"/",secure:true});
  return c.json({ok:true});
});
authRoutes.put("/password",async c=>{
  const body=await c.req.json().catch(()=>null);
  const old=body?.oldPassword, password=body?.newPassword;
  if(typeof old!=="string"||typeof password!=="string"||password.length<14||password.length>128)
    return c.json({error:"新密码至少14位"},400);
  const sql=neon(c.env.DATABASE_URL);
  const check=await sql`SELECT (${old}=crypt(${old},password_hash)) AS ok FROM admin_users WHERE id=${c.get("adminId")}`;
  if(check[0]?.ok!==true) return c.json({error:"原密码错误"},403);
  await sql`UPDATE admin_users SET password_hash=crypt(${password},gen_salt('bf',10)),
    failed_attempts=0,locked_until=NULL,updated_at=now() WHERE id=${c.get("adminId")}`;
  await sql`DELETE FROM admin_sessions WHERE admin_id=${c.get("adminId")}`;
  deleteCookie(c,COOKIE,{path:"/",secure:true});
  return c.json({ok:true});
});
