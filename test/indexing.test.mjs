import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {Miniflare} from 'miniflare';
import * as PDFLib from 'pdf-lib';
import SparkMD5 from 'spark-md5';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {preparePdf,base64} from '../public/pdf-index-builder.mjs';
import {hash,random,now,seal} from '../src/core.mjs';
import worker from '../src/worker.mjs';
import {indexFor} from '../src/drive.mjs';
import {compileWatermarkedPdf} from '../public/pdf-watermark-builder.mjs';
import {storeWatermark} from '../src/watermark-indexing.mjs';
let mf,env,source,checksum,builder,owner,reader,job,originalFetch;
const asset='new-pdf-asset-0001';
const request=(path,token,body)=>new Request('https://books.test'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{Origin:'https://books.test','Content-Type':'application/json'}:{})},body:body?JSON.stringify({csrf:'test-csrf',...body}):undefined});
const call=(path,body,token=owner)=>worker.fetch(request(path,token,body),env,{});
const pack=entry=>gzipSync(JSON.stringify(entry)).toString('base64');
before(async()=>{
 const doc=await PDFLib.PDFDocument.create({updateMetadata:false});
 for(let n=1;n<=2;n++){const p=doc.addPage();for(let i=0;i<100;i++)p.drawText('PAGE-'+n+' LINE-'+i,{x:10+(i%5)*95,y:20+Math.floor(i/5)*25,size:9});}
 doc.getPage(0).node.set(PDFLib.PDFName.of('Annots'),doc.context.obj([doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Link',Dest:[doc.getPage(1).ref,'Fit']}))]));
 source=await doc.save();checksum=SparkMD5.ArrayBuffer.hash(source.buffer);
 builder=await preparePdf(source,{size:source.length,md5:checksum},{PDFLib,SparkMD5});
 mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-07-01',d1Databases:['DB']});
 env={DB:await mf.getD1Database('DB'),OWNER_EMAIL:'owner@example.com',REFERENCE_ROOT_ID:'root-reference-0001',MOCK_ROOT_ID:'root-mock-0001',TOKEN_ENCRYPTION_KEY:random(),GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test'};
 for(const file of ['0001','0002','0003','0004','0005'])for(const sql of (await readFile('migrations/'+file+'.sql','utf8')).split(';').map(s=>s.trim()).filter(Boolean))await env.DB.prepare(sql).run();
 owner=random();reader=random();
 for(const [email,token] of [['owner@example.com',owner],['reader@example.com',reader]]){
  await env.DB.prepare('INSERT INTO users(email,individual,view_enabled) VALUES (?,1,1)').bind(email).run();
  await env.DB.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(await hash(token),email,'test-csrf',now()+3600).run();
 }
 await env.DB.prepare('INSERT INTO settings VALUES (?,?)').bind('drive',JSON.stringify({email:env.OWNER_EMAIL,refresh:await seal('refresh-fixture',env.TOKEN_ENCRYPTION_KEY)})).run();
 await env.DB.prepare('INSERT INTO books VALUES (?,?,?,?)').bind(asset,'New PDF','參考書',JSON.stringify({id:asset,title:'New PDF',category:'參考書'})).run();
 await env.DB.prepare('INSERT INTO assets(id,parent,book_id,name,mime,size,md5) VALUES (?,?,?,?,?,?,?)').bind(asset,env.REFERENCE_ROOT_ID,asset,'New PDF.pdf','application/pdf',source.length,checksum).run();
 originalFetch=globalThis.fetch;
 globalThis.fetch=async(input,options)=>{
  const url=new URL(input);
  if(url.origin==='https://oauth2.googleapis.com')return Response.json({access_token:'fixture-token'});
  if(url.pathname==='/drive/v3/files/'+asset){
   if(url.searchParams.get('alt')==='media'){
    const range=options?.headers?.Range?.match(/^bytes=(\d+)-(\d+)$/);
    if(range){const start=Number(range[1]),end=Number(range[2]);return new Response(source.slice(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${source.length}`}});}
    return new Response(source);
   }
   return Response.json({size:source.length,md5Checksum:checksum,parents:[env.REFERENCE_ROOT_ID]});
  }
  if(url.pathname==='/drive/v3/files')return Response.json({files:[]});
  throw Error('Unexpected fixture URL');
 };
});
after(async()=>{globalThis.fetch=originalFetch;await mf?.dispose();});
test('browser builder reconstructs individual pages and a valid traced full PDF',async()=>{
 assert.equal(builder.header.pageCount,2);
 for(let n=1;n<=2;n++){
  const entry=await builder.page(n);assert.ok(entry.parts.some(Array.isArray),'source streams should be represented as ranges');
  const bytes=Buffer.concat(entry.parts.map(p=>typeof p==='string'?Buffer.from(p,'base64'):Buffer.from(source.subarray(p[0],p[0]+p[1]))));assert.equal(bytes.length,entry.length);
  const doc=await PDFLib.PDFDocument.load(bytes);assert.equal(doc.getPageCount(),1);
  assert.equal(doc.context.enumerateIndirectObjects().filter(([,object])=>object instanceof PDFLib.PDFPageLeaf).length,1,'annotations must not copy hidden destination pages');
  const info=doc.context.lookup(doc.context.trailerInfo.Info);assert.equal(info.get(PDFLib.PDFName.of('BibliothecaTrace')).decodeText(),'ZZZZ-ZZZZ');
 }
 const full=await PDFLib.PDFDocument.load(Buffer.concat([source,Buffer.from(builder.header.tail,'base64')]),{updateMetadata:false});assert.equal(full.getPageCount(),2);assert.equal(full.context.lookup(full.context.trailerInfo.Info).get(PDFLib.PDFName.of('BibliothecaTrace')).decodeText(),'ZZZZ-ZZZZ');
 const loading=getDocument({data:new Uint8Array(Buffer.concat([source,Buffer.from(builder.header.tail,'base64')])),useSystemFonts:true});
 try{const parsed=await loading.promise;assert.equal(parsed.numPages,2);assert.ok((await (await parsed.getPage(2)).getTextContent()).items.some(item=>item.str.includes('PAGE-2')));}finally{await loading.destroy();}
 await assert.rejects(preparePdf(source,{size:source.length,md5:'wrong'},{PDFLib,SparkMD5}),/校驗/);
});
test('readers cannot obtain raw indexing sources or upload indexes',async()=>{
 for(const path of ['/api/watermark/next','/api/watermark/store','/api/index/next','/api/index/start','/api/index/page','/api/index/pages','/api/index/finish'])assert.equal((await call(path,{},reader)).status,403);
 assert.equal((await call('/api/index/source?job=anything',undefined,reader)).status,403);assert.equal((await call('/api/watermark/source?asset='+asset,undefined,reader)).status,403);
 assert.equal((await worker.fetch(new Request('https://books.test/api/index/next',{method:'POST',headers:{Authorization:'Bearer '+owner,Origin:'https://evil.test','Content-Type':'application/json'},body:JSON.stringify({csrf:'test-csrf'})}),env,{})).status,403);
});
test('new PDF is queued, indexes resume safely, and incomplete drafts cannot be read',async()=>{
 const d=await (await call('/api/index/next',{})).json();job=d.job;assert.equal(job.asset,asset);assert.equal(d.remaining,1);
 assert.deepEqual(await new Response((await call('/api/index/source?job='+job.id)).body).arrayBuffer(),source.buffer);
 assert.equal((await call('/api/index/start',{job:job.id,header:builder.header})).status,200);
 const first=await builder.page(1),payload={job:job.id,page:1,data:pack(first)};
 const responses=await Promise.all([call('/api/index/page',payload),call('/api/index/page',payload)]);assert.ok(responses.every(r=>r.status===200));
 assert.equal((await (await call('/api/index/start',{job:job.id,header:builder.header})).json()).nextPage,2);
 assert.equal((await call('/api/index/finish',{job:job.id})).status,409);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM pdf_headers').first()).n,0);
 assert.equal((await call('/api/prepare',{bookId:asset,action:'open'})).status,409);
 const bad={length:5,parts:[[source.length,5]]};assert.equal((await call('/api/index/page',{job:job.id,page:2,data:pack(bad)})).status,400);
 assert.equal((await call('/api/index/page',{job:job.id,page:2,data:pack(await builder.page(2))})).status,200);
 assert.equal((await call('/api/index/finish',{job:job.id})).status,200);
 assert.equal((await (await call('/api/index/next',{})).json()).job,null);
});
test('owner prepares full backend composition once without rewriting page indexes; readers receive only composed downloads',async()=>{
 assert.equal((await call('/api/prepare',{bookId:asset,action:'download_request'})).status,409);
 const next=await (await call('/api/watermark/next',{})).json();assert.equal(next.job.asset,asset);
 assert.deepEqual(new Uint8Array(await (await call('/api/watermark/source?asset='+asset)).arrayBuffer()),source);
 const before=(await env.DB.prepare('SELECT COUNT(*) n FROM pdf_pages').first()).n;
 const plan=await compileWatermarkedPdf(source,{size:source.length,md5:checksum},{PDFLib,SparkMD5}),body={asset,data:pack(plan)};
 const saved=await call('/api/watermark/store',body);assert.equal(saved.status,200);assert.equal((await saved.json()).changed,true);
 assert.equal((await (await call('/api/watermark/store',body)).json()).changed,false);
 const previous=await env.DB.prepare('SELECT etag FROM pdf_watermarks WHERE size=? AND md5=?').bind(source.length,checksum).first();
 await assert.rejects(storeWatermark(env,{asset,data:pack({...plan,extra:'budget-check'})},1),e=>e.status===507);
 assert.deepEqual(await env.DB.prepare('SELECT etag FROM pdf_watermarks WHERE size=? AND md5=?').bind(source.length,checksum).first(),previous);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM pdf_pages').first()).n,before);
 assert.equal((await (await call('/api/watermark/next',{})).json()).job,null);
 const r=await call('/api/prepare',{bookId:asset,action:'open'});assert.equal(r.status,200);const ticket=new URL((await r.json()).url).searchParams.get('ticket');
 const metadata=await (await call('/api/viewer?ticket='+ticket)).json();assert.equal(metadata.watermark,'server-v2');assert.equal(metadata.canDownload,true);
 const page=await call('/api/page?'+new URLSearchParams({ticket,page:2}));assert.equal(page.status,200);assert.equal(page.headers.get('X-PDF-Watermark'),'legacy-page');const doc=await PDFLib.PDFDocument.load(await page.arrayBuffer());assert.equal(doc.getPageCount(),1);
 const download=await call('/api/viewer/download',{ticket});assert.equal(download.status,200);const url=new URL((await download.json()).url),file=await call(url.pathname+url.search);
 assert.equal(file.status,200);const bytes=await file.arrayBuffer();assert.equal(bytes.byteLength,Number(file.headers.get('X-PDF-Bytes')));const full=await PDFLib.PDFDocument.load(bytes);assert.equal(full.getPageCount(),2);
 assert.equal(file.headers.get('X-PDF-Watermark'),'server-v2');assert.notDeepEqual(new Uint8Array(bytes),source);
 const info=full.context.lookup(full.context.trailerInfo.Info);assert.equal(info.get(PDFLib.PDFName.of('BibliothecaProof')).decodeText().length,64);
 assert.equal(full.getPage(0).node.get(PDFLib.PDFName.of('BibliothecaInvisibleTrace')).decodeText().length,74);
 const direct=await call('/api/fast-file?ticket='+ticket);assert.equal(direct.status,200);assert.equal(direct.headers.get('X-PDF-Watermark'),'server-v2');await direct.arrayBuffer();
});

test('updated same-ID PDF uses matching checksum index instead of a stale original header',async()=>{
 await env.DB.prepare('INSERT INTO pdf_headers VALUES (?,?,?,?,?)').bind(asset,source.length-1,'old','invalid',1).run();
 const result=await indexFor(env,{id:asset,size:source.length,md5:checksum},'unused');assert.equal(result.indexAsset,job.id);
 await env.DB.prepare('UPDATE assets SET md5=? WHERE id=?').bind('changed',asset).run();assert.equal((await call('/api/index/finish',{job:job.id})).status,409);
});
test('batched indexes validate atomically, reject gaps, and support safe retries',async()=>{
 await env.DB.prepare('UPDATE assets SET md5=? WHERE id=?').bind(checksum,asset).run();
 const id='auto_'+await hash('batch-recovery-fixture');
 await env.DB.prepare('DELETE FROM index_jobs WHERE asset=?').bind(asset).run();
 await env.DB.prepare('INSERT INTO index_jobs(id,asset,size,md5,updated_at) VALUES (?,?,?,?,?)').bind(id,asset,source.length,checksum,new Date().toISOString()).run();
 assert.equal((await call('/api/index/start',{job:id,header:builder.header})).status,200);
 const pages=[{page:1,data:pack(await builder.page(1))},{page:2,data:pack(await builder.page(2))}];
 assert.equal((await call('/api/index/pages',{job:id,pages:[pages[1]]})).status,409);
 assert.equal((await call('/api/index/pages',{job:id,pages:[pages[0],{page:2,data:pack({length:5,parts:[[source.length,5]]})}]})).status,400);
 assert.equal((await env.DB.prepare('SELECT next_page FROM index_jobs WHERE id=?').bind(id).first()).next_page,1);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM pdf_pages WHERE asset=?').bind(id).first()).n,0);
 for(let n=0;n<2;n++){const r=await call('/api/index/pages',{job:id,pages});assert.equal(r.status,200);assert.equal((await r.json()).nextPage,3);}
 assert.equal((await call('/api/index/finish',{job:id})).status,200);
});

test('reading still uses D1, but repeat delivery never rewrites first-issued time',async t=>{
 const prepared=await call('/api/prepare',{bookId:asset,action:'open'});
 assert.equal(prepared.status,200);const ticket=new URL((await prepared.json()).url).searchParams.get('ticket');
 async function profile(path,body){
  const log=[];
  function statement(raw,sql){return {
   bind(...values){return statement(raw.bind(...values),sql);},
   async first(column){const r=await raw.all();log.push({sql,meta:r.meta});const row=r.results[0];return column?(row?.[column]??null):(row??null);},
   async all(){const r=await raw.all();log.push({sql,meta:r.meta});return r;},
   async run(){const r=await raw.run();log.push({sql,meta:r.meta});return r;}
  };}
  const DB={prepare:sql=>statement(env.DB.prepare(sql),sql)};
  const response=await worker.fetch(request(path,owner,body),{...env,DB},{});
  assert.equal(response.status,200);await response.arrayBuffer();
  return {log,calls:log.length,rowsRead:log.reduce((n,r)=>n+(r.meta.rows_read||0),0),rowsWritten:log.reduce((n,r)=>n+(r.meta.rows_written||0),0)};
 }
 const path='/api/page?'+new URLSearchParams({ticket,page:1});
 const first=await profile(path),repeat=await profile(path),display=await profile('/api/trace/page',{ticket,page:1}),repeatDisplay=await profile('/api/trace/page',{ticket,page:1});
 assert.equal(first.log.filter(r=>r.sql.startsWith('UPDATE tickets')).length,1);
 assert.equal(repeat.log.filter(r=>r.sql.startsWith('UPDATE tickets')).length,0);
 assert.ok(first.rowsWritten>repeat.rowsWritten);assert.equal(repeat.rowsWritten,0);
 assert.ok(display.rowsWritten>0);assert.equal(repeatDisplay.rowsWritten,0);
 assert.ok(first.rowsRead>0&&repeat.rowsRead>0);
 const summary=Object.fromEntries(Object.entries({first,repeat,display,repeatDisplay}).map(([key,{calls,rowsRead,rowsWritten}])=>[key,{calls,rowsRead,rowsWritten}]));
 t.diagnostic(JSON.stringify({localD1ReadingProfile:summary}));
});

test('missing or stale composition templates keep page reading available and reject raw full-file shortcuts',async()=>{
 await env.DB.prepare('DELETE FROM pdf_watermarks').run();
 assert.equal((await call('/api/prepare',{bookId:asset,action:'download_request'})).status,409);
 const prepared=await call('/api/prepare',{bookId:asset,action:'open'});assert.equal(prepared.status,200);
 const ticket=new URL((await prepared.json()).url).searchParams.get('ticket');
 const metadata=await (await call('/api/viewer?ticket='+ticket)).json();assert.equal(metadata.readingMode,'protected');assert.equal(metadata.canDownload,false);
 const direct=await call('/api/fast-file?ticket='+ticket);assert.equal(direct.status,409);assert.match(direct.headers.get('Content-Type'),/json/);assert.equal(direct.headers.get('X-PDF-Watermark'),null);
 const page=await call('/api/page?'+new URLSearchParams({ticket,page:1}));assert.equal(page.status,200);await page.arrayBuffer();
});
