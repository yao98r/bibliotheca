// This cache is scoped to one open viewer. No PDF or canvas enters persistent storage.
export class PagePreviewCache{
 constructor({maxPages=3,maxPixels=6000000}={}){this.maxPages=maxPages;this.maxPixels=maxPixels;this.items=new Map();this.pending=new Map();this.pixels=0;this.generation=0;}
 dispose(item){item.canvas.width=0;item.canvas.height=0;}
 async getOrRender(key,render){
  if(this.items.has(key)){const item=this.items.get(key);this.items.delete(key);this.items.set(key,item);return item;}
  if(this.pending.has(key))return this.pending.get(key);
  const generation=this.generation;
  const promise=Promise.resolve().then(render).then(item=>{
   if(generation!==this.generation){this.dispose(item);throw Error('預覽已重設');}
   const pixels=item.canvas.width*item.canvas.height;
   if(pixels<=this.maxPixels){
    while(this.items.size>=this.maxPages||this.pixels+pixels>this.maxPixels){const [oldKey,old]=this.items.entries().next().value;this.items.delete(oldKey);this.pixels-=old.canvas.width*old.canvas.height;this.dispose(old);}
    this.items.set(key,item);this.pixels+=pixels;
   }
   return item;
  }).finally(()=>{if(this.pending.get(key)===promise)this.pending.delete(key);});
  this.pending.set(key,promise);return promise;
 }
 release(item){if(![...this.items.values()].includes(item))this.dispose(item);}
 clear(){this.generation++;for(const item of this.items.values())this.dispose(item);this.items.clear();this.pending.clear();this.pixels=0;}
}
export async function readPdfBytes(response,onProgress=()=>{}){
 const length=Number(response.headers.get('X-PDF-Bytes')||response.headers.get('Content-Length'));
 if(response.body?.getReader&&Number.isSafeInteger(length)&&length>0){
  if(length>272*1024*1024)throw Error('PDF 過大，請改用下載。');
  const bytes=new Uint8Array(length),reader=response.body.getReader();let loaded=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;if(loaded+value.length>length)throw Error('PDF 大小不符，請重新載入。');bytes.set(value,loaded);loaded+=value.length;onProgress(loaded,length);}if(loaded!==length)throw Error('PDF 傳輸中斷，請重新載入。');return bytes;}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 }
 const bytes=new Uint8Array(await response.arrayBuffer());if(length>0&&bytes.length!==length)throw Error('PDF 傳輸中斷，請重新載入。');onProgress(bytes.length,bytes.length);return bytes;
}
