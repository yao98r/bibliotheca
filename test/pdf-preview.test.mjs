import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {PagePreviewCache,readPdfBytes} from '../public/pdf-preview.mjs';
const item=(n=100)=>({canvas:{width:n,height:n}});
test('preview requests deduplicate work and evict old canvases within the memory budget',async()=>{
 const cache=new PagePreviewCache({maxPages:2,maxPixels:20000});let calls=0;
 const [a,b]=await Promise.all([cache.getOrRender('1',async()=>{calls++;return item();}),cache.getOrRender('1',async()=>{throw Error('duplicate');})]);
 assert.equal(a,b);assert.equal(calls,1);
 await cache.getOrRender('2',()=>item());await cache.getOrRender('1',()=>{throw Error('cached');});await cache.getOrRender('3',()=>item());
 assert.equal(cache.items.has('1'),true);assert.equal(cache.items.has('2'),false);assert.equal(cache.pixels,20000);
 cache.clear();assert.equal(a.canvas.width,0);assert.equal(cache.pixels,0);
});
test('closing a viewer discards late background results; oversized previews are releasable',async()=>{
 const cache=new PagePreviewCache({maxPixels:100});let finish;
 const pending=cache.getOrRender('late',()=>new Promise(resolve=>{finish=resolve;}));await Promise.resolve();cache.clear();const late=item();finish(late);await assert.rejects(pending,/重設/);assert.equal(late.canvas.width,0);
 const big=await cache.getOrRender('big',()=>item());assert.equal(cache.items.size,0);cache.release(big);assert.equal(big.canvas.width,0);
});
test('full PDF reads report progress without accepting partial or oversized responses',async()=>{
 const progress=[];const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2]));c.enqueue(new Uint8Array([3]));c.close();}}),{headers:{'X-PDF-Bytes':'3'}});
 assert.deepEqual([...await readPdfBytes(response,(a,b)=>progress.push([a,b]))],[1,2,3]);assert.deepEqual(progress,[[2,3],[3,3]]);
 await assert.rejects(readPdfBytes(new Response('a',{headers:{'X-PDF-Bytes':'2'}})),/中斷/);
 await assert.rejects(readPdfBytes(new Response('abc',{headers:{'X-PDF-Bytes':'2'}})),/不符/);
 assert.equal((await readPdfBytes(new Response('abc'))).length,3);
});
test('fast preview downloads once, reuses rendered pages and does not enable full-file delivery for protected users',async()=>{
 const html=await readFile('dist/viewer.html','utf8'),start=html.indexOf('function previewDimensions('),end=html.indexOf('\ntry{me=await api',start),code=html.slice(start,end);assert.ok(start>=0&&end>start);
 for(const mode of ['fast','protected']){
  const paths=[],rendered=[],scheduled=[],elements=new Map();let copies=0;
  const canvas=()=>({width:0,height:0,style:{},getContext:()=>({drawImage:()=>{copies++;}})});
  const $=id=>{if(!elements.has(id))elements.set(id,id==='page'?canvas():{style:{}});return elements.get(id);};
  const doc={numPages:3,getPage:async n=>({getViewport:({scale})=>({width:595*scale,height:842*scale}),cleanup(){},number:n}),loadingTask:{destroy:async()=>{}}};
  const sandbox={URLSearchParams,$,params:new URLSearchParams({ticket:'test'}),me:{csrf:'csrf'},data:{readingMode:mode,pages:3,watermark:'server-v2'},pdfjs:{getDocument:()=>({promise:Promise.resolve(doc)}),OPS:{}},pdfRenderer:async source=>rendered.push(source.number),tracePainter(){},previews:new PagePreviewCache(),page:1,loading:false,fastDoc:null,warmTimer:null,serverPageStamped:true,pdfBytes:async path=>{paths.push(path);return new Uint8Array();},pdfOptions:()=>({}),api:async()=>({}),innerWidth:400,devicePixelRatio:2,document:{createElement:canvas,visibilityState:'visible'},addEventListener(){},clearTimeout(){},setTimeout:fn=>{scheduled.push(fn);return scheduled.length;},console};
  vm.createContext(sandbox);vm.runInContext(code,sandbox);await sandbox.display(1);if(mode==='fast'){await scheduled.pop()();assert.deepEqual(rendered,[1,2],'next page is rendered before it is requested');}await sandbox.display(2);await sandbox.display(1);
  if(mode==='fast'){assert.equal(paths.length,1);assert.match(paths[0],/^\/api\/fast-file/);assert.deepEqual(rendered,[1,2]);assert.equal(copies,3);}
  else{assert.equal(paths.length,3);assert.ok(paths.every(p=>p.startsWith('/api/page?')));}
 }
});
