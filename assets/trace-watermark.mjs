export function validTrace(code){return /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code||'');}
export async function extractTrace(file,loadPdfLib){
 const raw=await file.slice(0,1048576).text()+'\n'+await file.slice(Math.max(0,file.size-1048576)).text();
 const matches=[...raw.matchAll(/\/BibliothecaTrace\s*\(([^)]{1,40})\)/g)];
 for(const match of matches.reverse()){const code=match[1].replace(/\\([0-7]{3})/g,(_,n)=>String.fromCharCode(parseInt(n,8)));if(validTrace(code))return code;}
 if(file.size>268435456)return null;
 const {PDFDocument,PDFName}=await loadPdfLib(),doc=await PDFDocument.load(await file.arrayBuffer(),{updateMetadata:false});
 const info=doc.context.trailerInfo.Info&&doc.context.lookup(doc.context.trailerInfo.Info);
 const code=info?.get(PDFName.of('BibliothecaTrace'))?.decodeText?.();if(validTrace(code))return code;
 for(const page of doc.getPages()){const code=page.node.get(PDFName.of('BibliothecaTrace'))?.decodeText?.();if(validTrace(code))return code;}
 return null;
}
// Code 39: nine alternating bar/space elements, three wide elements (2:1).
// Modulo-43 checksum and ten-module quiet zones make the small mark decodable.
const ALPHABET='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';
const WIDTHS=[0x34,0x121,0x61,0x160,0x31,0x130,0x70,0x25,0x124,0x64,0x109,0x49,0x148,0x19,0x118,0x58,0xd,0x10c,0x4c,0x1c,0x103,0x43,0x142,0x13,0x112,0x52,0x7,0x106,0x46,0x16,0x181,0xc1,0x1c0,0x91,0x190,0xd0,0x85,0x184,0xc4,0xa8,0xa2,0x8a,0x2a];
export function encodeCode39(code){
 if(!validTrace(code))throw Error('授權碼無效。');
 const checksum=ALPHABET[[...code].reduce((sum,char)=>sum+ALPHABET.indexOf(char),0)%43];
 const encoded='*'+code+checksum+'*',bars=[];let position=10;
 for(const [index,char] of [...encoded].entries()){
  const pattern=char==='*'?0x94:WIDTHS[ALPHABET.indexOf(char)];
  for(let element=0;element<9;element++){const width=(pattern&(1<<(8-element)))?2:1;if(element%2===0)bars.push({position,width});position+=width;}
  if(index<encoded.length-1)position++;
 }
 return {bars,units:position+10,encoded};
}
function placement(code,page,length,height,textLength){
 let hash=page|0;for(const char of code)hash=(Math.imul(hash,31)+char.charCodeAt(0))>>>0;
 const fraction=[.22,.38,.62,.78][hash%4];
 return {barcode:Math.max(4,Math.min(height-length-4,height*fraction-length/2)),text:Math.max(4,Math.min(height-textLength-4,height*(fraction<.5?.82:.18)-textLength/2))};
}
export function paintTrace(canvas,code,page,total){
 if(!validTrace(code))throw Error('閱覽授權碼無效，請重新開啟書籍。');
 const scale=canvas.width/595,height=canvas.height,c=canvas.getContext('2d');
 const barcode=encodeCode39(code),unit=Math.min(.35*scale,height*.2/barcode.units);
 const where=placement(code,page,barcode.units*unit,height,0);
 c.save();c.fillStyle='#ccc';
 for(const bar of barcode.bars)c.fillRect(canvas.width-2.5*scale,where.barcode+bar.position*unit,1.3*scale,bar.width*unit);
 c.restore();
}
export function zeroWidthTrace(code){
 if(!validTrace(code))throw Error('授權碼無效。');
 return '\u2063'+Array.from(new TextEncoder().encode(code),byte=>byte.toString(2).padStart(8,'0').replaceAll('0','\u200b').replaceAll('1','\u200c')).join('')+'\u2063';
}
export async function stampPdf(bytes,code,{PDFLib,onProgress=()=>{},maxPages=Infinity,pageOffset=0,hiddenTrace=false}){
 if(!validTrace(code))throw Error('下載授權碼無效，請重新取得下載入口。');
 const {PDFDocument,StandardFonts,rgb,PDFName,PDFString,PDFHexString,PDFOperator}=PDFLib;
 const doc=await PDFDocument.load(bytes,{updateMetadata:false,throwOnInvalidObject:true});
 if(doc.isEncrypted)throw Error('無法加入水印：PDF 已加密。');
 const font=await doc.embedFont(StandardFonts.Helvetica),pages=doc.getPages(),barcode=encodeCode39(code);
 if(pages.length>maxPages)throw Error('PDF 頁數超過免費後端合成上限，請先分冊。');
 for(const [index,page] of pages.entries()){
  const crop=page.getCropBox(),rotation=((page.getRotation().angle%360)+360)%360;
  if(![0,90,180,270].includes(rotation))throw Error('PDF 頁面旋轉角度不支援。');
  const horizontal=rotation===90||rotation===270,height=horizontal?crop.width:crop.height,unit=Math.min(.35,height*.2/barcode.units);
  const where=placement(code,pageOffset+index+1,barcode.units*unit,height,0),color=rgb(.8,.8,.8);
  // Keep every page box and all original content unchanged. The subtle mark
  // occupies only 1.3 pt inside the existing displayed right edge.
  for(const bar of barcode.bars){
   const along=where.barcode+bar.position*unit,thickness=bar.width*unit;
   const box=rotation===0?{x:crop.x+crop.width-2.5,y:crop.y+along,width:1.3,height:thickness}
    :rotation===90?{x:crop.x+along,y:crop.y+crop.height-2.5,width:thickness,height:1.3}
    :rotation===180?{x:crop.x+1.2,y:crop.y+crop.height-along-thickness,width:1.3,height:thickness}
    :{x:crop.x+crop.width-along-thickness,y:crop.y+1.2,width:thickness,height:1.3};
   page.drawRectangle({...box,color});
  }
  page.node.set(PDFName.of('BibliothecaTrace'),PDFString.of(code));
  if(hiddenTrace){
   // Auxiliary extraction marker only. Readers may normalize or discard it;
   // scanned pages do not acquire a genuine OCR text layer from this marker.
   const invisible=zeroWidthTrace(code);
   page.node.set(PDFName.of('BibliothecaInvisibleTrace'),PDFHexString.fromText(invisible));
   for(let n=1;n<=3;n++){
    page.pushOperators(PDFOperator.of('BDC',[PDFName.of('Span'),doc.context.obj({ActualText:PDFHexString.fromText(invisible)})]));
    page.drawText(' ',{x:crop.x+10,y:crop.y+crop.height*n/4,font,size:1,opacity:0});
    page.pushOperators(PDFOperator.of('EMC'));
   }
  }
  if(index%20===0||index===pages.length-1){onProgress(index+1,pages.length);await new Promise(resolve=>setTimeout(resolve,0));}
 }
 const infoRef=doc.context.trailerInfo.Info;
 const info=infoRef?doc.context.lookup(infoRef):doc.context.obj({});
 info.set(PDFName.of('BibliothecaTrace'),PDFString.of(code));info.set(PDFName.of('BibliothecaWatermarkVersion'),PDFString.of('5'));
 if(!infoRef)doc.context.trailerInfo.Info=doc.context.register(info);
 return doc.save({useObjectStreams:false,addDefaultPage:false,updateFieldAppearances:false});
}
