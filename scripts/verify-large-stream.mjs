import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import * as PDFLib from 'pdf-lib';
import SparkMD5 from 'spark-md5';
import {Miniflare} from 'miniflare';
import {compileWatermarkedPdf} from '../public/pdf-watermark-builder.mjs';
import {random,hash,now,seal} from '../src/core.mjs';

// Exercise the bundled production Worker in a separate workerd isolate.
// Host-side source allocation models Drive; the Worker receives 64 KiB chunks.
// This verifies bounded streaming, not production Cloudflare CPU accounting.
const rawBytes=136*1024*1024,doc=await PDFLib.PDFDocument.create({updateMetadata:false});
doc.addPage().drawText('Synthetic large-stream verification only');
doc.context.register(PDFLib.PDFRawStream.of(doc.context.obj({Length:rawBytes}),randomBytes(rawBytes)));
const source=await doc.save({useObjectStreams:true}),asset={id:'large-stream-asset-001',size:source.length,md5:SparkMD5.ArrayBuffer.hash(source.buffer)};
console.log(JSON.stringify({phase:'compile',sourceBytes:source.length}));
const plan=await compileWatermarkedPdf(source,asset,{PDFLib,SparkMD5}),data=gzipSync(JSON.stringify(plan)).toString('base64');
const token=random(),key=random(),root='large-stream-root-001';let mediaRequests=0;
const bundled=await readFile(process.argv[2]||'../watermark-v2-dryrun/worker.js','utf8');
const mf=new Miniflare({modules:true,script:bundled,compatibilityDate:'2026-07-01',d1Databases:['DB'],bindings:{OWNER_EMAIL:'owner@example.com',TOKEN_ENCRYPTION_KEY:key,GOOGLE_CLIENT_ID:'fixture',GOOGLE_CLIENT_SECRET:'fixture',REFERENCE_ROOT_ID:root,MOCK_ROOT_ID:'large-mock-root-001'},outboundService(request){
 const url=new URL(request.url);
 if(url.hostname==='oauth2.googleapis.com')return Response.json({access_token:'fixture'});
 if(url.pathname==='/drive/v3/files/'+asset.id){
  if(url.searchParams.get('alt')!=='media')return Response.json({size:asset.size,md5Checksum:asset.md5,parents:[root]});
  mediaRequests++;const range=request.headers.get('Range'),match=range?.match(/^bytes=(\d+)-(\d+)$/);let at=match?Number(match[1]):0;const limit=match?Number(match[2])+1:source.length;
  return new Response(new ReadableStream({pull(c){if(at===limit){c.close();return;}const end=Math.min(limit,at+65536);c.enqueue(source.subarray(at,end));at=end;}}),{status:match?206:200,headers:{'Content-Length':String(limit-(match?Number(match[1]):0)),...(match?{'Content-Range':`bytes ${match[1]}-${match[2]}/${source.length}`}:{})}});
 }
 throw Error('Unexpected external request '+url.pathname);
}});
try{
 const DB=await mf.getD1Database('DB');
 for(const file of ['0001','0002','0003','0004','0005'])for(const sql of (await readFile('migrations/'+file+'.sql','utf8')).split(';').map(s=>s.trim()).filter(Boolean))await DB.prepare(sql).run();
 await DB.batch([
  DB.prepare('INSERT INTO users(email,individual,view_enabled) VALUES (?,1,1)').bind('owner@example.com'),
  DB.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(await hash(token),'owner@example.com','csrf',now()+3600),
  DB.prepare('INSERT INTO books VALUES (?,?,?,?)').bind(asset.id,'Synthetic','參考書',JSON.stringify({id:asset.id,title:'Synthetic',category:'參考書'})),
  DB.prepare('INSERT INTO assets(id,parent,book_id,name,mime,size,md5) VALUES (?,?,?,?,?,?,?)').bind(asset.id,root,asset.id,'Synthetic.pdf','application/pdf',asset.size,asset.md5),
  DB.prepare('INSERT INTO pdf_headers VALUES (?,?,?,?,?)').bind(asset.id,asset.size,asset.md5,'unused-by-watermarked-download',1),
  DB.prepare('INSERT INTO pdf_watermarks VALUES (?,?,?,?,?,?,?,?,?)').bind(asset.size,asset.md5,asset.id,data,await hash(data),1,plan.length,2,new Date().toISOString()),
  DB.prepare('INSERT INTO settings VALUES (?,?)').bind('drive',JSON.stringify({email:'owner@example.com',refresh:await seal('fixture-refresh',key)}))
 ]);
 const prepare=await mf.dispatchFetch('https://books.test/api/prepare',{method:'POST',headers:{Authorization:'Bearer '+token,Origin:'https://books.test','Content-Type':'application/json'},body:JSON.stringify({csrf:'csrf',bookId:asset.id,action:'download_request'})});assert.equal(prepare.status,200,await prepare.clone().text());
 const url=(await prepare.json()).url,started=performance.now(),response=await mf.dispatchFetch(url,{headers:{Authorization:'Bearer '+token}});
 if(response.status!==200)throw Error('Download failed '+response.status+': '+await response.text());
 assert.equal(response.headers.get('X-PDF-Watermark'),'server-v2');
 let bytes=0,maxChunk=0;const digest=createHash('sha256');
 for await(const chunk of response.body){bytes+=chunk.length;maxChunk=Math.max(maxChunk,chunk.length);digest.update(chunk);}
 assert.equal(bytes,plan.length);assert.equal(bytes,Number(response.headers.get('X-PDF-Bytes')));assert.equal(mediaRequests,1);assert.ok(bytes>128*1024*1024);assert.ok(maxChunk<8*1024*1024);
 const result={ok:true,sourceBytes:source.length,outputBytes:bytes,maxReturnedChunkBytes:maxChunk,driveMediaRequestsPerDownload:1,pages:1,wallMs:performance.now()-started,sha256:digest.digest('hex'),runtime:'local workerd isolate',localCompatibilityDate:'2026-07-01',productionCompatibilityDate:'2026-10-22',productionCpuVerified:false};
 console.log(JSON.stringify(result));if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(result,null,2)+'\n');
}finally{await mf.dispose();}
