import test from 'node:test';
import assert from 'node:assert/strict';
import {attachAnswerSheets} from '../src/answer-sheets.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('answer sheets attach to exact source, preserve answers and require matching category/readiness',()=>{
 const entries=[{asset:'question',category:'模擬考題本',answerAsset:'solution',hasAnswer:true},{asset:'other',category:'模擬考題本'},{asset:'sheet',category:'模擬考題本'}];
 const links=[{sources:['question'],asset:'sheet',label:'A4答題卷'}];
 const books=new Map([['collection',{category:'模擬考題本'}]]);
 const assets=[{id:'sheet',book_id:'collection',indexedReady:1}];
 const result=attachAnswerSheets(entries,assets,books,links);
 assert.equal(result.length,2);assert.equal(result[0].answerAsset,'solution');assert.equal(result[0].hasAnswer,true);
 assert.deepEqual(result[0].answerSheets,[{asset:'sheet',bookId:'collection',label:'A4答題卷',note:''}]);
 assert.equal(result[1].answerSheets,undefined);
 assert.equal(attachAnswerSheets(entries,[{...assets[0],indexedReady:0}],books,links)[0].answerSheets,undefined);
 assert.equal(attachAnswerSheets(entries,assets,new Map([['collection',{category:'參考書'}]]),links)[0].answerSheets,undefined);
 assert.equal(attachAnswerSheets(entries,[],books,links)[0].answerSheets,undefined);
 assert.equal(attachAnswerSheets(entries,[{...assets[0],watermarkedReady:0}],books,links)[0].answerSheets,undefined);
});

test('worksheet buttons obey read/download permissions and open the sheet asset',async()=>{
 const html=await readFile('index.html','utf8'),start=html.indexOf('let shownBooks='),end=html.indexOf('async function recordOpen(',start);
 const element=(tag,text)=>({tag,textContent:text||'',children:[],append(...nodes){for(const n of nodes)this.children.push(...(n.tag==='fragment'?n.children:[n]));},replaceChildren(){this.children=[];}});
 const nodes=Object.fromEntries(['grid','count','moreBooks','search','subject','publisher'].map(id=>[id,Object.assign(element('div'),{value:''})]));
 const calls=[];const context={books:[{title:'115-N3',category:'模擬考題本',answerSheets:[{bookId:'sheets',asset:'sheet-id',label:'A4答題卷',note:'v2'}]}],category:'模擬考題本',referenceKind:'',me:{canView:true,canDownload:false},$:id=>nodes[id],el:element,document:{createDocumentFragment:()=>element('fragment')},renderReferenceKinds(){},recordOpen(...args){calls.push(args);}};
 vm.createContext(context);vm.runInContext(await readFile('public/catalog-search.js','utf8'),context);vm.runInContext(html.slice(start,end),context);context.render();
 let buttons=nodes.grid.children[0].children[2].children;assert.deepEqual(buttons.map(b=>b.textContent),['開啟書籍','A4答題卷']);buttons[1].onclick();assert.equal(calls[0][0].id,'sheets');assert.equal(calls[0][3],'sheet-id');
 context.me={canView:false,canDownload:true};context.render();buttons=nodes.grid.children[0].children[2].children;assert.deepEqual(buttons.map(b=>b.textContent),['下載 PDF','下載A4答題卷']);
});
