import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {Miniflare} from 'miniflare';
const {default:worker}=await import(process.env.WORKER_UNDER_TEST||'../src/worker.mjs');
import {syncStep,singlePage} from '../src/drive.mjs';
import {startIndex,storeIndexPage,storeIndexPages} from '../src/indexing.mjs';
import {random,hash,now,day,seal} from '../src/core.mjs';

let mf,env,token;
before(async()=>{
 mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-07-01',d1Databases:['DB']});
 env={DB:await mf.getD1Database('DB'),OWNER_EMAIL:'owner@example.com',REFERENCE_ROOT_ID:'reference-root-001',MOCK_ROOT_ID:'mock-root-0000001',TOKEN_ENCRYPTION_KEY:random()};
 for(const file of ['0001','0002','0003','0004'])for(const sql of (await readFile('migrations/'+file+'.sql','utf8')).split(';').map(s=>s.trim()).filter(Boolean))await env.DB.prepare(sql).run();
 token=random();
 await env.DB.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(await hash(token),env.OWNER_EMAIL,'csrf',now()+3600).run();
 await env.DB.batch(Array.from({length:51},(_,i)=>env.DB.prepare('INSERT INTO users(email,google_sub,individual,view_enabled) VALUES (?,?,1,1)').bind(i===0?env.OWNER_EMAIL:`reader${i}@example.com`,'private-sub-'+i)));
 await env.DB.prepare('INSERT INTO settings VALUES (?,?)').bind('drive',JSON.stringify({email:env.OWNER_EMAIL,refresh:await seal('fixture-refresh',env.TOKEN_ENCRYPTION_KEY)})).run();
});
after(async()=>{await mf?.dispose();});

function observe(db){
 const log=[];
 function statement(raw,sql){return {
  bind(...values){return statement(raw.bind(...values),sql);},
  async first(...args){log.push({sql});return raw.first(...args);},
  async all(...args){const r=await raw.all(...args);log.push({sql,meta:r.meta});return r;},
  async run(...args){const r=await raw.run(...args);log.push({sql,meta:r.meta});return r;},
  raw,sql
 };}
 return {log,DB:{prepare:sql=>statement(db.prepare(sql),sql),async batch(statements){const result=await db.batch(statements.map(s=>s.raw));result.forEach((r,i)=>log.push({sql:statements[i].sql,meta:r.meta}));return result;}}};
}

test('51-user allowlist stays at five D1 calls and counts only today',async t=>{
 await env.DB.batch([
  env.DB.prepare('INSERT INTO downloads VALUES (?,?,?)').bind('reader1@example.com',day(),'a'),
  env.DB.prepare('INSERT INTO downloads VALUES (?,?,?)').bind('reader1@example.com',day(),'b'),
  env.DB.prepare('INSERT INTO downloads VALUES (?,?,?)').bind('reader1@example.com','2000-01-01','c')
 ]);
 const observed=observe(env.DB);
 const response=await worker.fetch(new Request('https://books.test/api/allowlist',{headers:{Authorization:'Bearer '+token}}),{...env,DB:observed.DB},{});
 assert.equal(response.status,200);
 const {users}=await response.json();assert.equal(users.length,51);
 assert.equal(users.find(u=>u.email==='reader1@example.com').downloads_today,2);
 assert.equal(users.find(u=>u.email==='reader2@example.com').downloads_today,0);
 assert.ok(users.every(u=>!('google_sub' in u)));
 assert.equal(observed.log.length,5);
 const plan=await env.DB.prepare('EXPLAIN QUERY PLAN SELECT email,COUNT(*) FROM downloads WHERE day=? GROUP BY email').bind(day()).all();
 assert.ok(plan.results.some(r=>/downloads_day_email/.test(r.detail)));
 t.diagnostic(JSON.stringify({users:51,d1Calls:observed.log.length,previousCallsFromCode:56}));
});

