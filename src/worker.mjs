import {fail,now,iso,random,hash,day,isDownload,validAction,scopeAllows,permission,validateProfile,traceCode} from './core.mjs';
import {one,run,rows,setting,setSetting,session,jsonBody,csrf,beginAuth,callback,exchange,driveToken} from './auth.mjs';
import {syncStep,assetFor,verifyAsset,indexFor,singlePage,fullFile} from './drive.mjs';
import {allowedOrigin} from './origins.mjs';
const json=Response.json;
function admin(u){if(!u.admin)fail(403,'僅管理者可操作');}
async function bookFor(env,u,id){const b=await one(env,'SELECT * FROM books WHERE id=?',id||'');if(!b)fail(404,'找不到書籍');if(!scopeAllows(u.access_scope,b.category))fail(403,'沒有此分類的使用權限');return {...JSON.parse(b.data),...b};}
function can(u,action){if(!validAction(action))fail(400,'操作類型無效');if(isDownload(action)?u.download_mode!=='download':!u.view_enabled)fail(403,'沒有這項操作的權限');}
export async function quota(env,u,asset){
 // Conditional INSERT runs in one SQLite statement: concurrent requests cannot overspend.
 await run(env,`INSERT OR IGNORE INTO downloads(email,day,asset_id) SELECT ?,?,? WHERE ? IS NULL OR (SELECT COUNT(*) FROM downloads WHERE email=? AND day=?)<?`,u.email,day(),asset,u.daily_download_limit,u.email,day(),u.daily_download_limit);
 if(!await one(env,'SELECT 1 FROM downloads WHERE email=? AND day=? AND asset_id=?',u.email,day(),asset))fail(429,'今日下載額度已用完');
}
async function ticket(env,u,value){
 if(!/^[\w-]{43}$/.test(value||''))fail(400,'檔案憑證無效');
 const t=await one(env,'SELECT * FROM tickets WHERE hash=? AND email=? AND expires>?',await hash(value),u.email,now());if(!t)fail(403,'檔案憑證已過期或不屬於此帳號');
 const b=await bookFor(env,u,t.book_id);can(u,t.action);return {t,b,a:await assetFor(env,t.book_id,t.asset_id)};
}
async function prepare(env,u,b,body,origin){
 can(u,body.action);
 let selected=body.asset||(body.action.startsWith('answer')?b.answerId:b.id);
 if(!selected)fail(404,'此書尚未設定答案檔');
 const a=await assetFor(env,b.id,selected);
 if(a.mime==='application/vnd.google-apps.folder')return {url:origin+'/files?'+new URLSearchParams({book:b.id,folder:a.id})};
 const token=await driveToken(env);await verifyAsset(env,a,token);await indexFor(env,a,token);
 const raw=random(),code=traceCode(),kind=isDownload(body.action)?'download':'view';
 await run(env,'INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,NULL,?)',await hash(raw),u.email,b.id,a.id,body.action,kind,code,iso(),now()+3600);
 return {url:origin+(kind==='download'?'/file':'/viewer')+'?ticket='+raw};
}
async function handle(request,env,ctx){
 const url=new URL(request.url),p=url.pathname,method=request.method;
 if(p==='/api/health')return json({ok:true,oauthConfigured:!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET)});
 if(p==='/auth'&&method==='GET')return beginAuth(request,env);
 if(p==='/auth/callback'&&method==='GET')return callback(request,env);
 if(p==='/api/exchange'&&method==='POST')return exchange(request,env);
 if(!p.startsWith('/api/')&&p!=='/file'){
   if(!['GET','HEAD'].includes(method))fail(405,'方法不支援');
   const aliases={'/go':'/go.html','/files':'/files.html','/access':'/access.html','/viewer':'/viewer.html'};
   if(aliases[p])return Response.redirect(url.origin+aliases[p]+url.search,302);
   return env.ASSETS.fetch(request);
 }
 if(!['GET','POST'].includes(method))fail(405,'方法不支援');
 const u=await session(request,env),body=method==='POST'?await jsonBody(request):null;
 if(body)csrf(request,body,u,env);
 if(p==='/api/me'&&method==='GET')return json({email:u.email,name:u.display_name||u.google_name,level:u.level,admin:u.admin,csrf:u.csrf,canView:!!u.view_enabled,canDownload:u.download_mode==='download',readingMode:u.reading_mode,dailyLimit:u.daily_download_limit,downloadsToday:(await one(env,'SELECT COUNT(*) n FROM downloads WHERE email=? AND day=?',u.email,day())).n});
 if(p==='/api/logout'&&body){await run(env,'DELETE FROM sessions WHERE hash=?',u.sessionHash);return json({ok:true});}
 if(p==='/api/books'&&method==='GET')return json((await rows(env,'SELECT * FROM books')).filter(b=>scopeAllows(u.access_scope,b.category)).map(b=>JSON.parse(b.data)));
 if(p==='/api/access-policy'){
   admin(u);if(body){if(typeof body.enabled!=='boolean'||!['catalog','read','download'].includes(body.defaultTier)||!['both','ref','mock'].includes(body.scope)||(body.dailyLimit!==null&&(!Number.isInteger(body.dailyLimit)||body.dailyLimit<0||body.dailyLimit>10000)))fail(400,'全站權限設定無效');await setSetting(env,'policy',{enabled:body.enabled,defaultTier:body.defaultTier,scope:body.scope,dailyLimit:body.dailyLimit});}return json(await setting(env,'policy'));
 }
 if(p==='/api/allowlist'){
   admin(u);if(body){
     const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)fail(400,'Email 無效');
     if(email===env.OWNER_EMAIL.toLowerCase()&&body.action!=='update')fail(403,'管理者不能被停用或改用預設權限');
     if(['add','update'].includes(body.action)){
       validateProfile(body);
       if(email===env.OWNER_EMAIL.toLowerCase()&&(body.scope!=='both'||!body.viewEnabled||body.downloadMode!=='download'||body.readingMode!=='fast'||body.dailyLimit!==null))fail(403,'管理者固定保留完整權限');
       await run(env,`INSERT INTO users(email,display_name,level,access_scope,download_mode,view_enabled,reading_mode,daily_download_limit,individual,blocked) VALUES (?,?,?,?,?,?,?,?,1,0) ON CONFLICT(email) DO UPDATE SET display_name=excluded.display_name,level=excluded.level,access_scope=excluded.access_scope,download_mode=excluded.download_mode,view_enabled=excluded.view_enabled,reading_mode=excluded.reading_mode,daily_download_limit=excluded.daily_download_limit,individual=1,blocked=0`,email,body.displayName,body.level,body.scope,body.downloadMode,Number(body.viewEnabled),body.readingMode,body.dailyLimit);
     }else if(body.action==='remove'){
       await env.DB.batch([env.DB.prepare('UPDATE users SET blocked=1 WHERE email=?').bind(email),env.DB.prepare('DELETE FROM sessions WHERE email=?').bind(email)]);
     }else if(body.action==='inherit')await run(env,'UPDATE users SET individual=0 WHERE email=?',email);
     else fail(400,'操作無效');
   }
   const policy=await setting(env,'policy'),users=await rows(env,'SELECT * FROM users ORDER BY email');
   for(const person of users){const p=permission(person,policy,person.email===env.OWNER_EMAIL.toLowerCase());Object.assign(person,p);person.downloads_today=(await one(env,'SELECT COUNT(*) n FROM downloads WHERE email=? AND day=?',person.email,day())).n;delete person.google_sub;}
   return json({users});
 }
 if(p==='/api/drive/status'&&method==='GET'){admin(u);const d=await setting(env,'drive');return json({configured:!!d,email:d?.email||null,books:(await one(env,'SELECT COUNT(*) n FROM books')).n});}
 if(p==='/api/drive/connect'&&body){admin(u);const auth=await beginAuth(request,env,u);return json({authorizationUrl:auth.headers.get('Location')},{headers:{'Set-Cookie':auth.headers.get('Set-Cookie')}});}
 if(p==='/api/drive/sync'&&body){admin(u);return json(await syncStep(env));}
 if(p==='/api/files'&&method==='GET'){
   const b=await bookFor(env,u,url.searchParams.get('book'));if(!u.view_enabled&&u.download_mode!=='download')fail(403,'只有書目權限');
   const folder=await assetFor(env,b.id,url.searchParams.get('folder')||b.id);if(folder.mime!=='application/vnd.google-apps.folder')fail(400,'不是資料夾');
   const files=await rows(env,'SELECT id,name,size,mime FROM assets WHERE parent=? AND book_id=?',folder.id,b.id);
   return json({title:b.title,bookId:b.id,files:files.map(f=>({...f,folder:f.mime==='application/vnd.google-apps.folder'}))});
 }
 if(p==='/api/context'&&method==='GET'){
   const b=await bookFor(env,u,url.searchParams.get('book')||url.searchParams.get('bookId'));const action=url.searchParams.get('action')||'open';can(u,action);
   return json({title:b.title,bookId:b.id,action,notionUrl:'https://app.notion.com/p/badf059a8afd82c1904481c2abfc9fd5'});
 }
 if((p==='/api/event'||p==='/api/prepare')&&body){
   const id=body.id||random();if(typeof id!=='string'||id.length>100)fail(400,'事件代碼無效');
   if(body.action==='portal_view'){await run(env,'INSERT OR IGNORE INTO events VALUES (?,?,NULL,NULL,?,?)',id,u.email,body.action,iso());return json({ok:true});}
   const b=await bookFor(env,u,body.bookId);const result=await prepare(env,u,b,body,url.origin);
   await run(env,'INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?)',id,u.email,b.id,b.title,body.action,iso());return json(result);
 }
 if(p==='/api/viewer/download'&&body){const {t,b}=await ticket(env,u,body.ticket);return json(await prepare(env,u,b,{asset:t.asset_id,action:t.action.startsWith('answer')?'answer_download':'download_request'},url.origin));}
 if(['/api/viewer','/api/page','/api/fast-file','/file'].includes(p)&&method==='GET'){
   const {t,b,a}=await ticket(env,u,url.searchParams.get('ticket'));
   if(p==='/file'&&t.kind!=='download')fail(403,'不是下載憑證');
   if(p!=='/file'&&t.kind!=='view')fail(403,'不是閱覽憑證');
   if(p==='/api/fast-file'&&(u.reading_mode!=='fast'||u.download_mode!=='download'))fail(403,'沒有快速翻閱權限');
   const token=await driveToken(env);await verifyAsset(env,a,token);const index=await indexFor(env,a,token);
   const pageCount=index.pageCount??index.pages.length;
   if(p==='/api/viewer')return json({title:b.title,pages:pageCount,canDownload:u.download_mode==='download',readingMode:u.reading_mode});
   let stream;
   if(p==='/api/page'){const page=Number(url.searchParams.get('page'));if(!Number.isInteger(page)||page<1||page>pageCount)fail(400,'頁碼無效');stream=await singlePage(env,a,index,page,t.trace_code,token);}
   else {stream=await fullFile(env,a,index,t.trace_code,token);try{await quota(env,u,a.id);}catch(e){await stream.cancel();throw e;}}
   await run(env,'UPDATE tickets SET issued_at=COALESCE(issued_at,?) WHERE hash=?',iso(),t.hash);
   return new Response(stream,{headers:{'Content-Type':'application/pdf','Content-Disposition':`${p==='/file'?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(a.name)}`}});
 }
 if(p==='/api/traces'&&method==='GET'){
   admin(u);const code=url.searchParams.get('code');const records=await rows(env,`SELECT t.trace_code,t.asset_id,t.action,t.kind,t.created_at,t.issued_at,t.email,b.title,COALESCE(NULLIF(u.display_name,''),u.google_name) name FROM tickets t JOIN books b ON b.id=t.book_id JOIN users u ON u.email=t.email ${code?'WHERE t.trace_code=?':''} ORDER BY t.created_at DESC LIMIT 200`,...(code?[code]:[]));return json({records});
 }
 if(p==='/api/stats'&&method==='GET'){
   admin(u);const users=await rows(env,`SELECT u.email,COALESCE(NULLIF(u.display_name,''),u.google_name) name,u.level,SUM(e.action='portal_view') visits,SUM(e.action='open') opens,SUM(e.action IN ('download_request','answer_download')) downloads,SUM(e.action='answer_open') answers,MAX(e.created_at) last_seen FROM users u JOIN events e ON e.email=u.email GROUP BY u.email ORDER BY last_seen DESC`);
   const events=await rows(env,`SELECT e.*,COALESCE(NULLIF(u.display_name,''),u.google_name) name FROM events e JOIN users u ON u.email=e.email ORDER BY e.created_at DESC LIMIT 200`);return json({users,events});
 }
 fail(404,'找不到此功能');
}
export default {async fetch(request,env,ctx){
 let response;try{
 if(request.method==='OPTIONS'){
   if(!allowedOrigin(request,env))fail(403,'來源不允許');
   response=new Response(null,{status:204,headers:{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}});
 }else response=await handle(request,env,ctx);
 }catch(e){const status=e.status||500;if(status===500)console.error(JSON.stringify({event:'request_failed',path:new URL(request.url).pathname,type:e.name}));response=json({error:status===500?'服務暫時無法完成操作':e.message},{status});}
 const h=new Headers(response.headers);h.set('X-Content-Type-Options','nosniff');h.set('Referrer-Policy','no-referrer');h.set('X-Frame-Options','DENY');
 if(allowedOrigin(request,env)){h.set('Access-Control-Allow-Origin',request.headers.get('Origin'));h.set('Access-Control-Expose-Headers','Content-Disposition');}
 h.append('Vary','Origin');
 if(!new URL(request.url).pathname.startsWith('/assets/'))h.set('Cache-Control','no-store');
 h.set('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
 return new Response(response.body,{status:response.status,headers:h});
}};
