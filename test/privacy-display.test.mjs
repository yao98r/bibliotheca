import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';import {webcrypto} from 'node:crypto';
const source=await readFile('public/privacy-display.js','utf8');
function boot(storage={}){const context={window:{},crypto:webcrypto,localStorage:{getItem:key=>storage[key],setItem:(key,value)=>storage[key]=value}};vm.createContext(context);vm.runInContext(source,context);return context.window.TianyanPrivacy;}
test('private display defaults on, uses random aliases, persists explicit off and reveals only requested identities',()=>{
 const storage={},a=boot(storage);assert.equal(a.masked,true);assert.notEqual(a.name('Alice','alice@example.com'),'Alice');assert.match(a.email('alice@example.com'),/^[A-F0-9]{12}@example\.invalid$/);assert.equal(a.email('alice@example.com'),a.email('alice@example.com'));assert.notEqual(a.email('bob@example.com'),a.email('alice@example.com'));
 assert.equal(a.name('Alice','alice@example.com',true),'Alice');assert.equal(a.email('alice@example.com',true),'alice@example.com');assert.notEqual(a.email('bob@example.com'),'bob@example.com');
 a.toggle();assert.equal(boot(storage).masked,false);assert.equal(a.email('alice@example.com'),'alice@example.com');a.toggle();assert.equal(boot(storage).masked,true);
});
test('all identity-bearing pages load privacy display; only explicit trace queries reveal records',async()=>{
 for(const file of ['index','go','files','viewer','access','download']){const html=await readFile(file+'.html','utf8');assert.ok(html.includes('privacy-display.js?v=20261110-1'));if(['index','go','files'].includes(file)){assert.ok(html.includes('TianyanPrivacy.email(r.email,!!code.trim())'));assert.ok(html.includes('TianyanPrivacy.email(e.email)'));assert.ok(html.includes('TianyanPrivacy.name(values.display_name,values.email)'));assert.ok(html.includes("querySelectorAll('input,select,button')"));}}
});
