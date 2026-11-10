import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const Estimate=vm.runInNewContext(await readFile('public/enhancement-time.js','utf8')+'\nEnhancementEstimate');
test('ETA waits for observations, estimates from measured progress, resets per phase and detects stalls',()=>{
 const e=new Estimate(0);
 assert.match(e.text(0),/估算中/);
 e.update({stage:'parallel',progress:5},0);
 e.update({stage:'parallel',progress:10},10000);
 assert.match(e.text(10000),/估算中/);
 e.update({stage:'parallel',progress:15},20000);
 assert.match(e.text(20000),/預估剩餘約 2 分鐘～4 分鐘/);
 assert.match(e.text(81000),/重新估算中/);
 e.update({stage:'merge',progress:75},82000);
 assert.match(e.text(82000),/估算中/);
 e.update({stage:'done',progress:100},100000);
 assert.match(e.text(100000),/處理完成/);
 assert.doesNotMatch(e.text(100000),/預估剩餘/);
});
test('resume uses only current observations; malformed and regressing progress never produce negative ETA',()=>{
 const e=new Estimate(1000,true);
 e.update({stage:'parallel',progress:60},1000);
 assert.match(e.text(5000),/本次已處理 4 秒.*估算中/);
 e.update({stage:'parallel',progress:NaN},6000);
 e.update({stage:'parallel',progress:63},11000);
 e.update({stage:'parallel',progress:66},21000);
 assert.match(e.text(21000),/預估剩餘約/);
 e.update({stage:'parallel',progress:60},22000);
 assert.match(e.text(22000),/估算中/);
});
test('both builds ship the estimator and stop its timer on success or failure',async()=>{
 for(const dir of ['dist','dist-pages']){
  const html=await readFile(dir+'/download.html','utf8');
  assert.match(html,/enhancement-time\.js\?v=20261110-1/);
  assert.match(html,/id="enhancementTime"/);
  assert.match(html,/finally\{clearInterval\(ticker\);\}/);
  assert.equal(await readFile(dir+'/enhancement-time.js','utf8'),await readFile('public/enhancement-time.js','utf8'));
 }
});
test('download flow renders elapsed time and clears the interval after completion and request failure',async()=>{
 const html=await readFile('download.html','utf8');
 const flow=html.slice(html.indexOf('async function enhancedDownload(){'),html.indexOf('async function download(){'));
 for(const fail of [false,true]){
  const elements=Object.fromEntries(['enhancementTime','estimateNote','dpi','removeWatermarks'].map(id=>[id,{hidden:true,value:800,checked:true}]));
  let cleared=false,submitted=false,steps=0,time=0;
  const context={EnhancementEstimate:Estimate,Date:{now:()=>time},sessionStorage:{getItem:()=> 'existing-job',removeItem(){}},jobKey:'test',currentUser:{csrf:'test'},message:{},bar:{},BACKEND:'https://example.invalid',savedSession:()=>({token:'test'}),setInterval:()=>7,clearInterval:id=>{assert.equal(id,7);cleared=true;},document:{getElementById:id=>elements[id],body:{append(){}},createElement:()=>({append(){},submit(){submitted=true;},remove(){}})},remoteApi:async()=>{time+=10000;if(fail)throw Error('request failed');return ++steps<4?{stage:'parallel',progress:5+steps*5}:{stage:'done',progress:100};}};
  vm.createContext(context);
  const run=vm.runInContext(flow+'\nenhancedDownload',context);
  if(fail){await assert.rejects(run,/request failed/);assert.match(elements.enhancementTime.textContent,/處理已暫停/);assert.equal(submitted,false);}
  else{await run();assert.match(elements.enhancementTime.textContent,/處理完成/);assert.equal(submitted,true);}
  assert.equal(elements.enhancementTime.hidden,false);assert.equal(cleared,true);
 }
});
