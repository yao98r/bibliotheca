import {base64,MAX_PDF_BYTES,streamLocator} from './pdf-index-builder.mjs';
import {WATERMARK_VERSION,CODE_PLACEHOLDER,PROOF_PLACEHOLDER,BARCODE_PLACEHOLDER,MAX_TEMPLATE_BYTES,invisibleHex} from './pdf-watermark-format.mjs';
const encoder=new TextEncoder();
function bytesOf(object){const bytes=new Uint8Array(object.sizeInBytes());const written=object.copyBytesInto(bytes,0);if(written!==bytes.length)throw Error('PDF 物件長度不符');return bytes;}
function join(arrays){const out=new Uint8Array(arrays.reduce((n,a)=>n+a.length,0));let at=0;for(const a of arrays){out.set(a,at);at+=a.length;}return out;}
function locations(bytes,text){
 const needle=encoder.encode(text),out=[];
 outer:for(let i=0;i<=bytes.length-needle.length;i++){if(bytes[i]!==needle[0])continue;for(let j=1;j<needle.length;j++)if(bytes[i+j]!==needle[j])continue outer;out.push(i);i+=needle.length-1;}
 return out;
}
export async function compileWatermarkedPdf(source,expected,{PDFLib,SparkMD5,onProgress=()=>{}}){
 if(source.length!==expected.size||source.length>MAX_PDF_BYTES)throw Error('PDF 大小不符或超過 256 MiB');
 const md5=SparkMD5.ArrayBuffer.hash(source.buffer.slice(source.byteOffset,source.byteOffset+source.byteLength));
 if(md5!==expected.md5)throw Error('PDF 校驗不符，請重新同步');
 const {PDFDocument,PDFName,PDFString,PDFHexString,PDFNumber,PDFRawStream}=PDFLib;
 const doc=await PDFDocument.load(source,{updateMetadata:false,throwOnInvalidObject:true});
 if(doc.isEncrypted)throw Error('不支援加密 PDF');
 const pages=doc.getPages();if(!pages.length||pages.length>10000)throw Error('PDF 頁數超過可處理範圍');
 const name=PDFName.of,hidden=invisibleHex(CODE_PLACEHOLDER);
 const form=doc.context.register(PDFRawStream.of(doc.context.obj({Type:'XObject',Subtype:'Form',BBox:[0,0,1.3,61.25],Resources:{},Length:BARCODE_PLACEHOLDER.length}),encoder.encode(BARCODE_PLACEHOLDER)));
 for(const [index,page] of pages.entries()){
  const crop=page.getCropBox(),rotation=((page.getRotation().angle%360)+360)%360;
  if(![0,90,180,270].includes(rotation))throw Error('不支援的 PDF 旋轉角度');
  const resources=page.node.Resources()?.clone(doc.context)||doc.context.obj({});
  const existing=resources.lookupMaybe(name('XObject'),PDFLib.PDFDict),xobjects=existing?existing.clone(doc.context):doc.context.obj({});
  let key='BibliothecaEdge';while(xobjects.has(name(key)))key+='_';
  xobjects.set(name(key),form);resources.set(name('XObject'),xobjects);page.node.set(name('Resources'),resources);
  const height=rotation%180?crop.width:crop.height,fraction=[.22,.38,.62,.78][index%4],start=Math.max(4,Math.min(height-65.25,height*fraction-30.625));
  const matrix=rotation===0?[1,0,0,1,crop.x+crop.width-2.5,crop.y+start]
   :rotation===90?[0,1,1,0,crop.x+start,crop.y+crop.height-2.5]
   :rotation===180?[1,0,0,-1,crop.x+1.2,crop.y+crop.height-start]
   :[0,1,-1,0,crop.x+crop.width-start,crop.y+1.2];
  // Isolate arbitrary graphics state left by the source before adding the mark.
  const before=doc.context.register(doc.context.stream('q\n'));
  const after=doc.context.register(doc.context.stream(`Q\nq\n${matrix.map(n=>Number(n.toFixed(4))).join(' ')} cm\n/${key} Do\nQ\n`));
  // Preserve indirect stream references. Contents() dereferences a single
  // stream, which would embed its binary bytes illegally inside this array.
  const old=page.node.get(name('Contents')),resolved=doc.context.lookup(old);
  const contents=resolved instanceof PDFLib.PDFArray?resolved.asArray():old?[old]:[];
  page.node.set(name('Contents'),doc.context.obj([before,...contents,after]));
  page.node.set(name('BibliothecaTrace'),PDFString.of(CODE_PLACEHOLDER));
  page.node.set(name('BibliothecaInvisibleTrace'),PDFHexString.of(hidden));
  onProgress(index+1,pages.length);
 }
 const info=doc.context.obj({BibliothecaTrace:PDFString.of(CODE_PLACEHOLDER),BibliothecaProof:PDFString.of(PROOF_PLACEHOLDER),BibliothecaWatermarkVersion:PDFString.of('server-v2'),BibliothecaSourceMD5:PDFString.of(md5),BibliothecaSourceBytes:PDFNumber.of(source.length)});
 const infoRef=doc.context.register(info),root=doc.context.trailerInfo.Root;
 const locate=streamLocator(source,SparkMD5),literal=[],ranged=[],usedOffsets=new Set();
 for(const [ref,object] of doc.context.enumerateIndirectObjects()){
  if(ref.objectNumber>200000)throw Error('PDF 物件編號過大，請重新匯出');
  const offset=object instanceof PDFRawStream&&object.contents.length>=256?locate(object.contents,usedOffsets):-1;
  if(offset>=0)usedOffsets.add(offset);
  (offset>=0?ranged:literal).push({ref,object,offset});
 }
 ranged.sort((a,b)=>a.offset-b.offset);let previousEnd=0;
 // A duplicated/overlapping source stream cannot be read twice in one pass.
 // Keep such uncommon duplicates in metadata if the bounded template allows it.
 const forward=[];for(const item of ranged){if(item.offset<previousEnd)literal.push({...item,offset:-1});else{forward.push(item);previousEnd=item.offset+item.object.contents.length;}}
 const segments=[],metadata=[],offsets=new Map();let outputLength=0,metaLength=0;
 function append(bytes){if(!bytes.length)return;const previous=segments.at(-1);if(previous?.[0]===0)previous[2]+=bytes.length;else segments.push([0,metaLength,bytes.length]);metadata.push(bytes);metaLength+=bytes.length;outputLength+=bytes.length;if(metaLength>MAX_TEMPLATE_BYTES)throw Error('PDF 結構超過合成樣板上限，請重新匯出');}
 append(encoder.encode('%PDF-1.7\n%Bibliotheca personalized PDF\n'));
 for(const {ref,object,offset} of [...literal,...forward]){
  offsets.set(ref.objectNumber,[outputLength,ref.generationNumber]);append(encoder.encode(`${ref.objectNumber} ${ref.generationNumber} obj\n`));
  if(offset<0)append(bytesOf(object));
  else{
   const dict=object.dict.clone(doc.context);dict.set(name('Length'),PDFNumber.of(object.contents.length));
   append(bytesOf(dict));append(encoder.encode('\nstream\n'));
   segments.push([1,offset,object.contents.length]);outputLength+=object.contents.length;
   append(encoder.encode('\nendstream'));
  }
  append(encoder.encode('\nendobj\n'));
 }
 const xrefOffset=outputLength,size=Math.max(...offsets.keys())+1;
 let xref=`xref\n0 ${size}\n0000000000 65535 f \n`;
 for(let i=1;i<size;i++){const entry=offsets.get(i);xref+=entry?`${String(entry[0]).padStart(10,'0')} ${String(entry[1]).padStart(5,'0')} n \n`:'0000000000 00000 f \n';}
 append(encoder.encode(xref+`trailer\n<< /Size ${size} /Root ${root} /Info ${infoRef} >>\nstartxref\n${xrefOffset}\n%%EOF\n`));
 const meta=join(metadata),codes=locations(meta,`/BibliothecaTrace (${CODE_PLACEHOLDER})`).map(i=>i+'/BibliothecaTrace ('.length);
 const proofs=locations(meta,`/BibliothecaProof (${PROOF_PLACEHOLDER})`).map(i=>i+'/BibliothecaProof ('.length);
 const invisible=locations(meta,`/BibliothecaInvisibleTrace <${hidden}>`).map(i=>i+'/BibliothecaInvisibleTrace <'.length),barcodes=locations(meta,BARCODE_PLACEHOLDER);
 if(codes.length!==pages.length+1||proofs.length!==1||invisible.length!==pages.length||barcodes.length!==1)throw Error('PDF 水印樣板位置不符');
 return {version:WATERMARK_VERSION,compilerRevision:2,sourceSize:source.length,sourceMd5:md5,pages:pages.length,length:outputLength,metadata:base64(meta),segments,slots:{codes,proof:proofs[0],invisible,barcode:barcodes[0]}};
}
