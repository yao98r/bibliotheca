import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import * as PDFLib from 'pdf-lib';
import SparkMD5 from 'spark-md5';
import {randomBytes} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {compileWatermarkedPdf} from '../public/pdf-watermark-builder.mjs';
import {validateWatermarkTemplate,decodeWatermarkTemplate,personalizeWatermark,composeWatermarkedPdf,watermarkProof} from '../src/backend-watermark.mjs';
import {random} from '../src/core.mjs';
import {Miniflare} from 'miniflare';
let source,asset,plan,template;
before(async()=>{
 const doc=await PDFLib.PDFDocument.create({updateMetadata:false});
 for(let n=0;n<70;n++){const p=doc.addPage([595,842]);for(let line=0;line<35;line++)p.drawText('ORIGINAL PAGE '+(n+1)+' LINE '+line,{x:40,y:750-line*18,size:11});p.setRotation(PDFLib.degrees(n%4*90));p.setCropBox(10,20,570,800);}
 doc.context.register(PDFLib.PDFRawStream.of(doc.context.obj({Length:9*1024*1024}),randomBytes(9*1024*1024)));
 source=await doc.save({useObjectStreams:true});asset={size:source.length,md5:SparkMD5.ArrayBuffer.hash(source.buffer)};
 plan=await compileWatermarkedPdf(source,asset,{PDFLib,SparkMD5});template=validateWatermarkTemplate(plan,asset);
});
function stream(bytes=source){let at=0;return new ReadableStream({pull(c){if(at===bytes.length){c.close();return;}const end=Math.min(bytes.length,at+65536);c.enqueue(bytes.subarray(at,end));at=end;}});}
async function compose(code='ABCD-EFGH',proof='1'.repeat(64),input=stream()){
 return new Uint8Array(await new Response(composeWatermarkedPdf(input,asset,template,personalizeWatermark(template,code,proof))).arrayBuffer());
}

test('full backend reconstruction supports more than 8 MiB and 64 pages without preserving the original PDF prefix',async t=>{
 assert.ok(source.length>8*1024*1024);assert.equal(plan.pages,70);assert.ok(template.rangeCount>0);assert.ok(template.metadata.length<100000);
 const started=performance.now(),bytes=await compose(),elapsed=performance.now()-started;
 assert.equal(bytes.length,plan.length);assert.notEqual(Buffer.compare(bytes.subarray(0,source.length),source),0);assert.equal(Buffer.from(bytes).indexOf(source),-1);
 const doc=await PDFLib.PDFDocument.load(bytes,{updateMetadata:false}),original=await PDFLib.PDFDocument.load(source,{updateMetadata:false});assert.equal(doc.getPageCount(),70);
 for(let i=0;i<70;i++){
  const page=doc.getPage(i),before=original.getPage(i);assert.deepEqual(page.getMediaBox(),before.getMediaBox());assert.deepEqual(page.getCropBox(),before.getCropBox());assert.equal(page.getRotation().angle,before.getRotation().angle);
  assert.equal(page.node.get(PDFLib.PDFName.of('BibliothecaTrace')).decodeText(),'ABCD-EFGH');
 }
 const info=doc.context.lookup(doc.context.trailerInfo.Info);assert.equal(info.get(PDFLib.PDFName.of('BibliothecaProof')).decodeText(),'1'.repeat(64));
 const task=getDocument({data:bytes.slice(),useSystemFonts:true,isEvalSupported:false});
 try{const pdf=await task.promise;for(const n of [1,2,35,70]){const page=await pdf.getPage(n);assert.ok((await page.getTextContent()).items.some(i=>i.str.includes('ORIGINAL PAGE '+n)));assert.ok((await page.getOperatorList()).fnArray.length>60);}}finally{await task.destroy();}
 t.diagnostic(JSON.stringify({sourceBytes:source.length,outputBytes:bytes.length,pages:70,metadataBytes:template.metadata.length,ranges:template.rangeCount,nodeStreamWallMs:elapsed,productionCpuVerified:false}));
});

