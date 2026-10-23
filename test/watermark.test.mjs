import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as PDFLib from 'pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {stampPdf,extractTrace,validTrace,paintTrace,encodeCode39} from '../public/trace-watermark.mjs';

test('download preserves original content with separate barcode and unlabelled code in a new right gutter',async()=>{
 const source=await PDFLib.PDFDocument.create(),crops=[];for(let n=1;n<=4;n++){const p=source.addPage(n===2?[842,595]:[595,842]);p.drawText('Original content page '+n,{x:40,y:80,size:20});p.setRotation(PDFLib.degrees((n-1)*90));const {width,height}=p.getSize();p.setCropBox(10,20,width-30,height-40);crops.push(p.getCropBox());}
 const bytes=await source.save(),original=bytes.slice(),progress=[];
 const marked=await stampPdf(bytes,'ABCD-EFGH',{PDFLib,onProgress:(n,total)=>progress.push([n,total])});assert.deepEqual(bytes,original);
 const doc=await PDFLib.PDFDocument.load(marked),key=PDFLib.PDFName.of('BibliothecaTrace');assert.equal(doc.getPageCount(),4);for(const [i,page] of doc.getPages().entries()){assert.equal(page.node.get(key).decodeText(),'ABCD-EFGH');const before=crops[i],after=page.getCropBox();assert.deepEqual(after,{x:before.x-(i===2?24:0),y:before.y-(i===3?24:0),width:before.width+(i%2===0?24:0),height:before.height+(i%2===1?24:0)});assert.equal(page.getRotation().angle,i*90);}
 assert.equal(doc.context.lookup(doc.context.trailerInfo.Info).get(key).decodeText(),'ABCD-EFGH');assert.deepEqual(progress.at(-1),[4,4]);
 const task=getDocument({data:marked.slice(),useSystemFonts:true,isEvalSupported:false});const pdf=await task.promise;
 try{for(let n=1;n<=4;n++){const page=await pdf.getPage(n),text=(await page.getTextContent()).items.map(i=>i.str).join(' ');assert.ok(text.includes('Original content page '+n));assert.equal(text.match(/ABCD-EFGH/g)?.length,1);assert.ok(!/Bibliotheca|AUTH|of 4/.test(text));const operators=await page.getOperatorList();assert.ok(operators.fnArray.length>encodeCode39('ABCD-EFGH').bars.length);}}finally{await task.destroy();}
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

test('reader preserves the canvas and varies separated barcode/text positions by page inside the new gutter',()=>{
 const placements=[];
 for(let page=1;page<=4;page++){
  const calls=[],c={save(){},restore(){},drawImage(...v){calls.push(['image',...v]);},fillRect(...v){calls.push(['rect',...v]);},measureText(){return {width:45};},translate(...v){calls.push(['translate',...v]);},rotate(v){calls.push(['rotate',v]);},fillText(...v){calls.push(['text',...v]);}};
  const backup={getContext:()=>c},canvas={width:1000,height:1400,style:{width:'500px'},ownerDocument:{createElement:()=>backup},getContext:()=>c};paintTrace(canvas,'ABCD-EFGH',page,5);
  assert.equal(canvas.width,1041);assert.equal(canvas.style.width,'520.5px');assert.equal(calls.filter(v=>v[0]==='image').length,2);
  const rects=calls.filter(v=>v[0]==='rect').slice(1);assert.equal(rects.length,encodeCode39('ABCD-EFGH').bars.length);for(const r of rects){assert.ok(r[1]>=1000);assert.ok(r[1]+r[3]<=canvas.width);assert.ok(r[2]>=0&&r[2]+r[4]<=canvas.height);}
  assert.deepEqual(calls.filter(v=>v[0]==='text'),[['text','ABCD-EFGH',0,0]]);assert.equal(calls.find(v=>v[0]==='rotate')[1],Math.PI/2);
  const translate=calls.find(v=>v[0]==='translate');assert.ok(translate[1]>1000);assert.ok(Math.abs(rects[0][2]-translate[2])>300);placements.push(rects[0][2]);
 }
 assert.equal(new Set(placements).size,4);
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
