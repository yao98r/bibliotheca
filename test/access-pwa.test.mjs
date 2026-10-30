import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {googleToken} from '../src/auth.mjs';
test('expired Drive refresh grants are distinct from website account authorization',async()=>{
 const previous=globalThis.fetch;globalThis.fetch=async()=>Response.json({error:'invalid_grant',error_description:'private provider detail'},{status:400});
 try{await assert.rejects(googleToken({GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret'},{grant_type:'refresh_token',refresh_token:'private-token'}),e=>e.status===503&&e.code==='DRIVE_RECONNECT_REQUIRED'&&!e.message.includes('private'));
 await assert.rejects(googleToken({}, {grant_type:'authorization_code'}),e=>e.status===502&&!e.code);}
 finally{globalThis.fetch=previous;}
});
test('PWA paths remain inside the existing GitHub subdirectory and Worker root',async()=>{
 for(const [base,dir] of [['https://yao98r.github.io/bibliotheca/','dist-pages'],['https://books.test/','dist']]){
  const manifest=JSON.parse(await readFile(dir+'/manifest.webmanifest','utf8'));
  const scope=new URL(manifest.scope,base);assert.equal(new URL(manifest.start_url,base).href,scope.href);assert.equal(new URL(manifest.id,new URL(base).origin).href,scope.href);
  for(const icon of manifest.icons){assert.ok(new URL(icon.src,base).href.startsWith(scope.href));const png=await readFile('public/'+icon.src),[width,height]=icon.sizes.split('x').map(Number);assert.equal(png.readUInt32BE(16),width);assert.equal(png.readUInt32BE(20),height);}
 }
 for(const dir of ['dist','dist-pages'])for(const file of ['index','go','files','access','viewer','download']){const html=await readFile(dir+'/'+file+'.html','utf8');assert.match(html,/rel="manifest" href="\.\/manifest.webmanifest"/);assert.match(html,/src="\.\/pwa.js" defer/);}
});
function serviceWorker(fetchImpl){
 const handlers={},writes=[],deletes=[];const sandbox={URL,Response,Headers,self:{location:{href:'https://books.test/bibliotheca/sw.js'},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{}}},fetch:fetchImpl,caches:{open:async()=>({put:async r=>writes.push(r.url),addAll:async()=>{}}),match:async()=>new Response('offline'),keys:async()=>['unrelated-cache','bibliotheca-shell-old','bibliotheca-shell-20261030-v2'],delete:async k=>deletes.push(k)}};
 return {handlers,writes,deletes,sandbox};
}
test('service worker never stores PDF bytes, API data, OAuth callbacks or authenticated traffic',async()=>{
 const sw=serviceWorker(async()=>new Response('public'));vm.runInNewContext(await readFile('public/sw.js','utf8'),sw.sandbox);
 for(const path of ['api/me','api/books','api/fast-file?ticket=secret','file?ticket=secret','viewer.html?ticket=secret','index.html?login_callback=1','assets/file.pdf','../other/pwa.js']){
  let intercepted=false;sw.handlers.fetch({request:{url:'https://books.test/bibliotheca/'+path,method:'GET',headers:new Headers(),mode:'navigate'},respondWith(){intercepted=true;}});assert.equal(intercepted,false,path);
 }
 for(const r of [{url:'https://other.test/bibliotheca/pwa.js',headers:new Headers()},{url:'https://books.test/bibliotheca/pwa.js',headers:new Headers({Authorization:'Bearer secret'})}]){let intercepted=false;sw.handlers.fetch({request:{...r,method:'GET'},respondWith(){intercepted=true;}});assert.equal(intercepted,false);}
 let result;sw.handlers.fetch({request:{url:'https://books.test/bibliotheca/pwa.js',method:'GET',headers:new Headers()},respondWith(p){result=p;}});assert.equal(await (await result).text(),'public');assert.deepEqual(sw.writes,['https://books.test/bibliotheca/pwa.js']);
 let activated;sw.handlers.activate({waitUntil(p){activated=p;}});await activated;assert.deepEqual(sw.deletes,['bibliotheca-shell-old']);
});
test('offline navigation shows a public reconnect screen without caching account pages',async()=>{
 const sw=serviceWorker(async()=>{throw Error('offline');});vm.runInNewContext(await readFile('public/sw.js','utf8'),sw.sandbox);let result;
 sw.handlers.fetch({request:{url:'https://books.test/bibliotheca/',method:'GET',headers:new Headers(),mode:'navigate'},respondWith(p){result=p;}});assert.equal(await (await result).text(),'offline');assert.deepEqual(sw.writes,[]);
});

