import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
const context={};vm.createContext(context);vm.runInContext(await readFile('public/catalog-search.js','utf8'),context);
const book={title:'115-1-3_南一數A',year:'115',category:'模擬考題本',subject:'數學A',publisher:'南一',series:'115-N3'};
test('search accepts spaces, punctuation, full width, synonyms and joined keywords',()=>{
 for(const q of ['115 模考','115-模考','115模擬考','１１５　模擬考題本','115 N3 數A','115-n3-數學Ａ','南一 115 數學A','115模考數A'])assert.equal(context.matchesCatalogSearch(book,context.catalogSearchTokens(q)),true,q);
 for(const q of ['114 模考','115 數B','115 翰林','不存在的書'])assert.equal(context.matchesCatalogSearch(book,context.catalogSearchTokens(q)),false,q);
 assert.equal(context.matchesCatalogSearch(book,context.catalogSearchTokens('')),true);
});
test('catalog return state restores search, category, filters, expanded items and scroll only for the same account',async()=>{
 const html=await readFile('index.html','utf8'),code=html.slice(html.indexOf('const CATALOG_VIEW_KEY='),html.indexOf('function signedInError('));
 const nodes={library:{hidden:false},search:{value:'115 模考'},subject:{value:'數學A'},publisher:{value:'南一'}};let saved,scroll,limit;
 const c={me:{email:'a@example.com'},fromNotion:false,fromFiles:false,category:'模擬考題本',referenceKind:'',books:Array.from({length:180},()=>book),shownBooks:120,$:id=>nodes[id],sessionStorage:{setItem:(key,value)=>{saved=value;},getItem:()=>saved},window:{scrollY:1640,addEventListener(){},scrollTo:(x,y)=>{scroll=y;}},requestAnimationFrame:fn=>fn(),tab(){},render:(append,n)=>{limit=n;}};
 vm.createContext(c);vm.runInContext(code,c);c.saveCatalogView();nodes.search.value='';c.category='參考書';c.restoreCatalogView();
 assert.equal(nodes.search.value,'115 模考');assert.equal(c.category,'模擬考題本');assert.equal(nodes.subject.value,'數學A');assert.equal(limit,120);assert.equal(scroll,1640);
 c.me.email='different@example.com';nodes.search.value='own search';c.restoreCatalogView();assert.equal(nodes.search.value,'own search');
});
