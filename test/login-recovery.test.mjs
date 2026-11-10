import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
for(const name of ['index','go','files'])test(name+' keeps login actionable after network failures and Notion context failures',async()=>{
 const html=await readFile(name+'.html','utf8');
 assert.match(html,/<button id="googleLogin"[^>]*>使用 Google 帳號登入<\/button>/);
 const a=html.indexOf('function signedInError('),b=html.indexOf("$('moreBooks')",a)>=0?html.indexOf("$('moreBooks')",a):html.indexOf("$('search').oninput",a),code=html.slice(a,b);
 for(const loggedIn of [false,true]){
  const elements=Object.fromEntries(['googleLogin','retryLogin','login','setup'].map(id=>[id,{hidden:true}]));let status='',clicked=false;
  const context={$:id=>elements[id],me:loggedIn?{}:null,fromNotion:name==='go',fromFiles:name==='files',document:{querySelector:()=>({})},status:text=>{status=text;},completeRedirectLogin:async()=>false,signedIn:async()=>{throw new TypeError('Load failed');},returnAfterLogin:()=>false,startLogin:()=>{clicked=true;}};
  vm.createContext(context);vm.runInContext(code,context);const pending=context.init();
  assert.equal(typeof elements.googleLogin.onclick,'function');await pending;
  assert.equal(elements.login.hidden,false);assert.match(status,/連線未完成/);assert.equal(typeof elements.retryLogin.onclick,'function');elements.googleLogin.onclick();assert.equal(clicked,true);
 }
});
test('both builds preserve the original Notion destination across redirect login',async()=>{
 for(const dir of ['dist','dist-pages'])for(const page of ['index','go','files']){
  const html=await readFile(dir+'/'+page+'.html','utf8');
  assert.match(html,/id="googleLogin"/);assert.match(html,/id="retryLogin"/);
  assert.match(html,/includes\(location.pathname.split\('\/'\).pop\(\)\)/);
  assert.match(html,/location.pathname.split\('\/'\).pop\(\)\+location.search/);
  assert.match(html,/sessionStorage.setItem\('bibliotheca-after-login',after\)/);
 }
});
