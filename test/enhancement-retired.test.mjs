import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import worker from '../src/worker.mjs';

test('retired enhancement routes reject old clients and service credentials without any upstream or database work',async()=>{
 const previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error('Retired service must not be called');};
 const env={DB:{prepare(){throw Error('Retired service must not touch D1');}},PDF_ENHANCE_SERVICE:JSON.stringify({url:'https://unused.test',token:'old-token',apiKey:'old-service-key'})};
 try{
  for(const path of ['','/config','/portal','/portal/verify','/start','/step','/result','/file','/export'])for(const method of ['GET','POST']){
   const r=await worker.fetch(new Request('https://books.test/api/enhance'+path,{method,headers:{Authorization:'Bearer old-session','X-Tianhe-Service-Key':'old-service-key'}}),env,{});
   assert.equal(r.status,410,path);assert.match((await r.json()).error,/已停止/);
  }
  assert.equal(calls,0);
 }finally{globalThis.fetch=previous;}
});

test('both frontend builds offer direct PDF downloads and no enhancement entry or account control',async()=>{
 for(const dir of ['dist','dist-pages']){
  const index=await readFile(dir+'/index.html','utf8'),download=await readFile(dir+'/download.html','utf8'),retired=await readFile(dir+'/enhance.html','utf8');
  assert.doesNotMatch(index,/pdfEnhanceTool|canEnhance|天河增強權限|href="\.\/enhance\.html"/);
  assert.doesNotMatch(download,/\/api\/enhance|enhancedDownload|enhanceQuality|name="quality"/);
  assert.match(download,/savePdf\('\/file'\+location.search\)/);
  assert.match(retired,/已停止提供/);assert.doesNotMatch(retired,/<script|chatgpt\.site/);
 }
});
