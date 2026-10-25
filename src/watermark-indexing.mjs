import {fail,hash,iso} from './core.mjs';
import {one,rows,driveToken} from './auth.mjs';
import {drive,verifyAsset} from './drive.mjs';
import {decodeWatermarkTemplate} from './backend-watermark.mjs';
export const TEMPLATE_STORAGE_BUDGET=100*1024*1024;
export async function watermarkRow(env,asset,content=false){
 return one(env,`SELECT ${content?'*':'page_count,output_bytes,version'} FROM pdf_watermarks WHERE size=? AND md5=? AND version=2`,asset.size,asset.md5);
}
export async function nextWatermark(env,skip=[]){
 if(!Array.isArray(skip)||skip.length>1000||skip.some(s=>typeof s!=='string'||s.length>200))fail(400,'略過清單無效');
 const missing=await rows(env,"SELECT a.id,a.name,a.size,a.md5 FROM assets a WHERE a.mime='application/pdf' AND EXISTS(SELECT 1 FROM pdf_headers h WHERE h.size=a.size AND h.md5=a.md5) AND NOT EXISTS(SELECT 1 FROM pdf_watermarks w WHERE w.size=a.size AND w.md5=a.md5 AND w.version=2) ORDER BY a.size,a.id");
 const a=missing.find(a=>!skip.includes(a.id));
 return {job:a?{asset:a.id,name:a.name,size:a.size,md5:a.md5}:null,remaining:missing.length};
}
async function currentAsset(env,id){
 if(typeof id!=='string'||!/^[-\w]{10,200}$/.test(id))fail(400,'PDF 檔案代碼無效');
 const asset=await one(env,"SELECT * FROM assets WHERE id=? AND mime='application/pdf'",id);
 if(!asset)fail(404,'找不到 PDF');if(asset.size>256*1024*1024)fail(413,'PDF 超過 256 MiB，請先分冊');return asset;
}
export async function watermarkSource(env,id){
 const asset=await currentAsset(env,id),token=await driveToken(env);await verifyAsset(env,asset,token);
 const response=await drive(env,`files/${asset.id}?alt=media`,token);
 if(response.status!==200){await response.body?.cancel();fail(502,'無法取得 PDF');}
 return new Response(response.body,{headers:{'Content-Type':'application/pdf','X-PDF-Bytes':String(asset.size)}});
}
export async function storeWatermark(env,body,budgetBytes=TEMPLATE_STORAGE_BUDGET){
 const asset=await currentAsset(env,body.asset),decoded=await decodeWatermarkTemplate(body.data,asset);
 await verifyAsset(env,asset,await driveToken(env));
 const etag=await hash(body.data);
 // The SELECT guard and upsert share one SQLite statement: simultaneous
 // preparations cannot race past this application storage budget.
 const result=await env.DB.prepare(`INSERT INTO pdf_watermarks(size,md5,asset,data,etag,page_count,output_bytes,version,created_at) SELECT ?,?,?,?,?,?,?,2,? WHERE (SELECT COALESCE(SUM(LENGTH(data)),0) FROM pdf_watermarks)-COALESCE((SELECT LENGTH(data) FROM pdf_watermarks WHERE size=? AND md5=?),0)+?<=? ON CONFLICT(size,md5) DO UPDATE SET asset=excluded.asset,data=excluded.data,etag=excluded.etag,page_count=excluded.page_count,output_bytes=excluded.output_bytes,version=2,created_at=excluded.created_at WHERE pdf_watermarks.etag IS NOT excluded.etag OR pdf_watermarks.version<>2`).bind(asset.size,asset.md5,asset.id,body.data,etag,decoded.plan.pages,decoded.plan.length,iso(),asset.size,asset.md5,body.data.length,budgetBytes).run();
 if(!result.meta.changes&&(await one(env,'SELECT etag FROM pdf_watermarks WHERE size=? AND md5=?',asset.size,asset.md5))?.etag!==etag)fail(507,'整本保護樣板已達應用程式的儲存預算，請管理者整理後重試；系統不會升級付費服務。');
 return {ok:true,pages:decoded.plan.pages,outputBytes:decoded.plan.length,changed:result.meta.changes>0};
}
