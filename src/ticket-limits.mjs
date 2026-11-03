import {fail} from './core.mjs';
const MINUTE_LIMIT=30,HOUR_LIMIT=240;
function limited(){const e=new Error('開啟檔案過於頻繁，請稍候再試。');e.status=429;e.retryAfter=60;throw e;}
export async function checkTicketRate(env,email,time=new Date()){
 const hour=new Date(time.getTime()-3600000).toISOString(),minute=new Date(time.getTime()-60000).toISOString();
 const {results}=await env.DB.prepare('SELECT created_at FROM tickets WHERE email=? AND created_at>? ORDER BY created_at DESC LIMIT ?').bind(email,hour,HOUR_LIMIT).all();
 if(results.length>=HOUR_LIMIT||results.filter(r=>r.created_at>minute).length>=MINUTE_LIMIT)limited();
}
export async function storeLimitedTicket(env,t,sourceMd5){
 const minute=new Date(Date.parse(t.createdAt)-60000).toISOString(),hour=new Date(Date.parse(t.createdAt)-3600000).toISOString();
 const result=await env.DB.batch([
  env.DB.prepare(`INSERT INTO tickets SELECT ?,?,?,?,?,?,?,?,NULL,? WHERE
   (SELECT COUNT(*) FROM (SELECT 1 FROM tickets WHERE email=? AND created_at>? LIMIT ?))<? AND
   (SELECT COUNT(*) FROM (SELECT 1 FROM tickets WHERE email=? AND created_at>? LIMIT ?))<?`)
   .bind(t.hash,t.email,t.book,t.asset,t.action,t.kind,t.code,t.createdAt,t.expires,t.email,minute,MINUTE_LIMIT,MINUTE_LIMIT,t.email,hour,HOUR_LIMIT,HOUR_LIMIT),
  env.DB.prepare("INSERT INTO events SELECT ?,?,?,?,'trace_issue',? FROM tickets WHERE hash=?")
   .bind('trace:'+t.code+':source:'+sourceMd5,t.email,t.book,t.name,t.createdAt,t.hash)
 ]);
 if(result[0].meta.changes!==1)limited();
}
export async function checkDownloadQuota(env,u,asset,today){
 if(u.daily_download_limit===null)return;
 const row=await env.DB.prepare('SELECT EXISTS(SELECT 1 FROM downloads WHERE email=? AND day=? AND asset_id=?) allowed,(SELECT COUNT(*) FROM downloads WHERE email=? AND day=?) used').bind(u.email,today,asset,u.email,today).first();
 if(!row.allowed&&row.used>=u.daily_download_limit)fail(429,'今日下載額度已用完');
}
