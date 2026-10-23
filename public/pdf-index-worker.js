importScripts('./pdf-lib.min.js','./spark-md5.min.js');
let sequence=0;const pending=new Map();
function rpc(action,body){const id=++sequence;postMessage({type:'rpc',id,action,body});return new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));}
self.onmessage=async({data})=>{
 if(data.type==='reply'){const p=pending.get(data.id);if(!p)return;pending.delete(data.id);if(data.error){const e=Error(data.error);e.status=data.status;p.reject(e);}else p.resolve(data.result);return;}
 if(data.type!=='build')return;
 try{
  const {preparePdf,base64,MAX_PDF_BYTES}=await import('./pdf-index-builder.mjs'),job=data.job;
  if(job.size>MAX_PDF_BYTES)throw Error('PDF 超過 256 MB，請先分冊再同步。');
  postMessage({type:'progress',phase:'download',loaded:0,total:job.size});
  const response=await fetch('/api/index/source?job='+encodeURIComponent(job.id),{headers:{Authorization:'Bearer '+data.token},cache:'no-store',credentials:'omit'});
  if(!response.ok){const d=await response.json();const e=Error(d.error||'無法下載 PDF');e.status=response.status;throw e;}
  const source=new Uint8Array(job.size),reader=response.body.getReader();let loaded=0,last=0;
  while(true){const {value,done}=await reader.read();if(done)break;if(loaded+value.length>source.length){await reader.cancel();throw Error('PDF 大小已變更，請重新同步。');}source.set(value,loaded);loaded+=value.length;if(Date.now()-last>300){postMessage({type:'progress',phase:'download',loaded,total:job.size});last=Date.now();}}
  if(loaded!==source.length)throw Error('PDF 傳輸中斷，請重新同步。');
  postMessage({type:'progress',phase:'parse'});
  const builder=await preparePdf(source,job,{PDFLib:self.PDFLib,SparkMD5:self.SparkMD5});
  const started=await rpc('start',{job:job.id,header:builder.header});
  let page=started.nextPage;
  while(page<=builder.header.pageCount){
   postMessage({type:'progress',phase:'page',page,total:builder.header.pageCount});
   const entry=await builder.page(page),gzip=new Blob([JSON.stringify(entry)]).stream().pipeThrough(new CompressionStream('gzip'));
   const payload=base64(new Uint8Array(await new Response(gzip).arrayBuffer()));
   const saved=await rpc('page',{job:job.id,page,data:payload});
   if(saved.nextPage<=page||saved.nextPage>builder.header.pageCount+1)throw Error('頁面進度不符，請重試同步。');page=saved.nextPage;
  }
  await rpc('finish',{job:job.id});postMessage({type:'done',pages:builder.header.pageCount});
 }catch(e){postMessage({type:'error',message:e.message||'PDF 處理失敗',status:e.status});}
};
