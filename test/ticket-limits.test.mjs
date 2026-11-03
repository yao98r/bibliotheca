import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {storeLimitedTicket,checkTicketRate,checkDownloadQuota} from '../src/ticket-limits.mjs';
let mf,env;
before(async()=>{
 mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-07-01',d1Databases:['DB']});env={DB:await mf.getD1Database('DB')};
 for(const name of ['0001','0006'])for(const sql of (await readFile('migrations/'+name+'.sql','utf8')).split(';').map(s=>s.trim()).filter(Boolean))await env.DB.prepare(sql).run();
});
after(async()=>{await mf?.dispose();});
const ticket=(n,email='burst@example.com',createdAt=new Date().toISOString())=>({hash:'hash-'+email+n,email,book:'ref',asset:'file',action:'open',kind:'view',code:'trace-'+n,createdAt,expires:2000000000,name:'fixture.pdf'});
test('concurrent ticket creation is bounded without orphan trace events',async()=>{
 const results=await Promise.allSettled(Array.from({length:50},(_,n)=>storeLimitedTicket(env,ticket(n),'checksum')));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,30);
 for(const r of results.filter(r=>r.status==='rejected')){assert.equal(r.reason.status,429);assert.equal(r.reason.retryAfter,60);}
 assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM events').first()).n,30);
 await assert.rejects(checkTicketRate(env,'burst@example.com'),e=>e.status===429);
 await checkTicketRate(env,'other@example.com');
});
test('hourly ticket ceiling and expiry are checked against the sliding time window',async()=>{
 const time=new Date(),email='hour@example.com';
 for(let n=0;n<240;n++)await env.DB.prepare('INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,NULL,?)').bind('hour-'+n,email,'ref','file','open','view','code-'+n,new Date(time.getTime()-120000-n*1000).toISOString(),2000000000).run();
 await assert.rejects(checkTicketRate(env,email,time),e=>e.status===429);
 await assert.rejects(storeLimitedTicket(env,ticket(999,email,time.toISOString()),'sum'),e=>e.status===429);
 await checkTicketRate(env,email,new Date(time.getTime()+3600000));
 await storeLimitedTicket(env,ticket(1000,email,new Date(time.getTime()+3600000).toISOString()),'sum');
});
test('quota preflight rejects new files but permits repeat files without recording a download',async()=>{
 const u={email:'quota@example.com',daily_download_limit:1},today='2026-10-31';
 await env.DB.prepare('INSERT INTO downloads VALUES (?,?,?)').bind(u.email,today,'old').run();
 await checkDownloadQuota(env,u,'old',today);
 await assert.rejects(checkDownloadQuota(env,u,'new',today),e=>e.status===429);
 await checkDownloadQuota(env,{...u,daily_download_limit:null},'new',today);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM downloads').first()).n,1);
});
