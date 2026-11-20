import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";
import { encryptToken,decryptToken,EncryptionConfigurationError } from "./crypto";
import { validateSupabase,getSupabaseLive } from "./supabase";
import type { AppEnv } from "./types";
export const accountRoutes=new Hono<AppEnv>();
const validId=(x:string)=>/^[0-9a-f-]{36}$/i.test(x);
accountRoutes.get("/",async c=>{
  const sql=neon(c.env.DATABASE_URL);
  const rows=await sql`SELECT id,alias,remark,created_at,updated_at FROM supabase_accounts ORDER BY created_at`;
  return c.json({accounts:rows});
});
accountRoutes.post("/",async c=>{
  const b=await c.req.json().catch(()=>null);
  const alias=typeof b?.alias==="string"?b.alias.trim():"";
  const remark=typeof b?.remark==="string"?b.remark.trim():"";
  const token=typeof b?.token==="string"?b.token.trim():"";
  if(!alias||alias.length>80||remark.length>500||token.length<10||token.length>512)
    return c.json({error:"账号别名或 Token 格式无效"},400);
  try{await validateSupabase(token);}
  catch(e){return c.json({error:"Supabase Token 验证失败："+String(e)},422);}
  let encrypted: {ciphertext:string;iv:string};
  try { encrypted=await encryptToken(token,c.env.TOKEN_ENCRYPTION_KEY); }
  catch(e) {
    if(e instanceof EncryptionConfigurationError)
      return c.json({error:"服务加密密钥配置错误：请确认 Cloudflare 的 TOKEN_ENCRYPTION_KEY 是 32 字节随机密钥的 Base64 编码",code:"INVALID_ENCRYPTION_KEY"},503);
    console.error("Supabase token encryption error",e instanceof Error?e.name:"unknown");
    return c.json({error:"凭证加密失败，请检查 Worker 日志",code:"ENCRYPTION_FAILED"},500);
  }
  const sql=neon(c.env.DATABASE_URL);
  try{
    const r=await sql`INSERT INTO supabase_accounts(alias,remark,token_ciphertext,token_iv)
      VALUES(${alias},${remark},${encrypted.ciphertext},${encrypted.iv})
      RETURNING id,alias,remark,created_at`;
    return c.json({account:r[0]},201);
  }catch(e){return c.json({error:"保存失败：账号别名可能已存在"},409);}
});
accountRoutes.patch("/:id",async c=>{
  const id=c.req.param("id");if(!validId(id))return c.json({error:"无效账号 ID"},400);
  const b=await c.req.json().catch(()=>null);
  const alias=typeof b?.alias==="string"?b.alias.trim():"";
  const remark=typeof b?.remark==="string"?b.remark.trim():"";
  if(!alias||alias.length>80||remark.length>500)return c.json({error:"别名或备注无效"},400);
  const sql=neon(c.env.DATABASE_URL);
  try{
    let rows;
    if(typeof b?.token==="string"&&b.token.trim()){
      const token=b.token.trim();
      if(token.length<10||token.length>512)return c.json({error:"Token 无效"},400);
      try{await validateSupabase(token);}catch(e){return c.json({error:"新 Token 验证失败："+String(e)},422);}
      let enc: {ciphertext:string;iv:string};
      try { enc=await encryptToken(token,c.env.TOKEN_ENCRYPTION_KEY); }
      catch(e) {
        if(e instanceof EncryptionConfigurationError)
          return c.json({error:"服务加密密钥配置错误：请检查 TOKEN_ENCRYPTION_KEY 的 Base64 格式和长度",code:"INVALID_ENCRYPTION_KEY"},503);
        console.error("Supabase token encryption error",e instanceof Error?e.name:"unknown");
        return c.json({error:"凭证加密失败，请检查 Worker 日志",code:"ENCRYPTION_FAILED"},500);
      }
      rows=await sql`UPDATE supabase_accounts SET alias=${alias},remark=${remark},
        token_ciphertext=${enc.ciphertext},token_iv=${enc.iv},updated_at=now()
        WHERE id=${id} RETURNING id,alias,remark,updated_at`;
    }else{
      rows=await sql`UPDATE supabase_accounts SET alias=${alias},remark=${remark},
        updated_at=now() WHERE id=${id} RETURNING id,alias,remark,updated_at`;
    }
    if(!rows.length)return c.json({error:"账号不存在"},404);
    return c.json({account:rows[0]});
  }catch(e){return c.json({error:"保存失败：别名可能重复"},409);}
});
accountRoutes.delete("/:id",async c=>{
  const id=c.req.param("id");if(!validId(id))return c.json({error:"无效账号 ID"},400);
  const sql=neon(c.env.DATABASE_URL);
  await sql`DELETE FROM supabase_accounts WHERE id=${id}`;
  return c.json({ok:true});
});
accountRoutes.get("/:id/live",async c=>{
  const id=c.req.param("id");if(!validId(id))return c.json({error:"无效账号 ID"},400);
  const sql=neon(c.env.DATABASE_URL);
  const rows=await sql`SELECT token_ciphertext,token_iv FROM supabase_accounts WHERE id=${id} LIMIT 1`;
  if(!rows.length)return c.json({error:"账号不存在"},404);
  try{
    const token=await decryptToken(String(rows[0].token_ciphertext),String(rows[0].token_iv),c.env.TOKEN_ENCRYPTION_KEY);
    const data=await getSupabaseLive(token);
    return c.json(data,200,{"Cache-Control":"no-store"});
  }catch(e){
    const message=String(e);
    const status=message.includes("401")?401:message.includes("403")?403:message.includes("429")?429:502;
    return c.json({error:"Supabase 实时查询失败："+message},status,{"Cache-Control":"no-store"});
  }
});
