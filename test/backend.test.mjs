import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import worker,{quota} from '../src/worker.mjs';
import {hash,random,now,replaceTrace,permission,seal,unseal} from '../src/core.mjs';
import {singlePage,fullFile,indexFor} from '../src/drive.mjs';
import {loginReturn} from '../src/origins.mjs';
import {authErrorPage} from '../src/auth-error.mjs';
let mf,env,ownerToken,userToken;
before(async()=>{
 mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-07-01',d1Databases:['DB']});
 env={DB:await mf.getD1Database('DB'),OWNER_EMAIL:'owner@example.com',ASSETS:{fetch:()=>new Response('static')}};
 const sql=await readFile('migrations/0001.sql','utf8');for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await env.DB.prepare(statement).run();
 ownerToken=random();userToken=random();
 for(const [email,token,individual] of [['owner@example.com',ownerToken,0],['reader@example.com',userToken,1]]){
  await env.DB.prepare('INSERT INTO users(email,google_name,individual,view_enabled) VALUES (?,?,?,1)').bind(email,email,individual).run();
  await env.DB.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(await hash(token),email,'test-csrf',now()+3600).run();
 }
 for(const [id,category] of [['ref','參考書'],['mock','模擬考題本']])await env.DB.prepare('INSERT INTO books VALUES (?,?,?,?)').bind(id,id,category,JSON.stringify({id,title:id,category})).run();
});
after(async()=>{await mf?.dispose();});
const req=(path,token,body,origin='https://books.test')=>new Request('https://books.test'+path,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json',Origin:origin}:{})},body:body?JSON.stringify(body):undefined});
const call=(...args)=>worker.fetch(req(...args),env,{});
test('browser OAuth errors render Chinese HTML while API failures stay JSON',async()=>{
 const r=await call('/auth/callback');assert.equal(r.status,400);assert.match(r.headers.get('content-type'),/text\/html.*utf-8/);
 const html=await r.text();assert.match(html,/登入已過期/);assert.match(html,/返回書庫/);assert.doesNotMatch(html,/\{"error":/);
 const api=await call('/api/books');assert.match(api.headers.get('content-type'),/application\/json/);
 const denial=authErrorPage(403,'尚未取得使用權限 <script>','https://yao98r.github.io/bibliotheca/');assert.match(denial,/僅開放管理者指定/);assert.match(denial,/&lt;script&gt;/);assert.doesNotMatch(denial,/<script>/);
});
test('root serves index without redirecting or changing the browser path',async()=>{
 const r=await worker.fetch(new Request('https://books.test/?login_callback=1'),{...env,ASSETS:{fetch:r=>new Response(new URL(r.url).pathname)}},{});
 assert.equal(r.status,200);assert.equal(await r.text(),'/index.html');
});
test('D1 daily limit returns actionable retry time without exposing database errors',async()=>{
 const unavailable={...env,DB:{prepare(){throw Error("D1_ERROR: Your account has exceeded D1's free tier daily row write limit.");}}};
 const r=await worker.fetch(req('/api/me',ownerToken),unavailable,{});assert.equal(r.status,503);assert.ok(Number(r.headers.get('Retry-After'))>0);assert.match((await r.json()).error,/08:00/);
});
test('anonymous users cannot enumerate books, users, traces or files',async()=>{for(const path of ['/api/books','/api/allowlist','/api/traces','/file?ticket='+random()])assert.equal((await call(path)).status,401);});
test('reader cannot read or modify admin settings',async()=>{assert.equal((await call('/api/allowlist',userToken)).status,403);assert.equal((await call('/api/access-policy',userToken,{csrf:'test-csrf',enabled:true})).status,403);});
test('CSRF rejects foreign origin even with a valid bearer token',async()=>{assert.equal((await call('/api/logout',userToken,{csrf:'test-csrf'},'https://evil.test')).status,403);});
test('only configured GitHub origin receives CORS access, including error responses',async()=>{
 const crossEnv={...env,FRONTEND_URL:'https://yao98r.github.io/bibliotheca/'};
 for(const [origin,expected] of [['https://yao98r.github.io',true],['https://evil.test',false],['https://yao98r.github.io.evil.test',false]]){
  const r=await worker.fetch(new Request('https://books.test/api/books',{method:'OPTIONS',headers:{Origin:origin}}),crossEnv,{});
  assert.equal(r.status,expected?204:403);assert.equal(r.headers.get('Access-Control-Allow-Origin'),expected?origin:null);
 }
 const denied=await worker.fetch(new Request('https://books.test/api/books',{headers:{Origin:'https://yao98r.github.io'}}),crossEnv,{});
 assert.equal(denied.status,401);assert.equal(denied.headers.get('Access-Control-Allow-Origin'),'https://yao98r.github.io');
 const mutation=await worker.fetch(req('/api/event',ownerToken,{csrf:'test-csrf',id:'github-origin-event',action:'portal_view'},'https://yao98r.github.io'),crossEnv,{});
 assert.equal(mutation.status,200);
});
test('login return accepts exact configured path and rejects open redirects',()=>{
 const e={FRONTEND_URL:'https://yao98r.github.io/bibliotheca/'};
 for(const target of ['https://evil.test/','https://yao98r.github.io/other/','https://yao98r.github.io/bibliotheca/?next=evil'])assert.equal(loginReturn(new Request('https://books.test/auth?return_to='+encodeURIComponent(target)),e),null);
 assert.equal(loginReturn(new Request('https://books.test/auth?return_to='+encodeURIComponent(e.FRONTEND_URL)),e),e.FRONTEND_URL);
});
test('category permissions apply on every request',async()=>{await env.DB.prepare("UPDATE users SET access_scope='ref' WHERE email='reader@example.com'").run();const r=await call('/api/books',userToken);assert.deepEqual((await r.json()).map(b=>b.id),['ref']);assert.equal((await call('/api/event',userToken,{csrf:'test-csrf',bookId:'mock',action:'open'})).status,403);});
test('blocked user loses active session immediately',async()=>{await env.DB.prepare("UPDATE users SET blocked=1 WHERE email='reader@example.com'").run();assert.equal((await call('/api/me',userToken)).status,403);await env.DB.prepare("UPDATE users SET blocked=0 WHERE email='reader@example.com'").run();});
test('owner cannot be blocked',async()=>{assert.equal((await call('/api/allowlist',ownerToken,{csrf:'test-csrf',email:'owner@example.com',action:'remove'})).status,403);});
test('PKCE exchange checks verifier and only succeeds once under concurrency',async()=>{
 const code=random(),state=random(),verifier='a'.repeat(64);await env.DB.prepare('INSERT INTO exchanges VALUES (?,?,?,?,?)').bind(await hash(code),'reader@example.com',state,await hash(verifier),now()+60).run();
 assert.equal((await call('/api/exchange',null,{code,state,verifier:'b'.repeat(64)})).status,401);
 const results=await Promise.all([call('/api/exchange',null,{code,state,verifier}),call('/api/exchange',null,{code,state,verifier})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,401]);
});
test('repeated event ID does not duplicate audit counts',async()=>{for(let n=0;n<2;n++)assert.equal((await call('/api/event',userToken,{csrf:'test-csrf',id:'same-id',action:'portal_view'})).status,200);assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM events WHERE id='same-id'").first()).n,1);});
test('default policy never reactivates blocked users',()=>{assert.equal(permission({blocked:1,individual:0},{enabled:true,defaultTier:'download',scope:'both',dailyLimit:null},false).active,false);});
test('simultaneous distinct downloads cannot exceed the daily quota; repeat file is free',async()=>{
 const u={email:'quota@example.com',daily_download_limit:2};const results=await Promise.allSettled(Array.from({length:8},(_,i)=>quota(env,u,'asset-'+i)));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,2);
 const granted=await env.DB.prepare('SELECT asset_id FROM downloads WHERE email=?').bind(u.email).first();await quota(env,u,granted.asset_id);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM downloads WHERE email=?').bind(u.email).first()).n,2);
});
test('zero daily quota permits no new file',async()=>{await assert.rejects(quota(env,{email:'zero@example.com',daily_download_limit:0},'asset'),e=>e.status===429);});
test('encrypted credentials roundtrip and reject incorrect keys',async()=>{const key=random(),cipher=await seal('refresh-token',key);assert.ok(!cipher.includes('refresh-token'));assert.equal(await unseal(cipher,key),'refresh-token');await assert.rejects(unseal(cipher,random()));});
test('PDF marker replacement preserves xref byte offsets',()=>{const input=new TextEncoder().encode('/BibliothecaTrace (ZZZZ\\055ZZZZ)');const out=replaceTrace(input,'ABCD-EFGH');assert.equal(out.length,input.length);assert.equal(new TextDecoder().decode(out),'/BibliothecaTrace (ABCD\\055EFGH)');});
test('page endpoint assembles only the indexed byte ranges',async()=>{
 const original=globalThis.fetch;const calls=[];globalThis.fetch=async(url,options)=>{calls.push(options.headers.Range);return new Response(new Uint8Array([10,11,12]),{status:206,headers:{'Content-Range':'bytes 2-4/10'}});};
 try{const stream=await singlePage(env,{id:'file',size:10},{pages:[{length:5,parts:['AQI=',[2,3]]}]},1,'ABCD-EFGH','token');assert.deepEqual([...new Uint8Array(await new Response(stream).arrayBuffer())],[1,2,10,11,12]);assert.deepEqual(calls,['bytes=2-4']);}finally{globalThis.fetch=original;}
});
test('range requests reject a Drive response containing the entire document',async()=>{const original=globalThis.fetch;globalThis.fetch=async()=>new Response('entire file');try{await assert.rejects(singlePage(env,{id:'file',size:10},{pages:[{length:3,parts:[[2,3]]}]},1,'ABCD-EFGH','token'),e=>e.status===502);}finally{globalThis.fetch=original;}});
test('full document stream appends trace without buffering the source',async()=>{const original=globalThis.fetch;globalThis.fetch=async()=>new Response('PDF',{headers:{'Content-Length':'3'}});try{const stream=await fullFile(env,{id:'file',size:3},{tail:' /BibliothecaTrace (ZZZZ-ZZZZ)'},'ABCD-EFGH','token');assert.equal(await new Response(stream).text(),'PDF /BibliothecaTrace (ABCD-EFGH)');}finally{globalThis.fetch=original;}});
test('copied Drive files reuse only size and checksum matched indexes',async()=>{
 const sql=await readFile('migrations/0002.sql','utf8');for(const s of sql.split(';').map(s=>s.trim()).filter(Boolean))await env.DB.prepare(s).run();
 await env.DB.prepare('INSERT INTO pdf_headers VALUES (?,?,?,?,?)').bind('original',10,'abc','tail',2).run();
 const index=await indexFor(env,{id:'copy',size:10,md5:'abc'},'unused');assert.equal(index.asset,'copy');assert.equal(index.indexAsset,'original');
 await assert.rejects(indexFor(env,{id:'original',size:11,md5:'abc'},'unused'),e=>e.status===409);
});
test('chunked Drive downloads validate actual length without requiring Content-Length',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('PDF');
 try{const index={tail:' /BibliothecaTrace (ZZZZ-ZZZZ)'};assert.match(await new Response(await fullFile(env,{id:'file',size:3},index,'ABCD-EFGH','token')).text(),/ABCD-EFGH/);await assert.rejects(new Response(await fullFile(env,{id:'file',size:4},index,'ABCD-EFGH','token')).text(),/Incomplete/);}finally{globalThis.fetch=original;}
});
