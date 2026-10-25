importScripts('./pdf-lib.min.js','./spark-md5.min.js');
let sequence=0;const pending=new Map();
function rpc(action,body){const id=++sequence;postMessage({type:'rpc',id,action,body});return new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));}
self.onmessage=async({data})=>{
 if(data.type==='reply'){const p=pending.get(data.id);if(!p)return;pending.delete(data.id);if(data.error){const e=Error(data.error);e.status=data.status;p.reject(e);}else p.resolve(data.result);return;}
 if(data.type!=='build')return;
 try{
  const {compileWatermarkedPdf}=await import('./pdf-watermark-builder.mjs');
  const {base64,MAX_PDF_BYTES}=await import('./pdf-index-builder.mjs');
  const {MAX_TEMPLATE_BYTES,MAX_TEMPLATE_PAYLOAD}=await import('./pdf-watermark-format.mjs'),job=data.job;
  if(job.size>MAX_PDF_BYTES)throw Error('PDF 超過 256 MiB，請先分冊');
  const response=await fetch('/api/watermark/source?asset='+encodeURIComponent(job.asset),{headers:{Authorization:'Bearer '+data.token},cache:'no-store',credentials:'omit'});
  if(!response.ok){const d=await response.json();const e=Error(d.error||'無法讀取 PDF');e.status=response.status;throw e;}
  const source=new Uint8Array(job.size),reader=response.body.getReader();let loaded=0,last=0;
  while(true){const {value,done}=await reader.read();if(done)break;if(loaded+value.length>source.length){await reader.cancel();throw Error('PDF 大小已變更，請重新同步');}source.set(value,loaded);loaded+=value.length;if(Date.now()-last>300){postMessage({type:'progress',phase:'download',loaded,total:job.size});last=Date.now();}}
  if(loaded!==source.length)throw Error('PDF 傳輸不完整，請重新準備');
  postMessage({type:'progress',phase:'parse'});
  const plan=await compileWatermarkedPdf(source,job,{PDFLib:self.PDFLib,SparkMD5:self.SparkMD5,onProgress:(page,total)=>postMessage({type:'progress',phase:'page',page,total})});
  const json=JSON.stringify(plan);if(new TextEncoder().encode(json).length>MAX_TEMPLATE_BYTES)throw Error('PDF 合成樣板過大，請重新匯出 PDF');
  const gzip=new Blob([json]).stream().pipeThrough(new CompressionStream('gzip')),payload=base64(new Uint8Array(await new Response(gzip).arrayBuffer()));
  if(payload.length>MAX_TEMPLATE_PAYLOAD)throw Error('PDF 合成樣板過大，請重新匯出 PDF');
  await rpc('store',{asset:job.asset,data:payload});postMessage({type:'done',pages:plan.pages});
 }catch(e){postMessage({type:'error',message:e.message||'PDF 保護準備失敗',status:e.status});}
};
