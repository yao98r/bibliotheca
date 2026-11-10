import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
for(const file of ['index.html','go.html','files.html'])test(file+': accounts, usage and traces load independently and remain admin-only',async()=>{
 const html=await readFile(file,'utf8'),start=html.indexOf('function showAdminPanel('),end=html.indexOf('async function traces(',start),nodes={},calls=[];
 for(const id of ['refTab','mockTab','adminTab','statsTab','traceTab','catalogPanel','accountPanel','adminPanel','tracePanel'])nodes[id]={hidden:true,classList:{toggle(){}},setAttribute(){}};
 const c={me:{admin:true},$:id=>nodes[id],accessUsers:async()=>calls.push('account'),stats:async()=>calls.push('stats'),traces:async()=>calls.push('trace'),status(){}};
 vm.createContext(c);vm.runInContext(html.slice(start,end),c);
 for(const [kind,panel] of [['account','accountPanel'],['stats','adminPanel'],['trace','tracePanel']]){c.showAdminPanel(kind);assert.equal(calls.at(-1),kind);for(const id of ['accountPanel','adminPanel','tracePanel'])assert.equal(nodes[id].hidden,id!==panel);}
 assert.deepEqual(calls,['account','stats','trace']);c.me.admin=false;c.showAdminPanel('account');assert.equal(calls.length,3);
 assert.ok(html.includes("$('accountPanel').append(accessPanel)"));assert.ok(!html.includes("Promise.all([accessUsers(),stats()])"));
});
