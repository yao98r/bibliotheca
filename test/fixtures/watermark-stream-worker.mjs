import {decodeWatermarkTemplate,personalizeWatermark,composeWatermarkedPdf,composeNativeWatermarkedPdf} from '../../src/backend-watermark.mjs';
export default {async fetch(request){
 const {asset,data,failure,native,source:encoded}=await request.json(),template=await decodeWatermarkTemplate(data,asset);let sent=false;
 if(native){
  const source=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
  try{const output=await composeNativeWatermarkedPdf(async(offset,size)=>{
   let bytes=source.subarray(offset,offset+size);if(failure==='short')bytes=bytes.subarray(0,bytes.length-1);
   return new Response(bytes,{status:failure==='full'?200:206,headers:{'Content-Range':`bytes ${offset}-${offset+size-1}/${asset.size}`}});
  },asset,template,personalizeWatermark(template,'ABCD-EFGH','1'.repeat(64)));return new Response(output,{headers:{'X-PDF-Bytes':String(template.plan.length)}});}
  catch(error){return Response.json({error:error.message},{status:502});}
 }
 const source=new ReadableStream({pull(c){if(sent){if(failure==='disconnect')c.error(Error('Synthetic source disconnected'));else c.close();return;}sent=true;c.enqueue(new Uint8Array(65536));}});
 const bridge=new IdentityTransformStream();source.pipeTo(bridge.writable).catch(()=>{});
 return new Response(composeWatermarkedPdf(bridge.readable,asset,template,personalizeWatermark(template,'ABCD-EFGH','1'.repeat(64))),{headers:{'X-PDF-Bytes':String(template.plan.length)}});
}};
