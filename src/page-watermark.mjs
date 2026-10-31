import {fail} from './core.mjs';
import {encodeCode39} from '../public/trace-watermark.mjs';
import {BARCODE_PLACEHOLDER,CODE_PLACEHOLDER,barcodeCommands} from '../public/pdf-watermark-format.mjs';
const encoder=new TextEncoder();
export function personalizeIndexedPage(entry,chunks,code){
 if(!entry.watermark)return null;
 const w=entry.watermark;
 if(w.version!==2||!Array.isArray(w.codes)||w.codes.length<1||w.codes.length>8)fail(409,'頁面保護索引無效');
 const bytes=new Uint8Array(entry.length);let position=0;
 for(const chunk of chunks){bytes.set(chunk,position);position+=chunk.length;}
 if(position!==entry.length)fail(409,'頁面長度不符');
 const reserved=[];
 function replace(at,expected,replacement){
  const a=encoder.encode(expected),b=encoder.encode(replacement);
  if(!Number.isSafeInteger(at)||at<0||at+a.length>bytes.length||a.length!==b.length||a.some((v,n)=>bytes[at+n]!==v)||reserved.some(([start,end])=>at<end&&at+a.length>start))fail(409,'頁面保護預留位置不符');
  reserved.push([at,at+a.length]);bytes.set(b,at);
 }
 // Validate the trace and replace fixed-width slots without changing PDF offsets.
 const barcode=barcodeCommands(code,encodeCode39);
 for(const at of w.codes)replace(at,CODE_PLACEHOLDER,code);
 replace(w.barcode,BARCODE_PLACEHOLDER,barcode);
 return bytes;
}