test('personalization and HMAC signatures remain isolated between concurrent readers',async()=>{
 const key=random(),ticket={hash:'ticket-hash',trace_code:'ABCD-EFGH',email:'reader@example.com'};
 const proof=await watermarkProof(key,ticket,asset);assert.equal(proof.length,64);assert.equal(await watermarkProof(key,ticket,asset),proof);
 assert.notEqual(await watermarkProof(key,{...ticket,email:'another@example.com'},asset),proof);
 assert.notEqual(await watermarkProof(key,ticket,{...asset,md5:'replacement'}),proof);
 const [a,b]=await Promise.all([compose('ABCD-EFGH',proof),compose('JKLM-NPQR','2'.repeat(64))]);assert.equal(a.length,b.length);assert.notDeepEqual(a,b);
 assert.equal(new TextDecoder().decode(template.metadata.subarray(plan.slots.codes[0],plan.slots.codes[0]+9)),'ZZZZ-ZZZZ');
 const binary=new TextDecoder('latin1').decode(a);assert.ok(!binary.includes(ticket.email));
});

test('truncated, oversized and cancelled Drive streams never complete a valid output',async()=>{
 await assert.rejects(compose('ABCD-EFGH','1'.repeat(64),stream(source.subarray(0,source.length-1))),/Incomplete/);
 const oversized=Buffer.concat([source,Buffer.from([0])]);await assert.rejects(compose('ABCD-EFGH','1'.repeat(64),stream(oversized)),/Oversized/);
 let cancelled=false;const input=new ReadableStream({pull(){},cancel(){cancelled=true;}});
 const output=composeWatermarkedPdf(input,asset,template,personalizeWatermark(template,'ABCD-EFGH','1'.repeat(64)));await output.cancel();assert.equal(cancelled,true);
});

test('templates bind to source checksum and reject backward ranges or forged personalization slots',async()=>{
 await assert.rejects(decodeWatermarkTemplate('invalid',asset),e=>e.status===400);
 const payload=gzipSync(JSON.stringify(plan)).toString('base64');assert.equal((await decodeWatermarkTemplate(payload,asset)).plan.length,plan.length);
 assert.throws(()=>validateWatermarkTemplate(plan,{...asset,md5:'wrong'}),e=>e.status===400);
 const invalid=structuredClone(plan);invalid.slots.proof=0;assert.throws(()=>validateWatermarkTemplate(invalid,asset),e=>e.status===400);
 const reordered=structuredClone(plan);const at=reordered.segments.findIndex(s=>s[0]===1);reordered.segments.splice(at+1,0,[...reordered.segments[at]]);assert.throws(()=>validateWatermarkTemplate(reordered,asset),e=>e.status===400);
});

test('native Worker source failures never produce a complete PDF or matching byte count', {timeout:15000},async()=>{
 const mf=new Miniflare({modules:true,modulesRoot:process.cwd(),scriptPath:'test/fixtures/watermark-stream-worker.mjs',compatibilityDate:'2026-07-01'});
 try{
  const data=gzipSync(JSON.stringify(plan)).toString('base64');
  for(const failure of ['eof','disconnect']){
   const response=await mf.dispatchFetch('https://watermark.test/',{method:'POST',body:JSON.stringify({asset,data,failure})});
   if(response.status!==200)throw Error('Fixture returned '+response.status+': '+await response.text());
   let bytes;try{bytes=new Uint8Array(await response.arrayBuffer());}catch{continue;}
   // Some local workerd/HTTP-proxy versions return a partial body instead of
   // surfacing the transport exception. The client must reject its byte count.
   assert.ok(bytes.length<Number(response.headers.get('X-PDF-Bytes')));
   assert.notEqual(new TextDecoder().decode(bytes.subarray(-6)),'%%EOF\n');
  }
 }finally{await mf.dispose();}
});
