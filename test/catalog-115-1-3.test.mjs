import {test} from 'node:test';
import assert from 'node:assert/strict';
import batch from '../src/catalog-115-1-3.mjs';
import {catalogEntries,restoredSource} from '../src/catalog.mjs';

test('115-1-3 retains all 40 files, fills filters, and pairs only matching questions and answers',()=>{
 assert.equal(batch.length,40);
 assert.equal(new Set(batch.map(b=>b.asset)).size,40);
 assert.equal(batch.filter(b=>b.answerAsset).length,14);
 const books=new Map([['batch',{id:'batch',category:'模擬考題本',data:'{}'}]]);
 const assets=batch.map(b=>({id:b.asset,book_id:'batch',parent:'batch',name:b.title+'.pdf',mime:'application/pdf',indexedReady:1}));
 const result=catalogEntries(assets,books);
 assert.equal(result.length,40);
 for(const b of batch){
  assert.ok(b.publisher==='南一'||b.publisher==='翰林');
  assert.ok(b.subject);assert.equal(b.year,'115');assert.equal(b.category,'模擬考題本');
  const entry=result.find(e=>e.asset===b.asset);assert.ok(entry);assert.equal(entry.title,b.title);
  if(b.answerAsset){
   const answer=batch.find(a=>a.asset===b.answerAsset);assert.ok(answer);
   assert.equal(answer.title,b.title.replace(/Q$/,'A'));
   assert.equal(answer.subject,b.subject);assert.equal(answer.publisher,b.publisher);
   assert.equal(entry.hasAnswer,true);assert.equal(entry.answerBookId,'batch');
   assert.equal(restoredSource(b,'answer_download'),answer.asset);
  }else assert.equal(entry.hasAnswer,false);
 }
 // A question stays readable while its answer has no completed index.
 const q=batch.find(b=>b.answerAsset);assets.find(a=>a.id===q.answerAsset).indexedReady=0;
 assert.equal(catalogEntries(assets,books).find(e=>e.asset===q.asset).hasAnswer,false);
 assert.equal(catalogEntries(assets,new Map([['batch',{category:'參考書',data:'{}'}]])).some(e=>e.legacyId),false);
});
