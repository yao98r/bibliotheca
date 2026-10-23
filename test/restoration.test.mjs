import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import restored from '../src/restored-catalog.mjs';
import {catalogEntries,categoryRepairs,restoredCategory} from '../src/catalog.mjs';

const book=(id,category)=>({id,title:id,category,data:JSON.stringify({id,title:id,category})});
const pdf=(id,owner,parent='root')=>({id,book_id:owner,parent,name:id+'.pdf',mime:'application/pdf'});
test('recovered v22 keeps all 449 identities and the 66 later mock additions',()=>{
 assert.equal(restored.length,449);assert.equal(new Set(restored.map(b=>b.id)).size,449);
 assert.equal(restored.filter(b=>b.category==='模擬考題本').length,289);
 assert.equal(restored.filter(b=>b.category==='參考書').length,160);
 assert.equal(restored.filter(b=>b.id.startsWith('exam-20261021-')).length,66);
});
test('exact source IDs pair questions and answers across scanned folder groups',()=>{
 const source=restored.find(b=>b.answerAsset&&b.category==='模擬考題本');
 const books=new Map([['questions',book('questions',source.category)],['answers',book('answers',source.category)]]);
 const result=catalogEntries([pdf(source.asset,'questions'),pdf(source.answerAsset,'answers')],books);
 const paired=result.find(b=>b.legacyId===source.id);assert.ok(paired);assert.equal(paired.title,source.title);
 assert.equal(paired.hasAnswer,true);assert.equal(paired.answerAsset,source.answerAsset);assert.equal(paired.answerBookId,'answers');
 assert.ok(!result.some(b=>b.asset===source.answerAsset),'paired answer must not become a separate book');
 assert.equal(paired.year,source.year);
});
test('missing or incorrectly classified answers cannot enable an answer button',()=>{
 const source=restored.find(b=>b.answerAsset&&b.category==='模擬考題本');
 const books=new Map([['q',book('q',source.category)],['wrong',book('wrong','參考書')]]);
 const result=catalogEntries([pdf(source.asset,'q'),pdf(source.answerAsset,'wrong')],books);
 const main=result.find(b=>b.legacyId===source.id);assert.equal(main.hasAnswer,false);assert.equal(main.answerAsset,null);
});
test('new answers remain hidden until the PDF index is ready',()=>{
 const source=restored.find(b=>b.answerAsset&&b.category==='模擬考題本'),books=new Map([['q',book('q',source.category)]]);
 const result=catalogEntries([pdf(source.asset,'q'),{...pdf(source.answerAsset,'q'),indexedReady:0}],books);
 assert.equal(result.find(b=>b.legacyId===source.id).hasAnswer,false);
});
test('known source IDs retain their original reference category on future scans',()=>{
 const b=restored.find(b=>b.category==='參考書');assert.equal(restoredCategory(b.asset,'模擬考題本'),'參考書');
 const plan=categoryRepairs([pdf(b.asset,'misclassified')],new Map([['misclassified',book('misclassified','模擬考題本')]]));
 assert.equal(plan.changes.length,1);assert.equal(plan.changes[0].category,'參考書');
 assert.equal(restoredCategory('unknown','模擬考題本'),'模擬考題本');
});
test('a catalog-only user cannot see another category through an answer mapping',()=>{
 const source=restored.find(b=>b.answerAsset&&b.category==='模擬考題本');
 assert.deepEqual(catalogEntries([pdf(source.asset,'hidden'),pdf(source.answerAsset,'hidden')],new Map()),[]);
});

test('standalone reference answers receive the same category as their original book',()=>{
 const source=restored.find(b=>b.category==='參考書'&&b.answerAsset);
 const assets=[pdf(source.asset,'question'),pdf(source.answerAsset,'answer')];
 const books=new Map([['question',book('question','參考書')],['answer',book('answer','模擬考題本')]]);
 assert.equal(restoredCategory(source.answerAsset,'模擬考題本'),'參考書');
 const plan=categoryRepairs(assets,books);assert.equal(plan.conflicts.length,0);assert.equal(plan.changes.length,1);assert.equal(plan.changes[0].id,'answer');
 books.set('answer',book('answer',plan.changes[0].category));
 const entries=catalogEntries(assets,books);assert.equal(entries.find(b=>b.legacyId===source.id).hasAnswer,true);assert.ok(!entries.some(b=>b.asset===source.answerAsset));
});

test('a shared folder with contradictory catalog categories is not reclassified automatically',()=>{
 const reference=restored.find(b=>b.category==='參考書'&&b.answerAsset),mock=restored.find(b=>b.category==='模擬考題本');
 const plan=categoryRepairs([pdf(reference.answerAsset,'mixed'),pdf(mock.asset,'mixed')],new Map([['mixed',book('mixed','模擬考題本')]]));
 assert.deepEqual(plan.changes,[]);assert.deepEqual(plan.conflicts,['mixed']);
});
test('unknown PDF names do not get paired by similar titles',()=>{
 const books=new Map([['q',book('q','模擬考題本')]]);
 const result=catalogEntries([{...pdf('unrecognized-E2','q'),name:'110-E2_數學_答案.pdf'}],books);
 assert.equal(result.length,1);assert.equal(result[0].hasAnswer,false);assert.equal(result[0].asset,'unrecognized-E2');
});
test('a mapped folder groups its descendants while preserving unrelated PDFs',()=>{
 const source=restored[0],books=new Map([['group',book('group',source.category)]]);
 const result=catalogEntries([{id:source.asset,book_id:'group',parent:'root',name:'folder',mime:'application/vnd.google-apps.folder'},pdf('chapter','group',source.asset),pdf('unrelated','group')],books);
 assert.ok(result.find(b=>b.legacyId===source.id)?.folder);
 assert.ok(!result.some(b=>b.asset==='chapter'));assert.ok(result.some(b=>b.asset==='unrelated'));
});
test('built entry buttons send the correct question or answer asset and book',async()=>{
 const html=await readFile('dist/index.html','utf8');
 const code=html.slice(html.indexOf('async function recordOpen('),html.indexOf('async function showFiles()'));
 const calls=[],location={};const sandbox={status(){},me:{csrf:'csrf'},crypto:{randomUUID:()=> 'event'},location,api:async(p,b)=>{calls.push(b);return {url:'/viewer?ticket=opaque'};}};
 vm.createContext(sandbox);vm.runInContext(code,sandbox);
 const b={id:'q-book',asset:'q-file',answerBookId:'a-book',answerAsset:'a-file'};
 for(const action of ['open','download_request','answer_open','answer_download'])await sandbox.recordOpen(b,action,{disabled:false});
 assert.deepEqual(calls.map(b=>[b.bookId,b.asset]),[['q-book','q-file'],['q-book','q-file'],['a-book','a-file'],['a-book','a-file']]);
 assert.equal(location.href,'/viewer?ticket=opaque');
});
test('Notion continuation retains the validated explicit asset after context lookup',async()=>{
 const html=await readFile('dist/go.html','utf8');assert.match(html,/context\.asset\?\{asset:context\.asset\}/);
});