test('unchanged Drive rescans write no book or asset rows; real metadata edits persist',async t=>{
 const previousFetch=globalThis.fetch;let name='Math.pdf';
 globalThis.fetch=async input=>{
  const url=new URL(input);
  if(url.hostname==='oauth2.googleapis.com')return Response.json({access_token:'fixture'});
  if(url.pathname==='/drive/v3/files')return Response.json({files:[{id:'scan-pdf-0000001',name,mimeType:'application/pdf',size:'123',md5Checksum:'scan-md5'}]});
  throw Error('Unexpected fixture URL');
 };
 try{
  async function scan(){
   await env.DB.prepare('DELETE FROM scan').run();
   await env.DB.prepare('INSERT INTO scan VALUES (?,?,NULL,NULL)').bind(env.REFERENCE_ROOT_ID,'參考書').run();
   const observed=observe(env.DB);await syncStep({...env,DB:observed.DB});
   return observed.log.filter(r=>/^INSERT INTO (books|assets)/.test(r.sql)).reduce((sum,r)=>sum+r.meta.changes,0);
  }
  assert.equal(await scan(),2);
  const unchangedWrites=await scan();assert.equal(unchangedWrites,0);
  name='Renamed Math.pdf';assert.equal(await scan(),2);
  assert.equal((await env.DB.prepare('SELECT name FROM assets WHERE id=?').bind('scan-pdf-0000001').first()).name,name);
  t.diagnostic(JSON.stringify({unchangedBookAndAssetChanges:unchangedWrites,changedBookAndAssetChanges:2}));
 }finally{globalThis.fetch=previousFetch;}
});

test('large page indexes use fewer rows, resume alongside old chunks, and reconstruct exact bytes',async t=>{
 const asset='compact-index-0001',id='auto_'+await hash('compact-index-fixture');
 await env.DB.prepare('INSERT INTO assets(id,parent,book_id,name,mime,size,md5) VALUES (?,?,?,?,?,?,?)').bind(asset,env.REFERENCE_ROOT_ID,asset,'Compact.pdf','application/pdf',100,'compact-md5').run();
 await env.DB.prepare('INSERT INTO index_jobs(id,asset,size,md5,updated_at) VALUES (?,?,?,?,?)').bind(id,asset,100,'compact-md5',new Date().toISOString()).run();
 const trace=Buffer.from('/BibliothecaTrace (ZZZZ\\055ZZZZ)'),literal=Buffer.concat([trace,randomBytes(140000)]);
 const entry={length:literal.length,parts:[literal.toString('base64')]},data=gzipSync(JSON.stringify(entry)).toString('base64');
 const header={size:100,md5:'compact-md5',tail:Buffer.from('/BibliothecaTrace (ZZZZ-ZZZZ) startxref %%EOF').toString('base64'),pageCount:3};
 await startIndex(env,{job:id,header});
 // A page already committed with the former chunk size must stay readable.
 const oldParts=[];for(let offset=0,part=0;offset<data.length;offset+=32000,part++)oldParts.push(env.DB.prepare('INSERT INTO pdf_pages VALUES (?,?,?,?)').bind(id,1,part,data.slice(offset,offset+32000)));
 await env.DB.batch([...oldParts,env.DB.prepare('UPDATE index_jobs SET next_page=2 WHERE id=?').bind(id)]);
 await storeIndexPage(env,{job:id,page:2,data});
 await storeIndexPages(env,{job:id,pages:[{page:3,data}]});
 const counts=(await env.DB.prepare('SELECT page,COUNT(*) n FROM pdf_pages WHERE asset=? GROUP BY page ORDER BY page').bind(id).all()).results;
 assert.equal(counts[0].n,Math.ceil(data.length/32000));
 assert.equal(counts[1].n,Math.ceil(data.length/256000));assert.equal(counts[2].n,counts[1].n);assert.ok(counts[1].n<counts[0].n);
 for(const page of [1,2,3]){
  const stream=await singlePage(env,{id:asset,size:100},{imported:true,indexAsset:id},page,'ABCD-EFGH','unused');
  const result=Buffer.from(await new Response(stream).arrayBuffer());
  assert.equal(result.length,literal.length);assert.match(result.subarray(0,trace.length).toString(),/ABCD\\055EFGH/);
  assert.deepEqual(result.subarray(trace.length),literal.subarray(trace.length));
 }
 await storeIndexPages(env,{job:id,pages:[{page:3,data}]});
 assert.equal((await env.DB.prepare('SELECT next_page FROM index_jobs WHERE id=?').bind(id).first()).next_page,4);
 t.diagnostic(JSON.stringify({encodedPageChars:data.length,oldPageRows:counts[0].n,newPageRows:counts[1].n}));
});
