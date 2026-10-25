import {decodeWatermarkTemplate,personalizeWatermark,composeWatermarkedPdf} from '../../src/backend-watermark.mjs';
export default {async fetch(request){
 const {asset,data,failure}=await request.json(),template=await decodeWatermarkTemplate(data,asset);let sent=false;
 const source=new ReadableStream({pull(c){if(sent){if(failure==='disconnect')c.error(Error('Synthetic source disconnected'));else c.close();return;}sent=true;c.enqueue(new Uint8Array(65536));}});
 return new Response(composeWatermarkedPdf(source,asset,template,personalizeWatermark(template,'ABCD-EFGH','1'.repeat(64))),{headers:{'X-PDF-Bytes':String(template.plan.length)}});
}};
