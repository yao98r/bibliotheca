import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
test('download submits credentials in a POST body without buffering the PDF or exposing them in URLs',async()=>{
 const html=await readFile('dist/download.html','utf8'),code=html.slice(html.indexOf('async function savePdf('),html.indexOf('const message='));
 const fields={},calls=[];let submitted=false,form;
 const context={URLSearchParams,location:{search:'?ticket=opaque'},BACKEND:'https://books.test',savedSession:()=>({token:'private-session'}),remoteApi:async path=>{calls.push(path);return {csrf:'csrf-token'};},document:{body:{append(){}},createElement(tag){if(tag==='form')return form={append(input){fields[input.name]=input.value;},submit(){submitted=true;},remove(){}};return {};}}};
 vm.createContext(context);vm.runInContext(code,context);await context.savePdf('/file?ticket=opaque');
 assert.equal(submitted,true);assert.equal(form.method,'POST');assert.equal(form.action,'https://books.test/api/download/export');assert.deepEqual(fields,{token:'private-session',csrf:'csrf-token',ticket:'opaque'});assert.deepEqual(calls,['/api/me','/api/download-context?ticket=opaque']);assert.doesNotMatch(code,/arrayBuffer|createObjectURL|stampPdf/);
});
test('both builds remove all enhancement choices, entry and execution from the download flow',async()=>{
 for(const dir of ['dist','dist-pages']){
  const index=await readFile(dir+'/index.html','utf8'),download=await readFile(dir+'/download.html','utf8');
  assert.doesNotMatch(index,/pdfEnhanceTool|天河增強權限/);assert.doesNotMatch(download,/enhance\/|enhancement-time|enhanceQuality|enhancedDownload/);
  assert.match(await readFile(dir+'/enhance.html','utf8'),/已停止提供/);assert.match(download,/\/api\/download\/export/);
 }
});
