const CACHE='bibliotheca-shell-20261030-v3';
const BASE=new URL('./',self.location.href);
const STATIC=['offline.html','pwa.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/maskable-512.png','icons/apple-touch-icon.png'].map(p=>new URL(p,BASE).href);
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(STATIC.map(url=>new Request(url,{cache:'reload'})))).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('bibliotheca-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const r=event.request,u=new URL(r.url);
 // Personal responses, OAuth redirects and PDF tickets always go directly online.
 if(r.method!=='GET'||u.origin!==BASE.origin||!u.pathname.startsWith(BASE.pathname)||u.search||r.headers.has('Authorization'))return;
 if(STATIC.includes(u.href)){event.respondWith(fetch(r,{cache:'no-cache'}).then(async response=>{if(response.ok){const cache=await caches.open(CACHE);await cache.put(r,response.clone());}return response;}).catch(()=>caches.match(r)));return;}
 const page=u.pathname.slice(BASE.pathname.length);
 if(r.mode==='navigate'&&['','index.html','files.html','go.html','access.html','viewer.html','download.html','manage.html'].includes(page)){
  event.respondWith(fetch(r).catch(()=>caches.match(new URL('offline.html',BASE).href)));
 }
});

