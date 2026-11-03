import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {PDFDocument} from 'pdf-lib';

test('both published targets use matching official legacy API and worker bundles with fresh URLs',async()=>{
 for(const dir of ['dist','dist-pages']){
  for(const file of ['pdf.min.mjs','pdf.worker.min.mjs'])assert.equal(await readFile(dir+'/assets/'+file,'utf8'),"import './pdf-compat.mjs?build=legacy-20261103';\n"+await readFile('node_modules/pdfjs-dist/legacy/build/'+file,'utf8'));
  const html=await readFile(dir+'/viewer.html','utf8');
  assert.match(html,/pdf\.min\.mjs\?build=legacy-20261103/);
  assert.match(html,/pdf\.worker\.min\.mjs\?build=legacy-20261103/);
 }
});

test('reader opens text and image pages when modern Map, WeakMap and Promise methods are missing',async()=>{
 const doc=await PDFDocument.create({updateMetadata:false});
 const png=await doc.embedPng(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'));
 for(let n=1;n<=11;n++){const p=doc.addPage([400,500]);p.drawText('Compatibility page '+n,{x:30,y:450});p.drawImage(png,{x:30,y:30,width:20,height:20});}
 const input=Buffer.from(await doc.save()).toString('base64');
 const script=`
  import assert from 'node:assert/strict';
  for(const type of [Map,WeakMap])for(const name of ['getOrInsert','getOrInsertComputed'])delete type.prototype[name];
  delete Promise.withResolvers;delete Promise.try;delete Uint8Array.fromBase64;
  assert.equal(Map.prototype.getOrInsertComputed,undefined);
  const pdfjs=await import(process.argv[1]);pdfjs.GlobalWorkerOptions.workerSrc=process.argv[2];
  assert.equal(typeof Map.prototype.getOrInsertComputed,'function');
  assert.equal(typeof WeakMap.prototype.getOrInsertComputed,'function');
  assert.equal(typeof Promise.withResolvers,'function');
  class SubPromise extends Promise{};const capability=Promise.withResolvers.call(SubPromise);assert.ok(capability.promise instanceof SubPromise);capability.resolve(42);assert.equal(await capability.promise,42);
  assert.equal(await Promise.try((a,b)=>a+b,2,3),5);await assert.rejects(Promise.try(()=>{throw Error('expected');}),/expected/);
  const task=pdfjs.getDocument({data:new Uint8Array(Buffer.from(process.argv[3],'base64')),isEvalSupported:false,isImageDecoderSupported:false,isOffscreenCanvasSupported:false,useSystemFonts:true});
  try{const pdf=await task.promise;assert.equal(pdf.numPages,11);for(const n of [1,2,11]){const page=await pdf.getPage(n);assert.ok((await page.getTextContent()).items.some(i=>i.str.includes('Compatibility page '+n)));const ops=await page.getOperatorList();assert.ok(ops.fnArray.some(op=>op===pdfjs.OPS.paintImageXObject||op===pdfjs.OPS.paintInlineImageXObject||op===pdfjs.OPS.paintImageMaskXObject));}console.log('legacy reader: text, images and navigation passed');}finally{await task.destroy();}
 `;
 const output=execFileSync(process.execPath,['--input-type=module','-e',script,pathToFileURL(resolve('dist/assets/pdf.min.mjs')).href,pathToFileURL(resolve('dist/assets/pdf.worker.min.mjs')).href,input],{encoding:'utf8',timeout:30000});
 assert.match(output,/legacy reader: text, images and navigation passed/);
});

test('the separately loaded PDF worker installs compatibility in its own realm',()=>{
 const script=`
 import assert from 'node:assert/strict';
 delete Map.prototype.getOrInsertComputed;delete WeakMap.prototype.getOrInsertComputed;delete Promise.withResolvers;delete Promise.try;
 const worker=await import(process.argv[1]);
 for(const method of [Map.prototype.getOrInsertComputed,WeakMap.prototype.getOrInsertComputed,Promise.withResolvers,Promise.try])assert.equal(typeof method,'function');
 assert.equal(typeof worker.WorkerMessageHandler.setup,'function');
 console.log('worker realm passed');`;
 assert.match(execFileSync(process.execPath,['--input-type=module','-e',script,pathToFileURL(resolve('dist/assets/pdf.worker.min.mjs')).href],{encoding:'utf8',timeout:30000}),/worker realm passed/);
});
