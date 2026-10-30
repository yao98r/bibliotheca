import {createRemoteJWKSet,jwtVerify} from 'jose';
import {allowedOrigin,loginReturn} from './origins.mjs';
import {fail,random,hash,now,iso,permission,bounded,seal,unseal} from './core.mjs';
import {createDriveTokenCache} from './drive-token-cache.mjs';
const jwks=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const cachedDriveToken=createDriveTokenCache();
export const one=(env,sql,...v)=>env.DB.prepare(sql).bind(...v).first();
export const run=(env,sql,...v)=>env.DB.prepare(sql).bind(...v).run();
export const rows=async(env,sql,...v)=>(await env.DB.prepare(sql).bind(...v).all()).results;
export const setting=async(env,key,fallback=null)=>{const r=await one(env,'SELECT value FROM settings WHERE key=?',key);return r?JSON.parse(r.value):fallback;};
export const setSetting=(env,key,value)=>run(env,'INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,JSON.stringify(value));
export async function userFor(env,email){
 const u=await one(env,'SELECT * FROM users WHERE email=?',email);if(!u)fail(401,'請先登入');
 const p=permission(u,await setting(env,'policy'),email===env.OWNER_EMAIL.toLowerCase());
 if(!p.active)fail(403,'此帳號尚未開放使用，請聯絡管理者');return p;
}
export async function session(request,env){
 const raw=request.headers.get('Authorization')?.match(/^Bearer ([\w-]{43})$/)?.[1];if(!raw)fail(401,'請先登入');
 const s=await one(env,'SELECT * FROM sessions WHERE hash=? AND expires>?',await hash(raw),now());if(!s)fail(401,'登入已過期，請重新登入');
 return {...await userFor(env,s.email),csrf:s.csrf,sessionHash:s.hash};
}
export async function jsonBody(request,limit=32768){
 if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'請傳送 JSON');
 try{return JSON.parse(new TextDecoder().decode(await bounded(request,limit)));}catch(e){if(e.status)throw e;fail(400,'JSON 格式錯誤');}
}
export function csrf(request,body,user,env){
 if(!allowedOrigin(request,env)||body.csrf!==user.csrf)fail(403,'請從本站操作');
}
export async function googleToken(env,params){
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,...params})});
 const data=await r.json().catch(()=>({}));
 if(!r.ok){
  if(params.grant_type==='refresh_token'&&data.error==='invalid_grant')fail(503,'書庫來源連線已到期，請管理者重新連接 Google Drive；你的網站使用權限仍然有效。','DRIVE_RECONNECT_REQUIRED');
  if(params.grant_type==='refresh_token'&&['invalid_client','deleted_client','unauthorized_client'].includes(data.error))fail(503,'書庫的 Google 連線設定有誤，請管理者檢查設定。','DRIVE_CONFIGURATION_ERROR');
  fail(502,'Google 連線暫時無法完成，請稍後重試；若持續發生，請聯絡管理者。');
 }
 return data;
}
export async function driveToken(env){
 if(!env.TOKEN_ENCRYPTION_KEY)fail(503,'尚未設定憑證加密金鑰');
 const stored=await setting(env,'drive');if(!stored||stored.email!==env.OWNER_EMAIL)fail(503,'管理者尚未連接 Google Drive');
 // Still read and validate the current connection for every request. A changed
 // refresh token, client secret or encryption key cannot reuse an old entry.
 const key=JSON.stringify([stored.refresh,env.GOOGLE_CLIENT_ID,env.GOOGLE_CLIENT_SECRET,env.TOKEN_ENCRYPTION_KEY]);
 return cachedDriveToken(key,async()=>googleToken(env,{grant_type:'refresh_token',refresh_token:await unseal(stored.refresh,env.TOKEN_ENCRYPTION_KEY)}));
}
export async function beginAuth(request,env,driveUser=null){
 if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)fail(503,'請先設定 Google OAuth 用戶端');
 if(driveUser&&!env.TOKEN_ENCRYPTION_KEY)fail(503,'請先設定 TOKEN_ENCRYPTION_KEY');
 const url=new URL(request.url),state=random(),verifier=random(),nonce=random(),binding=random();
 const clientState=url.searchParams.get('state'),challenge=url.searchParams.get('challenge');
 const returnTo=loginReturn(request,env);if(!returnTo)fail(400,'登入返回網址無效');
 if(!driveUser&&(!/^[\w-]{43}$/.test(clientState||'')||!/^[\w-]{43}$/.test(challenge||'')))fail(400,'登入參數無效');
 await run(env,'INSERT INTO oauth VALUES (?,?,?)',state,JSON.stringify({nonce,verifier,binding:await hash(binding),clientState,challenge,returnTo,drive:!!driveUser,email:driveUser?.email}),now()+600);
 const target=new URL('https://accounts.google.com/o/oauth2/v2/auth');
 target.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:url.origin+'/auth/callback',response_type:'code',scope:'openid email profile'+(driveUser?' https://www.googleapis.com/auth/drive.readonly':''),state,nonce,code_challenge:await hash(verifier),code_challenge_method:'S256',...(driveUser?{access_type:'offline',prompt:'consent',login_hint:env.OWNER_EMAIL}:{prompt:'select_account'})}).toString();
 return new Response(null,{status:302,headers:{Location:target.href,'Set-Cookie':`oauth_binding=${binding}; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=600`}});
}
export async function callback(request,env){
 const url=new URL(request.url),state=url.searchParams.get('state');
 const stored=await one(env,'SELECT * FROM oauth WHERE state=? AND expires>?',state||'',now());if(!stored)fail(400,'登入已過期');
 const pending=JSON.parse(stored.data),cookie=request.headers.get('cookie')?.match(/(?:^|;\s*)oauth_binding=([\w-]{43})(?:;|$)/)?.[1];
 if(!cookie||await hash(cookie)!==pending.binding)fail(403,'請從原本的登入視窗繼續');
 const consumed=await one(env,'DELETE FROM oauth WHERE state=? RETURNING state',state);if(!consumed)fail(400,'登入資料已使用');
 if(url.searchParams.has('error'))fail(400,'Google 授權未完成，請重試');
 const tokens=await googleToken(env,{code:url.searchParams.get('code')||'',code_verifier:pending.verifier,grant_type:'authorization_code',redirect_uri:url.origin+'/auth/callback'});
 let payload;try{({payload}=await jwtVerify(tokens.id_token,jwks,{issuer:['https://accounts.google.com','accounts.google.com'],audience:env.GOOGLE_CLIENT_ID}));}catch{fail(401,'Google 身分驗證失敗');}
 if(payload.nonce!==pending.nonce||payload.email_verified!==true||typeof payload.email!=='string'||!payload.sub)fail(401,'Google 身分驗證失敗');
 const email=payload.email.toLowerCase();
 if(pending.drive){
   if(email!==env.OWNER_EMAIL.toLowerCase()||pending.email!==email)fail(403,'請使用指定的管理者帳號連接 Drive');
   await userFor(env,email);
   if(!tokens.refresh_token)fail(400,'Google 未提供持續存取授權，請重新連線並同意授權');
   const about=await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',{headers:{Authorization:`Bearer ${tokens.access_token}`}});
   if(!about.ok||(await about.json()).user?.emailAddress?.toLowerCase()!==email)fail(403,'Drive 帳號驗證失敗');
   await setSetting(env,'drive',{email,refresh:await seal(tokens.refresh_token,env.TOKEN_ENCRYPTION_KEY),connectedAt:iso()});
   return Response.redirect(url.origin+'/manage.html?connected=1',303);
 }
 const previous=await one(env,'SELECT * FROM users WHERE email=?',email);
 if(previous?.google_sub&&previous.google_sub!==payload.sub)fail(403,'帳號識別不同，請聯絡管理者');
 await run(env,'INSERT INTO users(email,google_sub,google_name,last_login,level) VALUES (?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET google_sub=excluded.google_sub,google_name=excluded.google_name,last_login=excluded.last_login',email,payload.sub,payload.name||email,iso(),email===env.OWNER_EMAIL.toLowerCase()?'A':'E');
 await userFor(env,email);
 const code=random();await run(env,'INSERT INTO exchanges VALUES (?,?,?,?,?)',await hash(code),email,pending.clientState,pending.challenge,now()+120);
 const data=JSON.stringify({type:'bibliotheca-login',code,state:pending.clientState});
 const dest=(pending.returnTo||url.origin+'/')+'?login_callback=1#'+new URLSearchParams({code,state:pending.clientState});
 return new Response(`<!doctype html><meta charset="utf-8"><title>登入完成</title><p>登入完成，正在返回書庫。</p><script>location.replace(${JSON.stringify(dest)});</script>`,{headers:{'Content-Type':'text/html;charset=utf-8','Set-Cookie':'oauth_binding=; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=0'}});
}
export async function exchange(request,env){
 if(!allowedOrigin(request,env))fail(403,'請從本站登入');
 const b=await jsonBody(request);if(!/^[\w-]{43}$/.test(b.code||'')||!/^[\w-]{43}$/.test(b.state||'')||!/^[\w-]{64}$/.test(b.verifier||''))fail(400,'登入資料無效');
 const codeHash=await hash(b.code),challenge=await hash(b.verifier);
 const record=await one(env,'DELETE FROM exchanges WHERE hash=? AND state=? AND challenge=? AND expires>? RETURNING email',codeHash,b.state,challenge,now());
 if(!record)fail(401,'登入驗證失敗或代碼已使用');await userFor(env,record.email);
 const token=random(),csrf=random(),expiresAt=now()+86400;
 await run(env,'INSERT INTO sessions VALUES (?,?,?,?)',await hash(token),record.email,csrf,expiresAt);
 return Response.json({token,expiresAt});
}
