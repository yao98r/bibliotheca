import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {catalogEntries,restoredBooks} from '../src/catalog.mjs';

test('deep overlapping mapped folders are traversed once, including cyclic parent links',()=>{
 const [first,second]=[...restoredBooks.values()].filter(b=>b.category==='參考書').slice(0,2),folder='application/vnd.google-apps.folder';
 const assets=[{id:first.asset,parent:'p999',book_id:'group',mime:folder},{id:second.asset,parent:'p500',book_id:'group',mime:folder}];
 for(let i=0;i<1000;i++)assets.push({id:'p'+i,parent:i?'p'+(i-1):first.asset,book_id:'group',mime:i===999?'application/pdf':folder,name:'chapter.pdf'});
 assets.push({id:'unrelated',parent:'outside',book_id:'group',mime:'application/pdf',name:'other.pdf'});
 let reads=0;for(const a of assets){const parent=a.parent;Object.defineProperty(a,'parent',{get(){reads++;return parent;}});}
 const result=catalogEntries(assets,new Map([['group',{id:'group',title:'book',category:'參考書',data:'{}'}]]));
 assert.deepEqual(result.map(b=>b.asset),[first.asset,second.asset,'unrelated']);
 assert.ok(reads<=assets.length*2,`Too many parent reads: ${reads}`);
});

test('catalog batches preserve order, search all records, reset filters, and retain action permissions',async()=>{
 for(const dir of ['dist','dist-pages']){
  const html=await readFile(dir+'/index.html','utf8'),start=html.indexOf('let shownBooks=0;'),end=html.indexOf('async function recordOpen(',start);assert.ok(start>=0&&end>start);
  const element=(tag,text,cls)=>({tag,textContent:text||'',className:cls,children:[],append(...nodes){for(const n of nodes)this.children.push(...(n.tag==='fragment'?n.children:[n]));},replaceChildren(...nodes){this.children=[];this.append(...nodes);}});
  const nodes=Object.fromEntries(['grid','count','moreBooks','search','subject','publisher'].map(id=>[id,Object.assign(element('div'),{value:''})]));
  const books=Array.from({length:145},(_,i)=>({title:'Book '+i,category:'模擬考題本',subject:i%2?'數學A':'英文',publisher:'南一',hasAnswer:true}));
  const context={books,category:'模擬考題本',referenceKind:'',me:{canView:true,canDownload:false},$:id=>nodes[id],el:element,document:{createDocumentFragment:()=>element('fragment')},renderReferenceKinds(){},recordOpen(){}};
  vm.createContext(context);vm.runInContext(html.slice(start,end),context);
  context.render();assert.equal(nodes.grid.children.length,60);assert.equal(nodes.moreBooks.hidden,false);
  const first=nodes.grid.children[0];context.render(true);assert.equal(nodes.grid.children.length,120);assert.equal(nodes.grid.children[0],first);
  context.render(true);assert.equal(nodes.grid.children.length,145);assert.equal(nodes.moreBooks.hidden,true);
  assert.equal(nodes.grid.children[144].children[0].textContent,'145');
  nodes.search.value='Book 144';context.render({type:'input'});assert.equal(nodes.grid.children.length,1);assert.match(nodes.grid.children[0].children[1].children[1].textContent,/144/);
  nodes.search.value='';nodes.subject.value='數學A';context.render();assert.equal(nodes.grid.children.length,60);
  assert.deepEqual(nodes.grid.children[0].children[2].children.map(b=>b.textContent),['開啟書籍','檢視答案']);
  nodes.search.value='not found';context.render();assert.equal(nodes.moreBooks.hidden,true);assert.equal(nodes.grid.children[0].className,'empty-state');
 }
});
