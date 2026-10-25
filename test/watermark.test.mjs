import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as PDFLib from 'pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {stampPdf,extractTrace,validTrace,paintTrace,encodeCode39} from '../public/trace-watermark.mjs';

test('watermarked PDF preserves page boxes, rotation and original text with a subtle edge barcode',async()=>{
 const source=await PDFLib.PDFDocument.create(),crops=[];for(let n=1;n<=4;n++){const p=source.addPage(n===2?[842,595]:[595,842]);p.drawText('Original content page '+n,{x:40,y:80,size:20});p.setRotation(PDFLib.degrees((n-1)*90));const {width,height}=p.getSize();p.setCropBox(10,20,width-30,height-40);crops.push(p.getCropBox());}
 const bytes=await source.save(),original=bytes.slice(),progress=[];
 const marked=await stampPdf(bytes,'ABCD-EFGH',{PDFLib,onProgress:(n,total)=>progress.push([n,total])});assert.deepEqual(bytes,original);
 const doc=await PDFLib.PDFDocument.load(marked),key=PDFLib.PDFName.of('BibliothecaTrace');assert.equal(doc.getPageCount(),4);for(const [i,page] of doc.getPages().entries()){assert.equal(page.node.get(key).decodeText(),'ABCD-EFGH');const before=crops[i],after=page.getCropBox();assert.deepEqual(after,before);assert.equal(page.getRotation().angle,i*90);}
 assert.equal(doc.context.lookup(doc.context.trailerInfo.Info).get(key).decodeText(),'ABCD-EFGH');assert.deepEqual(progress.at(-1),[4,4]);
 const task=getDocument({data:marked.slice(),useSystemFonts:true,isEvalSupported:false});const pdf=await task.promise;
 try{for(let n=1;n<=4;n++){const page=await pdf.getPage(n),text=(await page.getTextContent()).items.map(i=>i.str).join(' ');assert.ok(text.includes('Original content page '+n));assert.equal(text.includes('ABCD-EFGH'),false);assert.ok(!/Bibliotheca|AUTH|of 4/.test(text));const operators=await page.getOperatorList();assert.ok(operators.fnArray.length>encodeCode39('ABCD-EFGH').bars.length);}}finally{await task.destroy();}
 assert.equal(await extractTrace(new Blob([marked]),async()=>PDFLib),'ABCD-EFGH');
 await assert.rejects(stampPdf(bytes,'invalid',{PDFLib}),/授權碼無效/);assert.equal(validTrace('ABCD-EFGH'),true);
});

test('Code 39 bars independently decode to the code and Mod43 checksum with quiet zones',()=>{
 // Independent pattern oracle: ReportLab Code39 patterns, narrow/wide 1:2.
 const oracle={'bSbsBsBsb':'*','BsbsbSbsB':'A','bsBsbSbsB':'B','BsBsbSbsb':'C','bsbsBSbsB':'D','BsbsBSbsb':'E','bsBsBSbsb':'F','bsbsbSBsB':'G','BsbsbSBsb':'H','bSbsbsBsB':'-'};
 const {bars,units}=encodeCode39('ABCD-EFGH');let decoded='';assert.equal(bars[0].position,10);assert.equal(units-(bars.at(-1).position+bars.at(-1).width),10);
 for(let i=0;i<bars.length;i+=5){let pattern='';for(let k=0;k<5;k++){const bar=bars[i+k];pattern+=bar.width===2?'B':'b';if(k<4){const gap=bars[i+k+1].position-bar.position-bar.width;assert.ok(gap===1||gap===2);pattern+=gap===2?'S':'s';}}assert.ok(oracle[pattern],pattern);decoded+=oracle[pattern];if(i+5<bars.length)assert.equal(bars[i+5].position-bars[i+4].position-bars[i+4].width,1);}
 assert.equal(decoded,'*ABCD-EFGHF*');assert.throws(()=>encodeCode39('invalid'),/授權碼無效/);
});

test('reader adds a subtle edge barcode without resizing or redrawing original content',()=>{
 const positions=[];
 for(let page=1;page<=4;page++){
  const calls=[],c={save(){},restore(){},fillRect(...v){calls.push(v);}};
  const canvas={width:1000,height:1400,style:{width:'500px'},getContext:()=>c};
  paintTrace(canvas,'ABCD-EFGH',page,5);
  assert.equal(canvas.width,1000);assert.equal(canvas.height,1400);assert.equal(canvas.style.width,'500px');
  assert.equal(c.fillStyle,'#ccc');assert.equal(calls.length,encodeCode39('ABCD-EFGH').bars.length);
  for(const [x,y,w,h] of calls){assert.ok(x>990&&x+w<=1000);assert.ok(y>=0&&y+h<=1400);assert.ok(w<3);}
  positions.push(calls[0][1]);
 }
 assert.equal(new Set(positions).size,4);
});

test('trace extraction retains original octal-hyphen downloads and missing codes return null',async()=>{
 const old=new Blob(['/BibliothecaTrace (ABCD\\055EFGH)']);assert.equal(await extractTrace(old,()=>{throw Error('parser unnecessary');}),'ABCD-EFGH');
 const doc=await PDFLib.PDFDocument.create();doc.addPage();assert.equal(await extractTrace(new Blob([await doc.save()]),async()=>PDFLib),null);
});

test('download page refuses incomplete files and uses the same ticket for metadata and content',async()=>{
 const html=await readFile('dist/download.html','utf8'),code=html.slice(html.indexOf('async function savePdf('),html.indexOf('const message=',html.indexOf('async function savePdf(')));
 const vm=await import('node:vm'),calls=[],sandbox={URLSearchParams,location:{search:'?ticket=opaque'},remoteApi:async path=>{calls.push(path);return {traceCode:'ABCD-EFGH'};},authorizedFetch:async path=>{calls.push(path);return new Response('PDF',{headers:{'X-PDF-Bytes':'9'}});},Uint8Array};
 vm.createContext(sandbox);vm.runInContext(code,sandbox);await assert.rejects(sandbox.savePdf('/file?ticket=opaque'),/傳輸中斷/);assert.deepEqual(calls,['/api/download-context?ticket=opaque','/file?ticket=opaque']);
});

test('server-composed downloads save exact backend bytes without invoking any client PDF library',async()=>{
 const html=await readFile('dist/download.html','utf8'),code=html.slice(html.indexOf('async function savePdf('),html.indexOf('const message=',html.indexOf('async function savePdf(')));
 const vm=await import('node:vm'),bytes=new TextEncoder().encode('SERVER-PERSONALIZED-PDF');let saved;
 const link={click(){},set href(value){},set download(value){assert.equal(value,'Prepared.pdf');}};
 const sandbox={URLSearchParams,location:{search:'?ticket=opaque'},remoteApi:async()=>({traceCode:'ABCD-EFGH',title:'Prepared.pdf'}),authorizedFetch:async()=>new Response(bytes,{headers:{'X-PDF-Bytes':String(bytes.length),'X-PDF-Watermark':'server-v2'}}),Uint8Array,Blob,URL:{createObjectURL(blob){saved=blob;return 'blob:prepared';},revokeObjectURL(){}},document:{createElement(){return link;}},setTimeout(){}};
 vm.createContext(sandbox);vm.runInContext(code,sandbox);await sandbox.savePdf('/file?ticket=opaque');assert.deepEqual(new Uint8Array(await saved.arrayBuffer()),bytes);
});
