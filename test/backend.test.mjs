import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import worker,{quota} from '../src/worker.mjs';
import {hash,random,now,day,replaceTrace,permission,seal,unseal} from '../src/core.mjs';
import {beginAuth,loginAllowed} from '../src/auth.mjs';
import {singlePage,fullFile,indexFor} from '../src/drive.mjs';
import {loginReturn} from '../src/origins.mjs';
import {authErrorPage} from '../src/auth-error.mjs';
import restored from '../src/restored-catalog.mjs';
let mf,env,ownerToken,userToken;
before(async()=>{
 mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-07-01',d1Databases:['DB']});
 env={DB:await mf.getD1Database('DB'),OWNER_EMAIL:'owner@example.com',ASSETS:{fetch:()=>new Response('static')}};
 for(const migration of ['0001','0002','0003','0004','0005']){const sql=await readFile('migrations/'+migration+'.sql','utf8');for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await env.DB.prepare(statement).run();}
 ownerToken=random();userToken=random();
 for(const [email,token,individual] of [['owner@example.com',ownerToken,0],['reader@example.com',userToken,1]]){
  await env.DB.prepare('INSERT INTO users(email,google_name,individual,view_enabled) VALUES (?,?,?,1)').bind(email,email,individual).run();
  await env.DB.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(await hash(token),email,'test-csrf',now()+3600).run();
 }
 for(const [id,category] of [['ref','參考書'],['mock','模擬考題本']])await env.DB.prepare('INSERT INTO books VALUES (?,?,?,?)').bind(id,id,category,JSON.stringify({id,title:id,category})).run();
 for(const id of ['ref','mock'])await env.DB.prepare('INSERT INTO assets(id,parent,book_id,name,mime) VALUES (?,?,?,?,?)').bind(id,'root',id,id+'.pdf','application/pdf').run();
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
test('source connection checks are owner-only and validate live Drive access without modifying readers',async()=>{
 assert.equal((await call('/api/drive/check',userToken,{csrf:'test-csrf'})).status,403);
 const before=await env.DB.prepare("SELECT * FROM users WHERE email='reader@example.com'").first();
 const previous=globalThis.fetch,key=random(),testEnv={...env,TOKEN_ENCRYPTION_KEY:key,GOOGLE_CLIENT_ID:'connection-check',GOOGLE_CLIENT_SECRET:'secret'};
 await env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('drive',?)").bind(JSON.stringify({email:'owner@example.com',refresh:await seal('refresh',key),connectedAt:'2026-10-22T00:00:00Z'})).run();
 globalThis.fetch=async()=>Response.json({error:'invalid_grant'},{status:400});
 try{const r=await worker.fetch(req('/api/drive/check',ownerToken,{csrf:'test-csrf'}),testEnv,{}),data=await r.json();assert.equal(r.status,200);assert.equal(data.configured,true);assert.equal(data.healthy,false);assert.equal(data.status,'reconnect_required');assert.doesNotMatch(JSON.stringify(data),/refresh_token|secret/);
 globalThis.fetch=async url=>url==='https://oauth2.googleapis.com/token'?Response.json({access_token:'renewed',expires_in:3600}):Response.json({user:{emailAddress:'owner@example.com'}});
 const okay=await worker.fetch(req('/api/drive/check',ownerToken,{csrf:'test-csrf'}),testEnv,{});assert.equal((await okay.json()).healthy,true);
 assert.deepEqual(await env.DB.prepare("SELECT * FROM users WHERE email='reader@example.com'").first(),before);
 }finally{globalThis.fetch=previous;await env.DB.prepare("DELETE FROM settings WHERE key='drive'").run();}
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
test('nested PDFs are individually searchable while retaining category authorization',async()=>{
 await env.DB.prepare('INSERT INTO assets(id,parent,book_id,name,mime) VALUES (?,?,?,?,?)').bind('nested-pdf','ref','ref','115年化學模擬題.pdf','application/pdf').run();
 const list=await (await call('/api/books',userToken)).json(),nested=list.find(b=>b.asset==='nested-pdf');assert.equal(nested.title,'115年化學模擬題');assert.equal(nested.subject,'化學');assert.equal(nested.id,'ref');assert.equal(nested.folder,false);assert.ok(list.every(b=>b.category==='參考書'));
});
test('owner can inspect PDF and index coverage independently of folder groups',async()=>{
 const response=await call('/api/drive/status',ownerToken);assert.equal(response.status,200);const status=await response.json();assert.equal(status.pdfs,3);assert.equal(status.books,2);assert.equal(status.indexed,0);
});
test('blocked user loses active session immediately',async()=>{await env.DB.prepare("UPDATE users SET blocked=1 WHERE email='reader@example.com'").run();assert.equal((await call('/api/me',userToken)).status,403);await env.DB.prepare("UPDATE users SET blocked=0 WHERE email='reader@example.com'").run();});
test('issued PDF tickets are bound to the account and recheck permission on every request',async()=>{
 const raw=random(),code='ABCD-EFGH';
 await env.DB.prepare('INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,NULL,?)').bind(await hash(raw),'reader@example.com','ref','ref','open','view',code,new Date().toISOString(),now()+600).run();
 try{
  assert.equal((await call('/api/viewer?ticket='+raw,ownerToken)).status,403);
  await env.DB.prepare("UPDATE users SET access_scope='mock' WHERE email='reader@example.com'").run();
  assert.equal((await call('/api/viewer?ticket='+raw,userToken)).status,403);
  await env.DB.prepare("UPDATE users SET access_scope='ref',view_enabled=0 WHERE email='reader@example.com'").run();
  assert.equal((await call('/api/viewer?ticket='+raw,userToken)).status,403);
  await env.DB.prepare("UPDATE users SET view_enabled=1,blocked=1 WHERE email='reader@example.com'").run();
  assert.equal((await call('/api/viewer?ticket='+raw,userToken)).status,403);
 }finally{await env.DB.prepare("UPDATE users SET access_scope='ref',view_enabled=1,blocked=0 WHERE email='reader@example.com'").run();await env.DB.prepare('DELETE FROM tickets WHERE hash=?').bind(await hash(raw)).run();}
});
test('owner cannot be blocked',async()=>{assert.equal((await call('/api/allowlist',ownerToken,{csrf:'test-csrf',email:'owner@example.com',action:'remove'})).status,403);});

test('all delivery routes reject stolen, expired and revoked tickets before touching Drive',async()=>{
 const paths=['/api/viewer','/api/page','/api/fast-file','/file','/api/download-context'];
 const view=random(),download=random(),originalFetch=globalThis.fetch;let upstream=0;
 globalThis.fetch=async()=>{upstream++;throw Error('Denied requests must not reach Drive');};
 const before=await env.DB.prepare("SELECT * FROM users WHERE email='reader@example.com'").first();
 try{
  await env.DB.prepare("UPDATE users SET access_scope='both',view_enabled=1,download_mode='download',reading_mode='fast' WHERE email='reader@example.com'").run();
  for(const [raw,action,kind] of [[view,'answer_open','view'],[download,'answer_download','download']])await env.DB.prepare('INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,NULL,?)').bind(await hash(raw),'reader@example.com','ref','ref',action,kind,kind==='view'?'ABCD-EFGH':'JKLM-NPQR',new Date().toISOString(),now()+600).run();
  for(const path of paths){const raw=path==='/file'||path==='/api/download-context'?download:view;assert.equal((await call(path+'?ticket='+raw+'&page=1',ownerToken)).status,403);assert.equal((await call(path+'?ticket='+raw+'&page=1')).status,401);}
  for(const raw of [view,download])await env.DB.prepare('UPDATE tickets SET expires=? WHERE hash=?').bind(now()-1,await hash(raw)).run();
  for(const path of paths)assert.equal((await call(path+'?ticket='+(path==='/file'||path==='/api/download-context'?download:view)+'&page=1',userToken)).status,403);
  for(const raw of [view,download])await env.DB.prepare('UPDATE tickets SET expires=? WHERE hash=?').bind(now()+600,await hash(raw)).run();
  await env.DB.prepare("UPDATE users SET blocked=1 WHERE email='reader@example.com'").run();
  for(const path of paths)assert.equal((await call(path+'?ticket='+(path==='/file'||path==='/api/download-context'?download:view)+'&page=1',userToken)).status,403);
  await env.DB.prepare("UPDATE users SET blocked=0,view_enabled=0,download_mode='view' WHERE email='reader@example.com'").run();
  for(const path of paths)assert.equal((await call(path+'?ticket='+(path==='/file'||path==='/api/download-context'?download:view)+'&page=1',userToken)).status,403);
  assert.equal(upstream,0);
 }finally{globalThis.fetch=originalFetch;await env.DB.prepare('UPDATE users SET access_scope=?,view_enabled=?,download_mode=?,reading_mode=?,blocked=? WHERE email=?').bind(before.access_scope,before.view_enabled,before.download_mode,before.reading_mode,before.blocked,before.email).run();for(const raw of [view,download])await env.DB.prepare('DELETE FROM tickets WHERE hash=?').bind(await hash(raw)).run();}
});

test('exhausted download quota is rejected before Google Drive is contacted',async()=>{
 const raw=random(),original=globalThis.fetch,before=await env.DB.prepare("SELECT * FROM users WHERE email='reader@example.com'").first();let calls=0;
 try{
  await env.DB.prepare("UPDATE users SET access_scope='both',download_mode='download',daily_download_limit=0 WHERE email='reader@example.com'").run();
  await env.DB.prepare('INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,NULL,?)').bind(await hash(raw),'reader@example.com','ref','ref','download_request','download','ABCD-EFGH',new Date().toISOString(),now()+600).run();
  globalThis.fetch=async()=>{calls++;throw Error('Unexpected upstream read');};
  assert.equal((await call('/file?ticket='+raw,userToken)).status,429);assert.equal(calls,0);
 }finally{globalThis.fetch=original;await env.DB.prepare('UPDATE users SET access_scope=?,download_mode=?,daily_download_limit=? WHERE email=?').bind(before.access_scope,before.download_mode,before.daily_download_limit,before.email).run();await env.DB.prepare('DELETE FROM tickets WHERE hash=?').bind(await hash(raw)).run();}
});
test('PKCE exchange checks verifier and only succeeds once under concurrency',async()=>{
 const code=random(),state=random(),verifier='a'.repeat(64);await env.DB.prepare('INSERT INTO exchanges VALUES (?,?,?,?,?)').bind(await hash(code),'reader@example.com',state,await hash(verifier),now()+60).run();
 assert.equal((await call('/api/exchange',null,{code,state,verifier:'b'.repeat(64)})).status,401);
 const results=await Promise.all([call('/api/exchange',null,{code,state,verifier}),call('/api/exchange',null,{code,state,verifier})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,401]);
});
test('portal visit is recorded at most once per user per day even for different event IDs',async()=>{for(let n=0;n<3;n++)assert.equal((await call('/api/event',userToken,{csrf:'test-csrf',id:'unique-'+n,action:'portal_view'})).status,200);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM events WHERE email=? AND id=?').bind('reader@example.com','visit:'+day()).first()).n,1);});
test('anonymous login creates no D1 state and rejects tampered or mismatched browser cookies',async()=>{
 const testEnv={...env,GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',TOKEN_ENCRYPTION_KEY:random()};
 const state=random(),verifier=random();const url='https://books.test/auth?'+new URLSearchParams({state,challenge:await hash(verifier)});
 const before=(await env.DB.prepare('SELECT COUNT(*) n FROM oauth').first()).n;
 const r=await beginAuth(new Request(url),testEnv);assert.equal(r.status,302);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM oauth').first()).n,before);
 const cookie=r.headers.get('Set-Cookie').split(';')[0],googleState=new URL(r.headers.get('Location')).searchParams.get('state');
 const pending=JSON.parse(await unseal(cookie.slice('oauth_binding='.length),testEnv.TOKEN_ENCRYPTION_KEY));assert.equal(pending.state,googleState);assert.equal(pending.clientState,state);assert.ok(pending.expires>now());
 const mismatch=await worker.fetch(new Request('https://books.test/auth/callback?state='+random(),{headers:{Cookie:cookie}}),testEnv,{});assert.equal(mismatch.status,400);
 const invalid=await worker.fetch(new Request('https://books.test/auth/callback?state='+googleState,{headers:{Cookie:cookie.slice(0,-1)+'!'}}),testEnv,{});assert.ok([400,403].includes(invalid.status));
 const expired=await seal(JSON.stringify({...pending,expires:now()-1}),testEnv.TOKEN_ENCRYPTION_KEY);
 assert.equal((await worker.fetch(new Request('https://books.test/auth/callback?state='+googleState,{headers:{Cookie:'oauth_binding='+expired}}),testEnv,{})).status,400);
});
test('login admission rejects strangers and blocked users while preserving existing policy',async()=>{
 await assert.rejects(loginAllowed(env,'stranger@example.com',null),e=>e.status===403);
 const reader=await env.DB.prepare("SELECT * FROM users WHERE email='reader@example.com'").first();
 await loginAllowed(env,'reader@example.com',reader);
 await assert.rejects(loginAllowed(env,'reader@example.com',{...reader,blocked:1}),e=>e.status===403);
 await loginAllowed({...env,DB:{prepare:()=>({bind:()=>({first:async()=>({value:JSON.stringify({enabled:true,defaultTier:'catalog',scope:'both',dailyLimit:null})})})})}},'new@example.com',null);
});
test('full OAuth callback admits an allowed user and rejects an unknown user without writing a user row',async()=>{
 const keys=await generateKeyPair('RS256',{extractable:true}),jwk=await exportJWK(keys.publicKey);Object.assign(jwk,{kid:'fixture',alg:'RS256',use:'sig'});
 const testEnv={...env,GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',TOKEN_ENCRYPTION_KEY:random()};
 const original=globalThis.fetch;let currentNonce,currentEmail,usedCode;
 globalThis.fetch=async(url)=>{
  if(String(url)==='https://www.googleapis.com/oauth2/v3/certs')return Response.json({keys:[jwk]});
  if(String(url)==='https://oauth2.googleapis.com/token'){
   if(usedCode)return Response.json({error:'invalid_grant'},{status:400});usedCode=true;
   const id_token=await new SignJWT({nonce:currentNonce,email:currentEmail,email_verified:true,name:'Test Reader'}).setProtectedHeader({alg:'RS256',kid:'fixture'}).setIssuer('https://accounts.google.com').setAudience('test-client').setSubject('fixture-subject').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
   return Response.json({id_token});
  }
  throw Error('unexpected fetch');
 };
 try{
  for(const [email,expected] of [['reader@example.com',200],['stranger@example.com',403]]){
   currentEmail=email;usedCode=false;const clientState=random(),verifier='v'.repeat(64);
   const start=await beginAuth(new Request('https://books.test/auth?'+new URLSearchParams({state:clientState,challenge:await hash(verifier)})),testEnv);
   const target=new URL(start.headers.get('Location'));currentNonce=target.searchParams.get('nonce');
   const url='https://books.test/auth/callback?'+new URLSearchParams({state:target.searchParams.get('state'),code:'fixture-code'}),cookie=start.headers.get('Set-Cookie').split(';')[0];
   const result=await worker.fetch(new Request(url,{headers:{Cookie:cookie}}),testEnv,{});assert.equal(result.status,expected);
   if(expected===200){const html=await result.text(),dest=html.match(/location\.replace\(("[^"]+")\)/);assert.ok(dest);const fragment=new URL(JSON.parse(dest[1])).hash.slice(1),params=new URLSearchParams(fragment);const exchange=await worker.fetch(req('/api/exchange',null,{code:params.get('code'),state:clientState,verifier}),testEnv,{});assert.equal(exchange.status,200);}
   else assert.equal(await env.DB.prepare("SELECT email FROM users WHERE email='stranger@example.com'").first(),null);
  }
 }finally{globalThis.fetch=original;}
});
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
 const originalFetch=globalThis.fetch;globalThis.fetch=async()=>Response.json({files:[]});try{await assert.rejects(indexFor(env,{id:'original',size:11,md5:'abc'},'unused'),e=>e.status===409);}finally{globalThis.fetch=originalFetch;}
});
test('chunked Drive downloads validate actual length without requiring Content-Length',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('PDF');
 try{const index={tail:' /BibliothecaTrace (ZZZZ-ZZZZ)'};assert.match(await new Response(await fullFile(env,{id:'file',size:3},index,'ABCD-EFGH','token')).text(),/ABCD-EFGH/);await assert.rejects(new Response(await fullFile(env,{id:'file',size:4},index,'ABCD-EFGH','token')).text(),/Incomplete/);}finally{globalThis.fetch=original;}
});
test('Workers native PDF pipe enforces complete transfer and appends trailer',async()=>{
 const pipe=await readFile('src/pdf-stream.mjs','utf8');
 const runtime=new Miniflare({modules:true,script:pipe+`\nexport default {fetch(request){const size=Number(new URL(request.url).searchParams.get('size'));return new Response(appendPdfTail(new Response('PDF').body,size,new TextEncoder().encode('TAIL')));}}`,compatibilityDate:'2026-07-01'});
 try{const ok=await runtime.dispatchFetch('https://test/?size=3');assert.equal(await ok.text(),'PDFTAIL');const short=await runtime.dispatchFetch('https://test/?size=4');const incomplete=await short.text().catch(()=>'');assert.notEqual(incomplete.length,8);}finally{await runtime.dispose();}
});

test('old book IDs resolve through registered assets and retain explicit Notion selection',async()=>{
 const source=restored.find(b=>b.category==='參考書'&&!b.answerAsset);
 await env.DB.prepare('INSERT INTO assets(id,parent,book_id,name,mime) VALUES (?,?,?,?,?)').bind(source.asset,'root','ref','Recovered.pdf','application/pdf').run();
 try{
  const r=await call('/api/context?book='+source.id,ownerToken);assert.equal(r.status,200);
  const data=await r.json();assert.equal(data.asset,source.asset);assert.equal(data.bookId,'ref');assert.equal(data.title,source.title);
  assert.equal((await call('/api/context?book='+source.id+'&asset=unrelated',ownerToken)).status,404);
  assert.equal((await call('/api/context?book='+source.id+'&action=answer_open',ownerToken)).status,404);
  const specific=await call('/api/context?book=ref&asset='+source.asset,ownerToken);assert.equal((await specific.json()).asset,source.asset);
  assert.equal((await call('/api/context?book=ref&asset=mock',ownerToken)).status,404);
 }finally{await env.DB.prepare('DELETE FROM assets WHERE id=?').bind(source.asset).run();}
});
test('unimported old sources fail explicitly instead of substituting a similarly named PDF',async()=>{
 const r=await call('/api/context?book='+restored.find(b=>b.category==='模擬考題本').id,ownerToken);
 assert.equal(r.status,409);assert.match((await r.json()).error,/尚未匯入/);
});

test('default E rank preserves individual ranks, owner authority and access policy',()=>{
 const user={level:'A',individual:0,blocked:0},policy={enabled:true,defaultTier:'catalog',scope:'ref',dailyLimit:3};
 const inherited=permission(user,policy,false);assert.equal(inherited.level,'E');assert.equal(inherited.view_enabled,0);assert.equal(inherited.download_mode,'view');assert.equal(inherited.access_scope,'ref');assert.equal(inherited.admin,false);
 const individual=permission({...user,individual:1,level:'C',view_enabled:1,download_mode:'download'},policy,false);assert.equal(individual.level,'C');assert.equal(individual.download_mode,'download');
 const owner=permission(user,policy,true);assert.equal(owner.level,'A');assert.equal(owner.admin,true);assert.equal(owner.download_mode,'download');assert.equal(owner.access_scope,'both');assert.equal(owner.daily_download_limit,null);
});
test('ordinary account responses omit grade data while owner retains rank management',async()=>{
 const reader=await (await call('/api/me',userToken)).json();assert.equal(reader.admin,false);assert.equal('level' in reader,false);assert.equal('ranks' in reader,false);assert.equal(reader.canView,true);
 const owner=await (await call('/api/me',ownerToken)).json();assert.equal(owner.admin,true);assert.ok(owner.level);assert.equal(owner.ranks.length,5);assert.equal(owner.canDownload,true);
});

test('trace context is ticket-bound; page reports deduplicate and old source evidence stays immutable',async()=>{
 const code='ABCD-EFGH',view=random(),download=random(),md5='1234567890abcdef1234567890abcdef';
 await env.DB.prepare('UPDATE assets SET size=10,md5=? WHERE id=?').bind(md5,'ref').run();
 await env.DB.prepare('INSERT OR REPLACE INTO pdf_headers VALUES (?,?,?,?,?)').bind('ref',10,md5,'tail',3).run();
 for(const [raw,trace,kind,action] of [[view,code,'view','open'],[download,'JKLM-NPQR','download','download_request']])await env.DB.prepare('INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,NULL,?)').bind(await hash(raw),'owner@example.com','ref','ref',action,kind,trace,new Date().toISOString(),now()+3600).run();
 await env.DB.prepare('INSERT INTO events VALUES (?,?,?,?,?,?)').bind('trace:'+code+':source:'+md5,'owner@example.com','ref','Original.pdf','trace_issue',new Date().toISOString()).run();
 assert.equal((await call('/api/download-context?ticket='+download,userToken)).status,403);
 assert.equal((await call('/api/download-context?ticket='+view,ownerToken)).status,403);
 const own=await (await call('/api/download-context?ticket='+download,ownerToken)).json();assert.equal(own.traceCode,'JKLM-NPQR');
 for(let i=0;i<2;i++)assert.equal((await call('/api/trace/page',ownerToken,{csrf:'test-csrf',ticket:view,page:2})).status,200);
 for(const page of [0,4,1.5,'2'])assert.equal((await call('/api/trace/page',ownerToken,{csrf:'test-csrf',ticket:view,page})).status,400);
 assert.equal((await call('/api/trace/page',ownerToken,{csrf:'test-csrf',ticket:download,page:1})).status,403);
 assert.equal((await call('/api/trace/page',userToken,{csrf:'test-csrf',ticket:view,page:1})).status,403);
 assert.equal((await call('/api/traces',userToken)).status,403);
 await env.DB.prepare("UPDATE assets SET name='Changed.pdf',md5='changed' WHERE id='ref'").run();
 const rows=(await (await call('/api/traces?code='+code,ownerToken)).json()).records;assert.equal(rows.length,1);assert.equal(rows[0].pages_reported,1);assert.equal(rows[0].pages_issued,0);assert.equal(rows[0].source_md5,md5);assert.equal(rows[0].title,'Original.pdf');
 const stats=await (await call('/api/stats',ownerToken)).json();assert.ok(stats.events.every(e=>!['page_reported','trace_issue'].includes(e.action)));
 assert.equal((await call('/api/traces?code=invalid',ownerToken)).status,400);
});
