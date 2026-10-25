import {bounded,fail,unb64} from './core.mjs';
import {encodeCode39} from '../public/trace-watermark.mjs';
import {WATERMARK_VERSION,CODE_PLACEHOLDER,PROOF_PLACEHOLDER,BARCODE_BYTES,BARCODE_PLACEHOLDER,MAX_TEMPLATE_BYTES,invisibleHex,barcodeCommands} from '../public/pdf-watermark-format.mjs';
const encoder=new TextEncoder();
const keys=new Map(),templates=new Map();let templateWeight=0;
const same=(bytes,at,text)=>{const expected=encoder.encode(text);return expected.every((v,i)=>bytes[at+i]===v);};
export function validateWatermarkTemplate(plan,asset){
 if(!plan||plan.version!==WATERMARK_VERSION||plan.compilerRevision!==2||plan.sourceSize!==asset.size||plan.sourceMd5!==asset.md5||!Number.isInteger(plan.pages)||plan.pages<1||plan.pages>10000||!Number.isSafeInteger(plan.length)||plan.length<1||plan.length>asset.size+MAX_TEMPLATE_BYTES||typeof plan.metadata!=='string'||plan.metadata.length>MAX_TEMPLATE_BYTES*1.4||!Array.isArray(plan.segments)||plan.segments.length>100000)fail(400,'PDF 合成樣板無效');
 const metadata=unb64(plan.metadata),slots=plan.slots;if(metadata.length>MAX_TEMPLATE_BYTES||!slots||!Array.isArray(slots.codes)||slots.codes.length!==plan.pages+1||!Array.isArray(slots.invisible)||slots.invisible.length!==plan.pages)fail(400,'PDF 水印位置無效');
 const reserved=[];
 function slot(at,text){if(!Number.isSafeInteger(at)||at<0||at+text.length>metadata.length||!same(metadata,at,text))fail(400,'PDF 水印預留空間不符');reserved.push([at,at+text.length]);}
 for(const at of slots.codes)slot(at,CODE_PLACEHOLDER);
 for(const at of slots.invisible)slot(at,invisibleHex(CODE_PLACEHOLDER));
 slot(slots.proof,PROOF_PLACEHOLDER);slot(slots.barcode,BARCODE_PLACEHOLDER);
 reserved.sort((a,b)=>a[0]-b[0]);for(let i=1;i<reserved.length;i++)if(reserved[i][0]<reserved[i-1][1])fail(400,'PDF 水印預留空間重疊');
 let length=0,sourceEnd=0,metaEnd=0,rangeCount=0;
 for(const segment of plan.segments){
  if(!Array.isArray(segment)||segment.length!==3||![0,1].includes(segment[0])||!Number.isSafeInteger(segment[1])||!Number.isSafeInteger(segment[2])||segment[1]<0||segment[2]<1)fail(400,'PDF 合成區段無效');
  const [kind,offset,size]=segment;
  if(kind===0){if(offset!==metaEnd||offset+size>metadata.length)fail(400,'PDF 結構區段不完整');metaEnd+=size;}
  else{if(offset<sourceEnd||offset+size>asset.size)fail(400,'PDF 來源區段順序無效');sourceEnd=offset+size;rangeCount++;}
  length+=size;
 }
 if(length!==plan.length||metaEnd!==metadata.length||plan.segments[0]?.[0]!==0||plan.segments.at(-1)?.[0]!==0||!same(metadata,0,'%PDF-1.7\n')||!same(metadata,metadata.length-6,'%%EOF\n'))fail(400,'PDF 合成長度或結構不符');
 // Rebuild the PDF: never append a reversible update to the original file.
 if(plan.segments.some(s=>s[0]===1&&s[1]===0))fail(400,'PDF 樣板不得直接包含原檔');
 return {plan,metadata,weight:metadata.length+JSON.stringify(plan).length*2,rangeCount};
}
export async function decodeWatermarkTemplate(data,asset){
 if(typeof data!=='string'||data.length>700000)fail(413,'PDF 合成樣板過大');
 try{
  const stream=new Blob([unb64(data)]).stream().pipeThrough(new DecompressionStream('gzip'));
  const bytes=await bounded(new Response(stream),MAX_TEMPLATE_BYTES);
  return validateWatermarkTemplate(JSON.parse(new TextDecoder().decode(bytes)),asset);
 }catch(e){if(e.status)throw e;fail(400,'PDF 合成樣板無法解析');}
}
export async function loadWatermarkTemplate(row,asset){
 const key=asset.size+':'+asset.md5+':'+row.etag;
 if(templates.has(key)){const value=templates.get(key);templates.delete(key);templates.set(key,value);return value;}
 const value=await decodeWatermarkTemplate(row.data,asset);
 if(value.weight<=8*1024*1024){while(templateWeight+value.weight>8*1024*1024&&templates.size){const [old,item]=templates.entries().next().value;templates.delete(old);templateWeight-=item.weight;}templates.set(key,value);templateWeight+=value.weight;}
 return value;
}
export async function watermarkProof(keyText,ticket,asset){
 if(!keys.has(keyText)){
  if(keys.size>=2)keys.delete(keys.keys().next().value);
  keys.set(keyText,(async()=>{const input=await crypto.subtle.importKey('raw',unb64(keyText),'HKDF',false,['deriveKey']);return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:encoder.encode('bibliotheca-pdf-v2'),info:encoder.encode('watermark-signature')},input,{name:'HMAC',hash:'SHA-256',length:256},false,['sign']);})());
 }
 const key=await keys.get(keyText),context=JSON.stringify(['bibliotheca-pdf-v2',ticket.hash,ticket.trace_code,ticket.email,asset.size,asset.md5]);
 const signature=await crypto.subtle.sign('HMAC',key,encoder.encode(context));
 return Array.from(new Uint8Array(signature),v=>v.toString(16).padStart(2,'0')).join('');
}
export function personalizeWatermark(template,code,proof){
 if(!/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code)||!(/^[a-f0-9]{64}$/).test(proof))fail(400,'PDF 授權識別資訊無效');
 const {plan}=template,metadata=template.metadata.slice();
 const replacement=encoder.encode(code),invisible=encoder.encode(invisibleHex(code));
 for(const at of plan.slots.codes)metadata.set(replacement,at);
 for(const at of plan.slots.invisible)metadata.set(invisible,at);
 metadata.set(encoder.encode(proof),plan.slots.proof);
 const barcode=encoder.encode(barcodeCommands(code,encodeCode39));if(barcode.length!==BARCODE_BYTES)fail(500,'PDF 水印長度不符');metadata.set(barcode,plan.slots.barcode);
 return metadata;
}
export function composeWatermarkedPdf(source,asset,template,metadata){
 const {plan}=template,reader=source.getReader();let index=0,sourcePosition=0,chunk,at=0,rangeUsed=0,output=0,ended=false;
 async function nextChunk(){const result=await reader.read();if(result.done){ended=true;if(sourcePosition!==asset.size)throw Error('Incomplete Drive source');return false;}chunk=result.value;at=0;if(sourcePosition+chunk.length>asset.size)throw Error('Oversized Drive source');return true;}
 async function finishSource(){if(chunk){sourcePosition+=chunk.length-at;chunk=null;}while(!ended){if(!await nextChunk())break;sourcePosition+=chunk.length;chunk=null;}}
 const assembled=new ReadableStream({
  async pull(controller){try{
   while(index<plan.segments.length){
    const [kind,offset,size]=plan.segments[index];
    if(kind===0){if(index===plan.segments.length-1)await finishSource();const bytes=metadata.subarray(offset,offset+size);index++;output+=bytes.length;controller.enqueue(bytes);return;}
    const wanted=offset+rangeUsed;
    if(!chunk||at===chunk.length){chunk=null;if(!await nextChunk())throw Error('Missing PDF stream');}
    if(sourcePosition<wanted){const skipped=Math.min(wanted-sourcePosition,chunk.length-at);at+=skipped;sourcePosition+=skipped;continue;}
    if(sourcePosition!==wanted)throw Error('PDF source order mismatch');
    const take=Math.min(size-rangeUsed,chunk.length-at),bytes=chunk.subarray(at,at+take);at+=take;sourcePosition+=take;rangeUsed+=take;output+=take;
    if(rangeUsed===size){index++;rangeUsed=0;}controller.enqueue(bytes);return;
   }
   // Verify and discard the source trailer; it never reaches the browser.
   await finishSource();
   if(output!==plan.length)throw Error('PDF output length mismatch');controller.close();reader.releaseLock();
  }catch(e){await reader.cancel(e).catch(()=>{});controller.error(e);}},
  async cancel(reason){await reader.cancel(reason);}
 });
 if(typeof FixedLengthStream!=='undefined'){
  const fixed=new FixedLengthStream(plan.length);assembled.pipeTo(fixed.writable).catch(()=>{});return fixed.readable;
 }
 return assembled;
}
