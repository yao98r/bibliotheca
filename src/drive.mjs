import {fail,bounded,unb64,replaceTrace} from './core.mjs';
import {driveToken,one,run,rows} from './auth.mjs';
import {appendPdfTail} from './pdf-stream.mjs';
const FOLDER='application/vnd.google-apps.folder';
const validId=s=>typeof s==='string'&&/^[\w-]{10,200}$/.test(s);
export async function drive(env,path,token,headers={}){
 const r=await fetch('https://www.googleapis.com/drive/v3/'+path,{headers:{Authorization:'Bearer '+token,...headers}});
 if(!r.ok)fail(r.status===404?404:502,r.status===404?'Drive 找不到這個檔案':'Drive 暫時無法讀取，請稍後再試');return r;
}
export async function syncStep(env){
 const token=await driveToken(env);
 let task=await one(env,'SELECT * FROM scan ORDER BY id LIMIT 1');
 if(!task){
   await env.DB.batch([env.DB.prepare('INSERT INTO scan VALUES (?,?,NULL,NULL)').bind(env.REFERENCE_ROOT_ID,'參考書'),env.DB.prepare('INSERT INTO scan VALUES (?,?,NULL,NULL)').bind(env.MOCK_ROOT_ID,'模擬考題本')]);
   task=await one(env,'SELECT * FROM scan ORDER BY id LIMIT 1');
 }
 if(!validId(task.id))fail(400,'資料夾設定無效');
 // A batch of 10 stays below the free Workers plan's 50 D1 queries per request,
 // including folders, authentication, queue state and counts.
 const q=new URLSearchParams({q:`'${task.id}' in parents and trashed = false`,pageSize:'10',fields:'nextPageToken,files(id,name,mimeType,size,md5Checksum)',...(task.page_token?{pageToken:task.page_token}:{})});
 const data=await (await drive(env,'files?'+q,token)).json(),statements=[];
 for(const f of data.files||[]){
   if(![FOLDER,'application/pdf'].includes(f.mimeType))continue;
   const bookId=task.book_id||f.id;
   if(!task.book_id){
     const title=f.name.replace(/\.pdf$/i,''),book={id:bookId,title,category:task.category,subject:title.match(/數學[AB甲乙]?|國文|英文|物理|化學|生物|地理|歷史|公民|自然|社會/)?.[0]||'',publisher:title.match(/[\[［【]([^\]］】]+)[\]］】]/)?.[1]||'',year:title.match(/\d{3}(?=年)/)?.[0]||'',series:'',referenceKind:task.category==='參考書'?(title.includes('歷屆')?'歷屆學測彙編':title.includes('模擬')?'成冊模擬題本':'學習講義'):'',folder:f.mimeType===FOLDER,hasAnswer:false};
     statements.push(env.DB.prepare('INSERT INTO books VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,category=excluded.category,data=excluded.data').bind(bookId,title,task.category,JSON.stringify(book)));
   }
   statements.push(env.DB.prepare('INSERT INTO assets(id,parent,book_id,name,mime,size,md5) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET parent=excluded.parent,book_id=excluded.book_id,name=excluded.name,mime=excluded.mime,size=excluded.size,md5=excluded.md5').bind(f.id,task.id,bookId,f.name,f.mimeType,Number(f.size)||0,f.md5Checksum||null));
   if(f.mimeType===FOLDER)statements.push(env.DB.prepare('INSERT OR IGNORE INTO scan VALUES (?,?,?,NULL)').bind(f.id,task.category,bookId));
 }
 // D1 batch executes atomically, so a failed page never advances the cursor.
 if(data.nextPageToken)statements.push(env.DB.prepare('UPDATE scan SET page_token=? WHERE id=?').bind(data.nextPageToken,task.id));
 else statements.push(env.DB.prepare('DELETE FROM scan WHERE id=?').bind(task.id));
 await env.DB.batch(statements);
 return {processed:data.files?.length||0,remaining:(await one(env,'SELECT COUNT(*) n FROM scan')).n,books:(await one(env,'SELECT COUNT(*) n FROM books')).n};
}
export async function assetFor(env,bookId,assetId){
 const a=await one(env,'SELECT * FROM assets WHERE id=? AND book_id=?',assetId||bookId,bookId);if(!a)fail(404,'檔案不屬於這本書');return a;
}
export async function verifyAsset(env,asset,token){
 const meta=await (await drive(env,`files/${encodeURIComponent(asset.id)}?fields=id,size,md5Checksum,trashed,parents`,token)).json();
 if(meta.trashed||!meta.parents?.includes(asset.parent))fail(409,'檔案位置已變更，請管理者重新同步');
 // Revalidate the folder chain to the configured library roots on each request.
 let parent=asset.parent;const visited=new Set();
 while(![env.REFERENCE_ROOT_ID,env.MOCK_ROOT_ID].includes(parent)){
   if(visited.has(parent)||visited.size>=20)fail(403,'檔案不在授權書庫');visited.add(parent);
   const p=await one(env,'SELECT * FROM assets WHERE id=? AND book_id=?',parent,asset.book_id);if(!p||p.mime!==FOLDER)fail(403,'檔案不在授權書庫');
   const current=await (await drive(env,`files/${encodeURIComponent(p.id)}?fields=parents,trashed`,token)).json();
   if(current.trashed||!current.parents?.includes(p.parent))fail(403,'檔案已移出授權書庫');parent=p.parent;
 }
 if(Number(meta.size)!==asset.size||meta.md5Checksum!==asset.md5)fail(409,'檔案已變更，請同步書目並重建閱覽索引');return meta;
}
export async function indexFor(env,asset,token){
 const imported=await one(env,'SELECT * FROM pdf_headers WHERE asset=? AND size=? AND md5=?',asset.id,asset.size,asset.md5)
   || await one(env,'SELECT * FROM pdf_headers WHERE size=? AND md5=? ORDER BY asset LIMIT 1',asset.size,asset.md5);
 if(imported){
   if(imported.size!==asset.size||imported.md5!==asset.md5)fail(409,'閱覽索引與原檔不符，請重建索引');
    return {asset:asset.id,indexAsset:imported.asset,size:imported.size,md5:imported.md5,tail:imported.tail,tailEncoding:'base64',pageCount:imported.page_count,imported:true};
 }
 let id=asset.index_id;
 if(!id){
   const params=new URLSearchParams({q:`'${env.INDEX_ROOT_ID}' in parents and trashed = false and name = '${asset.id}.json.gz'`,fields:'files(id)',pageSize:'2'});
   const data=await (await drive(env,'files?'+params,token)).json();
   if(data.files?.length!==1)fail(409,'此檔案尚未完成閱讀索引，請管理者在書庫連線管理按同步');id=data.files[0].id;
 }
 const response=await drive(env,`files/${id}?alt=media`,token);
 const gz=await bounded(response,2*1024*1024);
 const inflated=new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip')));
 const index=JSON.parse(new TextDecoder().decode(await bounded(inflated,8*1024*1024)));
 if(index.asset!==asset.id||index.size!==asset.size||index.md5!==asset.md5||!Array.isArray(index.pages))fail(409,'閱覽索引與原檔不符，請重建索引');
 return index;
}
export async function singlePage(env,asset,index,page,code,token){
 let entry;
 if(index.imported){
   const parts=await rows(env,'SELECT data FROM pdf_pages WHERE asset=? AND page=? ORDER BY part',index.indexAsset||asset.id,page);
   if(!parts.length)fail(409,'這一頁尚未匯入完成');
   const response=new Response(new Blob([unb64(parts.map(p=>p.data).join(''))]).stream().pipeThrough(new DecompressionStream('gzip')));
   entry=JSON.parse(new TextDecoder().decode(await bounded(response,2*1024*1024)));
 }else entry=index.pages[page-1];
 if(!entry||entry.length>16*1024*1024||!Array.isArray(entry.parts)||entry.parts.length>80)fail(400,'頁碼或索引無效');
 const chunks=[];let total=0;
 for(const part of entry.parts){
   let bytes;
   if(typeof part==='string')bytes=replaceTrace(unb64(part),code);
   else{
     const [offset,length]=part;if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<=0||offset+length>asset.size||length>16*1024*1024)fail(409,'索引區段無效');
     const r=await drive(env,`files/${asset.id}?alt=media`,token,{Range:`bytes=${offset}-${offset+length-1}`});
     if(r.status!==206||r.headers.get('Content-Range')!==`bytes ${offset}-${offset+length-1}/${asset.size}`) {await r.body?.cancel();fail(502,'Drive 未回傳正確的頁面區段');}
     bytes=await bounded(r,length);if(bytes.length!==length)fail(502,'頁面內容不完整');
   }
   total+=bytes.length;if(total>16*1024*1024)fail(413,'頁面過大');chunks.push(bytes);
 }
 if(total!==entry.length)fail(409,'頁面索引長度不符');
 return new Blob(chunks,{type:'application/pdf'}).stream();
}
export async function fullFile(env,asset,index,code,token){
 const rawTail=index.tailEncoding==='base64'?unb64(index.tail):new TextEncoder().encode(index.tail);
 const textTail=new TextDecoder('latin1').decode(rawTail);
 if(rawTail.length>16384||!textTail.includes('/BibliothecaTrace (ZZZZ-ZZZZ)'))fail(409,'完整 PDF 追蹤索引尚未設定');
 const r=await drive(env,`files/${asset.id}?alt=media`,token),declared=r.headers.get('content-length');
 // Drive may use chunked transfer. The stream below still verifies every byte.
 if(r.status!==200||(declared!==null&&Number(declared)!==asset.size)){await r.body?.cancel();fail(502,'來源 PDF 長度不符');}
 const tail=rawTail.slice(),marker=new TextEncoder().encode('ZZZZ-ZZZZ'),replacement=new TextEncoder().encode(code);
 outer:for(let i=0;i<=tail.length-marker.length;i++){for(let j=0;j<marker.length;j++)if(tail[i+j]!==marker[j])continue outer;tail.set(replacement,i);break;}
 return appendPdfTail(r.body,asset.size,tail);
}
