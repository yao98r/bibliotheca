import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as PDFLib from 'pdf-lib';
import SparkMD5 from 'spark-md5';
import {getDocument,OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {barcodeCommands} from '../public/pdf-watermark-format.mjs';
import {encodeCode39} from '../public/trace-watermark.mjs';
import {preparePdf} from '../public/pdf-index-builder.mjs';
import {personalizeIndexedPage} from '../src/page-watermark.mjs';
import {singlePage} from '../src/drive.mjs';
const chunks=(entry,source)=>entry.parts.map(p=>typeof p==='string'?new Uint8Array(Buffer.from(p,'base64')):source.slice(p[0],p[0]+p[1]));
test('opt-in server page marks survive removal of browser painting and isolate concurrent users',async()=>{
 const original=await PDFLib.PDFDocument.create({updateMetadata:false});
 for(const rotation of [0,90,180,270]){const p=original.addPage([595,842]);p.drawText('Searchable formula x^2 + y^2 = z^2',{x:50,y:700,size:13});p.setRotation(PDFLib.degrees(rotation));p.setCropBox(10,20,570,800);}
 const source=await original.save(),expected={size:source.length,md5:SparkMD5.ArrayBuffer.hash(source.buffer)};
 const builder=await preparePdf(source,expected,{PDFLib,SparkMD5,pageWatermark:true});
 for(let n=1;n<=4;n++){
  const entry=await builder.page(n),parts=chunks(entry,source),a=personalizeIndexedPage(entry,parts,'ABCD-EFGH'),b=personalizeIndexedPage(entry,parts,'JKLM-NPQR');
  assert.equal(a.length,entry.length);assert.notDeepEqual(a,b);
  const doc=await PDFLib.PDFDocument.load(a,{updateMetadata:false});assert.equal(doc.getPageCount(),1);assert.equal(doc.getPage(0).getRotation().angle,(n-1)*90);
  assert.equal(doc.getPage(0).node.get(PDFLib.PDFName.of('BibliothecaTrace')).decodeText(),'ABCD-EFGH');
  assert.ok(doc.context.enumerateIndirectObjects().some(([,o])=>o instanceof PDFLib.PDFRawStream&&Buffer.from(o.contents).toString()===barcodeCommands('ABCD-EFGH',encodeCode39)));
  const task=getDocument({data:a.slice(),useSystemFonts:true});
  try{const pdf=await task.promise,page=await pdf.getPage(1);assert.ok((await page.getTextContent()).items.some(i=>i.str.includes('Searchable formula')));assert.ok((await page.getOperatorList()).fnArray.includes(OPS.paintFormXObjectBegin),'server page must paint its barcode form');}finally{await task.destroy();}
  assert.throws(()=>personalizeIndexedPage({...entry,watermark:{...entry.watermark,barcode:0}},parts,'ABCD-EFGH'),e=>e.status===409);
  assert.ok(Buffer.concat(parts).includes(Buffer.from('ZZZZ-ZZZZ')),'immutable template survives personalization');
  if(n===1){
   const previous=globalThis.fetch;let marked=false;
   globalThis.fetch=async(_url,options)=>{const [,start,end]=options.headers.Range.match(/^bytes=(\d+)-(\d+)$/);return new Response(source.slice(Number(start),Number(end)+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${source.length}`}});};
   try{const stream=await singlePage({}, {id:'fixture',size:source.length},{pages:[entry]},1,'JKLM-NPQR','fixture-token',()=>{marked=true;});const document=await PDFLib.PDFDocument.load(await new Response(stream).arrayBuffer());assert.equal(marked,true);assert.equal(document.getPage(0).node.get(PDFLib.PDFName.of('BibliothecaTrace')).decodeText(),'JKLM-NPQR');assert.equal(document.context.lookup(document.context.trailerInfo.Info).get(PDFLib.PDFName.of('BibliothecaTrace')).decodeText(),'JKLM-NPQR');}finally{globalThis.fetch=previous;}
  }
 }
 const legacy=await preparePdf(source,expected,{PDFLib,SparkMD5}),entry=await legacy.page(1);assert.equal(entry.watermark,undefined);assert.equal(personalizeIndexedPage(entry,chunks(entry,source),'ABCD-EFGH'),null);
});
