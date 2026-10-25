import {fail,hash,iso,bounded,unb64} from './core.mjs';
import {one,rows,run,driveToken} from './auth.mjs';
import {drive,verifyAsset} from './drive.mjs';
const MAX_SOURCE=256*1024*1024;
// Bound values can exceed the 100 KB SQL-text limit. Each row remains well
// below D1's 2 MB row limit; readers already join variable-sized parts.
const PAGE_PART_CHARS=256000;
const validBase64=s=>typeof s==='string'&&s.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(s);
export async function nextIndex(env,skip=[]){
 if(!Array.isArray(skip)||skip.length>1000||skip.some(s=>typeof s!=='string'||s.length>200))fail(400,'略過清單無效');
 const missing=await rows(env,"SELECT a.* FROM assets a WHERE a.mime='application/pdf' AND NOT EXISTS(SELECT 1 FROM pdf_headers h WHERE h.size=a.size AND h.md5=a.md5) ORDER BY a.size,a.id");
 const a=missing.find(a=>!skip.includes(a.id));if(!a)return {job:null,remaining:missing.length};
 const id='auto_'+await hash(a.id+':'+a.size+':'+a.md5);
 await run(env,'INSERT OR IGNORE INTO index_jobs(id,asset,size,md5,updated_at) VALUES (?,?,?,?,?)',id,a.id,a.size,a.md5,iso());
 const j=await one(env,'SELECT * FROM index_jobs WHERE id=?',id);
 return {job:{id,asset:a.id,name:a.name,size:a.size,md5:a.md5,nextPage:j.next_page,pageCount:j.page_count},remaining:missing.length};
}
async function currentJob(env,id){
 if(typeof id!=='string'||!/^auto_[\w-]{43}$/.test(id))fail(400,'索引工作代碼無效');
 const job=await one(env,'SELECT * FROM index_jobs WHERE id=?',id);if(!job)fail(404,'找不到索引工作');
 const asset=await one(env,"SELECT * FROM assets WHERE id=? AND mime='application/pdf'",job.asset);
 if(!asset||asset.size!==job.size||asset.md5!==job.md5)fail(409,'PDF 已變更，請重新同步書目');
 return {job,asset};
}
export async function indexSource(env,id){
 const {asset}=await currentJob(env,id);if(asset.size>MAX_SOURCE)fail(413,'PDF 超過 256 MB，請先分冊再同步');
 const token=await driveToken(env);await verifyAsset(env,asset,token);
 const response=await drive(env,`files/${asset.id}?alt=media`,token);
 if(response.status!==200){await response.body?.cancel();fail(502,'無法取得完整 PDF');}
 return new Response(response.body,{headers:{'Content-Type':'application/pdf','X-PDF-Bytes':String(asset.size)}});
}
export async function startIndex(env,body){
 const {job}=await currentJob(env,body.job),h=body.header;
 if(!h||h.size!==job.size||h.md5!==job.md5||!Number.isInteger(h.pageCount)||h.pageCount<1||h.pageCount>10000||!validBase64(h.tail)||h.tail.length>22000)fail(400,'索引標頭無效');
 const tail=new TextDecoder().decode(unb64(h.tail));
 if(!tail.includes('/BibliothecaTrace (ZZZZ-ZZZZ)')||!tail.includes('startxref')||!tail.includes('%%EOF'))fail(400,'索引缺少授權識別資訊');
 if(job.page_count&&(job.page_count!==h.pageCount||job.tail!==h.tail))fail(409,'索引版本不符，請重新載入管理頁');
 await run(env,"UPDATE index_jobs SET page_count=?,tail=?,status=CASE WHEN status='ready' THEN status ELSE 'building' END,error=NULL,updated_at=? WHERE id=?",h.pageCount,h.tail,iso(),job.id);
 return {nextPage:job.next_page};
}
export async function validatePage(payload,size){
 if(!validBase64(payload)||payload.length>700000)fail(413,'索引頁面資料過大或無效');
 let entry;
 try{const inflated=new Response(new Blob([unb64(payload)]).stream().pipeThrough(new DecompressionStream('gzip')));entry=JSON.parse(new TextDecoder().decode(await bounded(inflated,2*1024*1024)));}catch(e){if(e.status)throw e;fail(400,'索引頁面格式無效');}
 if(!entry||!Number.isSafeInteger(entry.length)||entry.length<1||entry.length>16*1024*1024||!Array.isArray(entry.parts)||!entry.parts.length||entry.parts.length>80)fail(400,'索引頁面結構無效');
 let length=0,ranges=0,marker=false;
 for(const p of entry.parts){
  if(typeof p==='string'){
   if(!validBase64(p))fail(400,'索引頁面編碼無效');const bytes=unb64(p);length+=bytes.length;
   if(new TextDecoder().decode(bytes).includes('/BibliothecaTrace (ZZZZ\\055ZZZZ)'))marker=true;
  }else{
   if(!Array.isArray(p)||p.length!==2||!Number.isSafeInteger(p[0])||!Number.isSafeInteger(p[1])||p[0]<0||p[1]<1||p[1]>16*1024*1024||p[0]+p[1]>size)fail(400,'索引超出來源 PDF 範圍');
   length+=p[1];ranges++;
  }
 }
 if(length!==entry.length||ranges>38||!marker)fail(400,'索引長度或授權識別資訊不符');
 return entry;
}
export async function storeIndexPage(env,body){
 const {job}=await currentJob(env,body.job);
 if(!Number.isInteger(body.page)||body.page<1||body.page>job.page_count)fail(400,'索引頁碼無效');
 if(body.page<job.next_page)return {nextPage:job.next_page};
 if(job.status!=='building'||body.page!==job.next_page)fail(409,'請依序建立頁面索引');
 await validatePage(body.data,job.size);
 const statements=[];
 for(let offset=0,part=0;offset<body.data.length;offset+=PAGE_PART_CHARS,part++){
  statements.push(env.DB.prepare('INSERT OR IGNORE INTO pdf_pages(asset,page,part,data) SELECT id,?,?,? FROM index_jobs WHERE id=? AND next_page=? AND status=\'building\'').bind(body.page,part,body.data.slice(offset,offset+PAGE_PART_CHARS),job.id,body.page));
 }
 statements.push(env.DB.prepare("UPDATE index_jobs SET next_page=next_page+1,error=NULL,updated_at=? WHERE id=? AND next_page=? AND status='building'").bind(iso(),job.id,body.page));
 await env.DB.batch(statements);
 return {nextPage:(await one(env,'SELECT next_page FROM index_jobs WHERE id=?',job.id)).next_page};
}
export async function finishIndex(env,body){
 const {job,asset}=await currentJob(env,body.job);
 if(job.status==='ready')return {ok:true};
 if(!job.page_count||job.next_page!==job.page_count+1)fail(409,'閱讀索引尚未全部完成');
 const count=await one(env,'SELECT COUNT(DISTINCT page) n,MIN(page) first,MAX(page) last FROM pdf_pages WHERE asset=?',job.id);
 if(count.n!==job.page_count||count.first!==1||count.last!==job.page_count)fail(409,'閱讀索引頁面不完整');
 await verifyAsset(env,asset,await driveToken(env));
 // Publish only complete, current indexes. Draft pages are never discoverable by readers.
 await env.DB.batch([
  env.DB.prepare('INSERT OR REPLACE INTO pdf_headers(asset,size,md5,tail,page_count) VALUES (?,?,?,?,?)').bind(job.id,job.size,job.md5,job.tail,job.page_count),
  env.DB.prepare("UPDATE index_jobs SET status='ready',error=NULL,updated_at=? WHERE id=?").bind(iso(),job.id)
 ]);
 return {ok:true,pages:job.page_count};
}
export async function storeIndexPages(env,body){
 const {job}=await currentJob(env,body.job),pages=body.pages;
 if(!Array.isArray(pages)||!pages.length||pages.length>8||pages.some((p,i)=>!Number.isInteger(p.page)||p.page<1||p.page>job.page_count||(i&&p.page!==pages[i-1].page+1)))fail(400,'批次索引頁碼無效');
 const pending=pages.filter(p=>p.page>=job.next_page);
 if(!pending.length)return {nextPage:job.next_page};
 if(job.status!=='building'||pending[0].page!==job.next_page)fail(409,'請依序建立頁面索引');
 for(const p of pending)await validatePage(p.data,job.size);
 const statements=[];
 for(const p of pending)for(let offset=0,part=0;offset<p.data.length;offset+=PAGE_PART_CHARS,part++)statements.push(env.DB.prepare("INSERT OR IGNORE INTO pdf_pages(asset,page,part,data) SELECT id,?,?,? FROM index_jobs WHERE id=? AND next_page=? AND status='building'").bind(p.page,part,p.data.slice(offset,offset+PAGE_PART_CHARS),job.id,job.next_page));
 statements.push(env.DB.prepare("UPDATE index_jobs SET next_page=next_page+?,error=NULL,updated_at=? WHERE id=? AND next_page=? AND status='building'").bind(pending.length,iso(),job.id,job.next_page));
 await env.DB.batch(statements);
 return {nextPage:(await one(env,'SELECT next_page FROM index_jobs WHERE id=?',job.id)).next_page};
}
export async function indexError(env,body){
 const {job}=await currentJob(env,body.job);
 if(job.status!=='ready')await run(env,"UPDATE index_jobs SET status='error',error=?,updated_at=? WHERE id=?",String(body.message||'處理中斷，請重試').slice(0,300),iso(),job.id);
 return {ok:true};
}
