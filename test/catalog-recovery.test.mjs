import {test} from 'node:test';
import assert from 'node:assert/strict';
import original from '../src/restored-catalog.mjs';
import {updates,additions} from '../src/catalog-recovery.mjs';
import {restoredBooks,catalogEntries,restoredSource} from '../src/catalog.mjs';
test('additive recovery preserves every original question identity and original source metadata',()=>{
 for(const before of original){const after=restoredBooks.get(before.id);assert.ok(after);assert.equal(after.title,before.title);assert.equal(after.asset,before.asset);assert.equal(after.originalAsset,before.originalAsset);assert.equal(after.originalAnswerAsset,before.originalAnswerAsset);}
 assert.equal(restoredBooks.size,original.length+additions.length);
});
test('recovered answers retain their combined source and remain subject-specific',()=>{
 for(const [id,answer] of [['legacy-120','1N6cy48qq7XRtc8Tcr3cvHlFtXD6hr6B_'],['legacy-122','1-9lWzex-pjDh1JtyOTcyvlIE_gaXQHZw']]){
  const b=restoredBooks.get(id);assert.equal(restoredSource(b,'answer_download'),answer);assert.equal(b.answerSourceAsset,'1DgWdcSgU-vsQfwaM__cYcMbHqPPxVENt');
 }
 assert.equal(new Set(updates.map(x=>x.id)).size,updates.length);
});
test('recovered entries retain category checks and hide answers until indexing finishes',()=>{
 const b=restoredBooks.get('legacy-120'),owner='test-book';const books=new Map([[owner,{id:owner,title:'test',category:b.category,data:'{}'}]]);
 const q={id:b.asset,book_id:owner,parent:'root',mime:'application/pdf',name:'question.pdf'};
 const a={id:b.answerAsset,book_id:owner,parent:'root',mime:'application/pdf',name:'answer.pdf',indexedReady:0};
 assert.equal(catalogEntries([q,a],books).find(x=>x.legacyId===b.id).hasAnswer,false);
 a.indexedReady=1;assert.equal(catalogEntries([q,a],books).find(x=>x.legacyId===b.id).answerAsset,b.answerAsset);
 books.get(owner).category='參考書';assert.ok(!catalogEntries([q,a],books).some(x=>x.legacyId===b.id));
});
