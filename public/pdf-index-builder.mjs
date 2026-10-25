const encoder=new TextEncoder();
export const MAX_PDF_BYTES=256*1024*1024;
export function base64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
const key=(bytes,offset=0)=>Array.from(bytes.subarray(offset,offset+16)).join(',');
function streamOffsets(bytes){
 const map=new Map();
 for(let i=bytes.indexOf(115);i>=0;i=bytes.indexOf(115,i+1)){
  if(bytes[i+1]!==116||bytes[i+2]!==114||bytes[i+3]!==101||bytes[i+4]!==97||bytes[i+5]!==109)continue;
  let p=i+6;
  // Match the line endings supported by PDF-LIB's stream parser.
  if(bytes[p]===13){p++;if(bytes[p]===10)p++;}else if(bytes[p]===10)p++;
  const k=key(bytes,p);if(!map.has(k))map.set(k,[]);map.get(k).push(p);
 }
 return map;
}
function sameBytes(source,offset,bytes){if(offset+bytes.length>source.length)return false;for(let i=0;i<bytes.length;i++)if(source[offset+i]!==bytes[i])return false;return true;}
export function streamLocator(source,SparkMD5){
 const offsets=streamOffsets(source),cache=new Map();
 return data=>{
  const signature=SparkMD5.ArrayBuffer.hash(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength));
  if(cache.has(signature)){const offset=cache.get(signature);if(offset<0||sameBytes(source,offset,data))return offset;}
  const offset=(offsets.get(key(data))||[]).find(p=>sameBytes(source,p,data))??-1;cache.set(signature,offset);return offset;
 };
}
export async function preparePdf(source,expected,{PDFLib,SparkMD5}){
 if(source.length!==expected.size)throw Error('PDF 傳輸不完整，請重新同步。');
 if(source.length>MAX_PDF_BYTES)throw Error('PDF 超過 256 MB，請先分冊再同步。');
 const md5=SparkMD5.ArrayBuffer.hash(source.buffer.slice(source.byteOffset,source.byteOffset+source.byteLength));
 if(md5!==expected.md5)throw Error('PDF 校驗不符，檔案可能已變更，請重新同步。');
 const {PDFDocument,PDFRawStream,PDFName,PDFString}=PDFLib;
 const doc=await PDFDocument.load(source,{updateMetadata:false,throwOnInvalidObject:true});
 if(doc.isEncrypted)throw Error('不支援加密 PDF，請先移除密碼。');
 const pages=doc.getPageCount();if(!pages||pages>10000)throw Error('PDF 頁數必須介於 1 到 10000 頁。');
 const trailerText=new TextDecoder('latin1').decode(source.subarray(Math.max(0,source.length-65536)));
 const matches=[...trailerText.matchAll(/startxref\s+(\d+)\s+%%EOF/g)];
 if(!matches.length)throw Error('PDF 缺少有效的交叉參照表，請重新匯出 PDF。');
 const previous=Number(matches.at(-1)[1]);if(previous>=source.length)throw Error('PDF 交叉參照位置無效。');
 // PDF-LIB omits object-stream and xref-stream containers from its context.
 // Reserve an object beyond the original trailer Size so the trace cannot
 // overwrite a container that holds the catalog or other compressed objects.
 const xrefText=new TextDecoder('latin1').decode(source.subarray(previous,Math.min(source.length,previous+65536)));
 const dictionary=xrefText.startsWith('xref')?trailerText.slice(trailerText.lastIndexOf('trailer')):xrefText.split(/\bstream\b/,1)[0];
 const trailerSize=Number(dictionary.match(/\/Size\s+(\d+)/)?.[1]);
 if(!Number.isSafeInteger(trailerSize)||trailerSize<1)throw Error('PDF 交叉參照大小無效，請重新匯出 PDF。');
 const number=Math.max(doc.context.largestObjectNumber+1,trailerSize),root=doc.context.trailerInfo.Root;
 const object=`\n${number} 0 obj\n<< /BibliothecaTrace (ZZZZ-ZZZZ) >>\nendobj\n`;
 const tail=encoder.encode(object+`xref\n${number} 1\n${String(source.length+1).padStart(10,'0')} 00000 n \ntrailer\n<< /Size ${number+1} /Root ${root} /Info ${number} 0 R /Prev ${previous} >>\nstartxref\n${source.length+encoder.encode(object).length}\n%%EOF\n`);
 const locate=streamLocator(source,SparkMD5);
 return {header:{size:source.length,md5,tail:base64(tail),pageCount:pages},async page(n){
  if(!Number.isInteger(n)||n<1||n>pages)throw Error('頁碼無效');
  const single=await PDFDocument.create({updateMetadata:false});
  // Remove navigation/annotations before copying: their destinations can refer
  // to other pages, which must not be embedded in a protected single-page PDF.
  const allowed=new Set(['Type','Parent','Resources','MediaBox','CropBox','BleedBox','TrimBox','ArtBox','Rotate','UserUnit','Contents','Group']);
  for(const name of doc.getPage(n-1).node.keys())if(!allowed.has(name.decodeText()))doc.getPage(n-1).node.delete(name);
  const [page]=await single.copyPages(doc,[n-1]);single.addPage(page);
  single.context.trailerInfo.Info=single.context.register(single.context.obj({BibliothecaTrace:PDFString.of('ZZZZ\\055ZZZZ')}));
  const spans=[];
  for(const [,object] of single.context.enumerateIndirectObjects()){
   if(!(object instanceof PDFRawStream)||object.contents.length<256)continue;
   const offset=locate(object.contents);if(offset<0)continue;
   const original=object.copyBytesInto;
   object.copyBytesInto=function(buffer,start){const written=original.call(this,buffer,start);const from=start+this.dict.sizeInBytes()+8;spans.push({from,to:from+this.contents.length,offset});return written;};
  }
  const bytes=await single.save({useObjectStreams:false,addDefaultPage:false,updateFieldAppearances:false,objectsPerTick:Infinity});
  if(bytes.length>16*1024*1024)throw Error('單頁超過 16 MB，請先壓縮 PDF。');
  const selected=spans.sort((a,b)=>(b.to-b.from)-(a.to-a.from)).slice(0,38).sort((a,b)=>a.from-b.from);
  const parts=[];let cursor=0;
  for(const span of selected){if(span.from<cursor)continue;if(!sameBytes(source,span.offset,bytes.subarray(span.from,span.to)))throw Error('PDF 頁面區段驗證失敗');if(span.from>cursor)parts.push(base64(bytes.subarray(cursor,span.from)));parts.push([span.offset,span.to-span.from]);cursor=span.to;}
  if(cursor<bytes.length)parts.push(base64(bytes.subarray(cursor)));
  const entry={length:bytes.length,parts};if(encoder.encode(JSON.stringify(entry)).length>2*1024*1024||parts.length>80)throw Error('此頁結構過於複雜，請重新匯出或壓縮 PDF。');
  return entry;
 }};
}
