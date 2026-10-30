import {fail,now,iso,random,hash,day,isDownload,validAction,scopeAllows,permission,validateProfile,traceCode,unb64,ranks} from './core.mjs';
import {one,run,rows,setting,setSetting,session,jsonBody,csrf,beginAuth,callback,exchange,driveToken} from './auth.mjs';
import {syncStep,assetFor,verifyAsset,indexFor,singlePage,fullFile,watermarkedFullFile} from './drive.mjs';
import {allowedOrigin} from './origins.mjs';
import {authErrorPage} from './auth-error.mjs';
import {catalogEntries,categoryRepairs,restoredBooks,restoredSource} from './catalog.mjs';
import {nextIndex,indexSource,startIndex,storeIndexPage,storeIndexPages,finishIndex,indexError} from './indexing.mjs';
import {nextWatermark,watermarkSource,storeWatermark,watermarkRow} from './watermark-indexing.mjs';
const json=Response.json;
function admin(u){if(!u.admin)fail(403,'僅管理者可操作');}
async function bookFor(env,u,id,action='open',asset){
 if(!validAction(action))fail(400,'操作類型無效');
 const legacy=restoredBooks.get(id);
 if(legacy){
  if(!scopeAllows(u.access_scope,legacy.category))fail(403,'沒有此分類的使用權限');
  const source=restoredSource(legacy,action);if(!source)fail(404,'此書尚未設定答案檔');
  const original=action.startsWith('answer')?legacy.originalAnswerAsset:legacy.originalAsset;
  if(asset&&asset!==source&&asset!==original)fail(404,'檔案不屬於這本書');
  const a=await one(env,'SELECT * FROM assets WHERE id=?',source);
  if(!a)fail(409,'原版檔案尚未匯入中轉書庫，請管理者完成復原同步');
  const b=await one(env,'SELECT * FROM books WHERE id=?',a.book_id);
  if(!b||b.category!==legacy.category)fail(403,'檔案分類與原書不符');
  return {...JSON.parse(b.data),...b,title:legacy.title,asset:source,restoredAsset:source,answerId:legacy.answerAsset};
 }
 const b=await one(env,'SELECT * FROM books WHERE id=?',id||'');if(!b)fail(404,'找不到書籍');if(!scopeAllows(u.access_scope,b.category))fail(403,'沒有此分類的使用權限');return {...JSON.parse(b.data),...b};
}
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
 let selected=b.restoredAsset||body.asset||(body.action.startsWith('answer')?b.answerId:(b.asset||b.id));
 if(!selected)fail(404,'此書尚未設定答案檔');
 const a=await assetFor(env,b.id,selected);
 if(a.mime==='application/vnd.google-apps.folder')return {url:origin+'/files?'+new URLSearchParams({book:b.id,folder:a.id})};
 const token=await driveToken(env);await verifyAsset(env,a,token);const index=await indexFor(env,a,token);
 if(isDownload(body.action)&&env.PDF_WATERMARK_ROLLOUT!=='prepare'&&!await watermarkRow(env,a))fail(409,'這份 PDF 正在準備整本保護，完成後即可下載；目前仍可逐頁閱讀。');
 const raw=random(),code=traceCode(),kind=isDownload(body.action)?'download':'view';
 await env.DB.batch([
  env.DB.prepare('INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,NULL,?)').bind(await hash(raw),u.email,b.id,a.id,body.action,kind,code,iso(),now()+3600),
  env.DB.prepare('INSERT INTO events VALUES (?,?,?,?,?,?)').bind('trace:'+code+':source:'+a.md5,u.email,b.id,a.name,'trace_issue',iso())
 ]);
 return {url:origin+(kind==='download'?'/file':'/viewer')+'?ticket='+raw,title:a.name.replace(/\.pdf$/i,'')};
}
async function handle(request,env,ctx){
 const url=new URL(request.url),p=url.pathname,method=request.method;
 if(p==='/api/health')return json({ok:true,oauthConfigured:!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET),watermarkVersion:2,watermarkMode:env.PDF_WATERMARK_ROLLOUT==='prepare'?'prepare':'required'});
 if(p==='/auth'&&method==='GET')return beginAuth(request,env);
 if(p==='/auth/callback'&&method==='GET')return callback(request,env);
 if(p==='/api/exchange'&&method==='POST')return exchange(request,env);
 if(!p.startsWith('/api/')&&p!=='/file'){
   if(!['GET','HEAD'].includes(method))fail(405,'方法不支援');
   const aliases={'/go':'/go.html','/files':'/files.html','/access':'/access.html','/viewer':'/viewer.html'};
   if(aliases[p])return Response.redirect(url.origin+aliases[p]+url.search,302);
   if(p==='/')return env.ASSETS.fetch(new Request(url.origin+'/index.html'+url.search,request));
   return env.ASSETS.fetch(request);
 }
 if(!['GET','POST'].includes(method))fail(405,'方法不支援');
 const u=await session(request,env);
 if(p.startsWith('/api/index/')||p.startsWith('/api/watermark/'))admin(u);
 const body=method==='POST'?await jsonBody(request,p==='/api/index/pages'?6*1024*1024:['/api/index/page','/api/watermark/store'].includes(p)?750000:32768):null;
 if(body)csrf(request,body,u,env);
 if(p==='/api/me'&&method==='GET')return json({email:u.email,name:u.display_name||u.google_name,...(u.admin?{level:u.level,ranks}:{}),admin:u.admin,csrf:u.csrf,canView:!!u.view_enabled,canDownload:u.download_mode==='download',readingMode:u.reading_mode,dailyLimit:u.daily_download_limit,downloadsToday:(await one(env,'SELECT COUNT(*) n FROM downloads WHERE email=? AND day=?',u.email,day())).n});
 if(p==='/api/logout'&&body){await run(env,'DELETE FROM sessions WHERE hash=?',u.sessionHash);return json({ok:true});}
 if(p==='/api/books'&&method==='GET'){
   const books=new Map((await rows(env,'SELECT * FROM books')).filter(b=>scopeAllows(u.access_scope,b.category)).map(b=>[b.id,b]));
   return json(catalogEntries(await rows(env,'SELECT a.id,a.book_id,a.parent,a.name,a.mime,EXISTS(SELECT 1 FROM pdf_headers h WHERE h.size=a.size AND h.md5=a.md5) AS indexedReady FROM assets a ORDER BY name'),books));
 }
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
   const policy=await setting(env,'policy');
   const users=await rows(env,`SELECT u.*,COALESCE(d.n,0) downloads_today FROM users u LEFT JOIN (SELECT email,COUNT(*) n FROM downloads WHERE day=? GROUP BY email) d ON d.email=u.email ORDER BY u.email`,day());
   for(const person of users){const p=permission(person,policy,person.email===env.OWNER_EMAIL.toLowerCase());Object.assign(person,p);delete person.google_sub;}
   return json({users});
 }
 if(p==='/api/drive/status'&&method==='GET'){admin(u);const d=await setting(env,'drive'),counts=await one(env,"SELECT COUNT(*) pdfs,COALESCE(SUM(EXISTS(SELECT 1 FROM pdf_headers h WHERE h.size=a.size AND h.md5=a.md5)),0) indexed_count,COALESCE(SUM(EXISTS(SELECT 1 FROM pdf_watermarks w WHERE w.size=a.size AND w.md5=a.md5 AND w.version=2)),0) protected_count FROM assets a WHERE mime='application/pdf'");return json({configured:!!d,email:d?.email||null,books:(await one(env,'SELECT COUNT(*) n FROM books')).n,pdfs:counts.pdfs,indexed:counts.indexed_count,watermarked:counts.protected_count});}
 if(p==='/api/drive/check'&&body){
  admin(u);const connection=await setting(env,'drive');
  if(!connection)return json({configured:false,healthy:false,status:'not_connected',message:'尚未連接 Google Drive，請先連接書庫來源。'});
  try{
   const token=await driveToken(env),r=await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',{headers:{Authorization:`Bearer ${token}`}});
   if(!r.ok)fail(503,'無法確認書庫來源的讀取權限，請管理者重新連接 Google Drive。','DRIVE_RECONNECT_REQUIRED');
   const about=await r.json();if(about.user?.emailAddress?.toLowerCase()!==env.OWNER_EMAIL.toLowerCase())fail(503,'書庫來源帳號與管理者不符，請重新連接。','DRIVE_RECONNECT_REQUIRED');
   return json({configured:true,healthy:true,status:'ready',email:connection.email,connectedAt:connection.connectedAt,message:'書庫連線正常，已確認 Google Drive 可讀取。'});
  }catch(e){return json({configured:true,healthy:false,status:e.code==='DRIVE_RECONNECT_REQUIRED'?'reconnect_required':'unavailable',connectedAt:connection.connectedAt,message:e.status?e.message:'書庫連線檢查暫時失敗，請稍後重試。'});}
 }
 if(p==='/api/drive/connect'&&body){admin(u);const auth=await beginAuth(request,env,u);return json({authorizationUrl:auth.headers.get('Location')},{headers:{'Set-Cookie':auth.headers.get('Set-Cookie')}});}
 if(p==='/api/drive/sync'&&body){admin(u);return json(await syncStep(env));}
 if(p==='/api/catalog/restore'&&body){
   admin(u);const books=new Map((await rows(env,'SELECT * FROM books')).map(b=>[b.id,b]));
   const plan=categoryRepairs(await rows(env,'SELECT id,book_id FROM assets'),books);
   if(body.apply===true){
    const statements=plan.changes.map(c=>{const data={...JSON.parse(books.get(c.id).data),category:c.category};return env.DB.prepare('UPDATE books SET category=?,data=? WHERE id=?').bind(c.category,JSON.stringify(data),c.id);});
    if(statements.length)await env.DB.batch(statements);
   }
   return json({...plan,applied:body.apply===true});
 }
 if(p==='/api/index/next'&&body)return json(await nextIndex(env,body.skip));
 if(p==='/api/index/source'&&method==='GET')return indexSource(env,url.searchParams.get('job'));
 if(p==='/api/index/start'&&body)return json(await startIndex(env,body));
 if(p==='/api/index/page'&&body)return json(await storeIndexPage(env,body));
 if(p==='/api/index/pages'&&body)return json(await storeIndexPages(env,body));
 if(p==='/api/index/finish'&&body)return json(await finishIndex(env,body));
 if(p==='/api/index/error'&&body)return json(await indexError(env,body));
 if(p==='/api/watermark/next'&&body)return json(await nextWatermark(env,body.skip));
 if(p==='/api/watermark/source'&&method==='GET')return watermarkSource(env,url.searchParams.get('asset'));
 if(p==='/api/watermark/store'&&body)return json(await storeWatermark(env,body));
 if(p==='/api/files'&&method==='GET'){
   const b=await bookFor(env,u,url.searchParams.get('book'));if(!u.view_enabled&&u.download_mode!=='download')fail(403,'只有書目權限');
   const folder=await assetFor(env,b.id,url.searchParams.get('folder')||b.id);if(folder.mime!=='application/vnd.google-apps.folder')fail(400,'不是資料夾');
   const files=await rows(env,'SELECT id,name,size,mime FROM assets WHERE parent=? AND book_id=?',folder.id,b.id);
   return json({title:b.title,bookId:b.id,files:files.map(f=>({...f,folder:f.mime==='application/vnd.google-apps.folder'}))});
 }
 if(p==='/api/context'&&method==='GET'){
   const action=url.searchParams.get('action')||'open';can(u,action);
   const b=await bookFor(env,u,url.searchParams.get('book')||url.searchParams.get('bookId'),action,url.searchParams.get('asset'));
   const asset=b.restoredAsset||url.searchParams.get('asset')||restoredSource(b,action);if(asset)await assetFor(env,b.id,asset);
   return json({title:b.title,bookId:b.id,action,asset:asset||null,notionUrl:'https://app.notion.com/p/badf059a8afd82c1904481c2abfc9fd5'});
 }
 if((p==='/api/event'||p==='/api/prepare')&&body){
   const id=body.id||random();if(typeof id!=='string'||id.length>100)fail(400,'事件代碼無效');
   // Count one portal visit per account per Taiwan calendar day; callers cannot
   // force unlimited database writes merely by supplying fresh event IDs.
   if(body.action==='portal_view'){await run(env,'INSERT OR IGNORE INTO events VALUES (?,?,NULL,NULL,?,?)','visit:'+day(),u.email,body.action,iso());return json({ok:true});}
   const b=await bookFor(env,u,body.bookId,body.action,body.asset);const result=await prepare(env,u,b,body,url.origin);
   await run(env,'INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?)',id,u.email,b.id,result.title||b.title,body.action,iso());return json(result);
 }
 if(p==='/api/viewer/download'&&body){const {t,b}=await ticket(env,u,body.ticket);return json(await prepare(env,u,b,{asset:t.asset_id,action:t.action.startsWith('answer')?'answer_download':'download_request'},url.origin));}
 if(p==='/api/download-context'&&method==='GET'){
  const {t,a}=await ticket(env,u,url.searchParams.get('ticket'));if(t.kind!=='download')fail(403,'不是下載憑證');
  return json({traceCode:t.trace_code,title:a.name,createdAt:t.created_at});
 }
 if(p==='/api/trace/page'&&body){
  const {t,a}=await ticket(env,u,body.ticket);if(t.kind!=='view')fail(403,'不是閱覽憑證');
  const local=await one(env,'SELECT page_count FROM pdf_headers WHERE size=? AND md5=? LIMIT 1',a.size,a.md5);
  const index=local?null:await indexFor(env,a,await driveToken(env)),total=local?.page_count??index.pageCount??index.pages.length;
  if(!Number.isInteger(body.page)||body.page<1||body.page>total)fail(400,'頁碼無效');
  await run(env,'INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?)','trace:'+t.trace_code+':display:'+body.page,u.email,t.book_id,a.name,'page_reported',iso());
  return json({ok:true});
 }
 if(['/api/viewer','/api/page','/api/fast-file','/file'].includes(p)&&method==='GET'){
   const {t,b,a}=await ticket(env,u,url.searchParams.get('ticket'));
   if(p==='/file'&&t.kind!=='download')fail(403,'不是下載憑證');
   if(p!=='/file'&&t.kind!=='view')fail(403,'不是閱覽憑證');
   if(p==='/api/fast-file'&&(u.reading_mode!=='fast'||u.download_mode!=='download'))fail(403,'沒有快速翻閱權限');
   const token=await driveToken(env);await verifyAsset(env,a,token);const index=await indexFor(env,a,token);
   const pageCount=index.pageCount??index.pages.length;
   const watermark=p==='/api/page'?null:await watermarkRow(env,a,p!=='/api/viewer'),fullAvailable=!!watermark||env.PDF_WATERMARK_ROLLOUT==='prepare';
   if(p==='/api/viewer')return json({title:a.name.replace(/\.pdf$/i,''),pages:pageCount,traceCode:t.trace_code,canDownload:u.download_mode==='download'&&fullAvailable,readingMode:fullAvailable?u.reading_mode:'protected',watermark:watermark?'server-v2':'legacy',fullDownloadAvailable:fullAvailable});
   let stream;
   const page=p==='/api/page'?Number(url.searchParams.get('page')):null;
   if(p==='/api/page'){if(!Number.isInteger(page)||page<1||page>pageCount)fail(400,'頁碼無效');stream=await singlePage(env,a,index,page,t.trace_code,token);}
   let length,kind='legacy-page';
   if(page===null){
    if(watermark){const result=await watermarkedFullFile(env,a,watermark,t,token);stream=result.stream;length=result.length;kind='server-v2';}
    else if(env.PDF_WATERMARK_ROLLOUT==='prepare'){stream=await fullFile(env,a,index,t.trace_code,token);length=a.size+(index.tailEncoding==='base64'?unb64(index.tail).length:new TextEncoder().encode(index.tail).length);kind='legacy';}
    else fail(409,'這份 PDF 的整本保護尚未備妥，請稍後重試或使用逐頁閱讀。');
   }
   if(page!==null)await run(env,'INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?)','trace:'+t.trace_code+':page:'+page,u.email,t.book_id,a.name,'page_issued',iso());
   else try{await quota(env,u,a.id);}catch(e){await stream.cancel();throw e;}
   // Persist first delivery once, even when several page requests race.
   if(!t.issued_at)await run(env,'UPDATE tickets SET issued_at=? WHERE hash=? AND issued_at IS NULL',iso(),t.hash);
   return new Response(stream,{headers:{'Content-Type':'application/pdf','Content-Disposition':`${p==='/file'?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(a.name)}`,...(length?{'X-PDF-Bytes':String(length),'Content-Length':String(length)}:{}),'X-PDF-Watermark':kind}});
 }
 if(p==='/api/traces'&&method==='GET'){
   admin(u);const code=url.searchParams.get('code');if(code&&!/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code))fail(400,'追蹤碼格式無效');
   const records=await rows(env,`SELECT t.trace_code,t.asset_id,t.action,t.kind,t.created_at,t.issued_at,t.email,COALESCE(s.book_title,b.title) title,substr(s.id,length('trace:'||t.trace_code||':source:')+1) source_md5,COALESCE(NULLIF(u.display_name,''),u.google_name) name,(SELECT COUNT(*) FROM events e WHERE e.email=t.email AND e.id>='trace:'||t.trace_code||':page:' AND e.id<'trace:'||t.trace_code||':page;') pages_issued,(SELECT COUNT(*) FROM events e WHERE e.email=t.email AND e.id>='trace:'||t.trace_code||':display:' AND e.id<'trace:'||t.trace_code||':display;') pages_reported FROM tickets t JOIN books b ON b.id=t.book_id JOIN users u ON u.email=t.email LEFT JOIN events s ON s.email=t.email AND s.id>='trace:'||t.trace_code||':source:' AND s.id<'trace:'||t.trace_code||':source;' ${code?'WHERE t.trace_code=?':''} ORDER BY t.created_at DESC LIMIT 200`,...(code?[code]:[]));return json({records});
 }
 if(p==='/api/stats'&&method==='GET'){
   admin(u);const users=await rows(env,`SELECT u.email,COALESCE(NULLIF(u.display_name,''),u.google_name) name,u.level,SUM(e.action='portal_view') visits,SUM(e.action='open') opens,SUM(e.action IN ('download_request','answer_download')) downloads,SUM(e.action='answer_open') answers,MAX(e.created_at) last_seen FROM users u JOIN events e ON e.email=u.email GROUP BY u.email ORDER BY last_seen DESC`);
   const events=await rows(env,`SELECT e.*,COALESCE(NULLIF(u.display_name,''),u.google_name) name FROM events e JOIN users u ON u.email=e.email WHERE e.action NOT IN ('trace_issue','page_issued','page_reported') ORDER BY e.created_at DESC LIMIT 200`);return json({users,events});
 }
 fail(404,'找不到此功能');
}
export default {async fetch(request,env,ctx){
 let response;try{
 if(request.method==='OPTIONS'){
   if(!allowedOrigin(request,env))fail(403,'來源不允許');
   response=new Response(null,{status:204,headers:{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}});
 }else response=await handle(request,env,ctx);
 }catch(e){
 const limited=/exceeded D1's free tier daily/.test(e.message||'');
 const status=limited?503:(e.status||500);
 if(status===500)console.error(JSON.stringify({event:'request_failed',path:new URL(request.url).pathname,type:e.name}));
 const message=limited?'Cloudflare 今日免費資料庫額度已用完，台灣時間上午 08:00 重置後可重試。':status===500?'服務暫時無法完成操作':e.message;
 const headers=limited?{'Retry-After':String(86400-now()%86400)}:{};
 if(['/auth','/auth/callback'].includes(new URL(request.url).pathname)){
   response=new Response(authErrorPage(status,message,env.FRONTEND_URL||new URL('/',request.url).href),{status,headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
   }else response=json({error:message,...(['DRIVE_RECONNECT_REQUIRED','DRIVE_CONFIGURATION_ERROR'].includes(e.code)?{code:e.code}:{})},{status,headers});
 }
 const h=new Headers(response.headers);h.set('X-Content-Type-Options','nosniff');h.set('Referrer-Policy','no-referrer');h.set('X-Frame-Options','DENY');
 if(allowedOrigin(request,env)){h.set('Access-Control-Allow-Origin',request.headers.get('Origin'));h.set('Access-Control-Expose-Headers','Content-Disposition, X-PDF-Bytes, X-PDF-Watermark');}
 h.append('Vary','Origin');
 if(!new URL(request.url).pathname.startsWith('/assets/'))h.set('Cache-Control','no-store');
 h.set('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
 return new Response(response.body,{status:response.status,headers:h});
}};
