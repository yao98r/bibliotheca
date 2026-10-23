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
 const originalWidth=canvas.width,height=canvas.height,scale=originalWidth/595,gutter=Math.ceil(24*scale),backup=canvas.ownerDocument.createElement('canvas');
 backup.width=originalWidth;backup.height=height;backup.getContext('2d').drawImage(canvas,0,0);
 const cssWidth=parseFloat(canvas.style.width);canvas.width=originalWidth+gutter;
 if(Number.isFinite(cssWidth))canvas.style.width=cssWidth*canvas.width/originalWidth+'px';
 const c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,canvas.width,height);c.drawImage(backup,0,0);
 const barcode=encodeCode39(code),unit=Math.min(.7*scale,height*.45/barcode.units),barWidth=8*scale,size=5*scale;
 c.save();c.fillStyle='#777';c.font=`${size}px sans-serif`;
 const where=placement(code,page,barcode.units*unit,height,c.measureText(code).width);
 for(const bar of barcode.bars)c.fillRect(originalWidth+5*scale,where.barcode+bar.position*unit,barWidth,bar.width*unit);
 c.translate(originalWidth+19*scale,where.text);c.rotate(Math.PI/2);c.fillText(code,0,0);c.restore();
}
export async function stampPdf(bytes,code,{PDFLib,onProgress=()=>{}}){
 if(!validTrace(code))throw Error('下載授權碼無效，請重新取得下載入口。');
 const {PDFDocument,StandardFonts,rgb,degrees,PDFName,PDFString}=PDFLib;
 const doc=await PDFDocument.load(bytes,{updateMetadata:false,throwOnInvalidObject:true});
 if(doc.isEncrypted)throw Error('無法加入水印：PDF 已加密。');
 const font=await doc.embedFont(StandardFonts.Helvetica),pages=doc.getPages(),barcode=encodeCode39(code);
 for(const [index,page] of pages.entries()){
  const crop=page.getCropBox(),media=page.getMediaBox(),rotation=((page.getRotation().angle%360)+360)%360,gutter=24;
  if(![0,90,180,270].includes(rotation))throw Error('PDF 頁面旋轉角度不支援。');
  const horizontal=rotation===90||rotation===270,height=horizontal?crop.width:crop.height,unit=Math.min(.7,height*.45/barcode.units),size=5;
  const where=placement(code,index+1,barcode.units*unit,height,font.widthOfTextAtSize(code,size));
  const extended={...crop};if(rotation===0)extended.width+=gutter;if(rotation===90)extended.height+=gutter;if(rotation===180){extended.x-=gutter;extended.width+=gutter;}if(rotation===270){extended.y-=gutter;extended.height+=gutter;}
  const left=Math.min(media.x,extended.x),bottom=Math.min(media.y,extended.y),right=Math.max(media.x+media.width,extended.x+extended.width),top=Math.max(media.y+media.height,extended.y+extended.height);
  page.setMediaBox(left,bottom,right-left,top-bottom);page.setCropBox(extended.x,extended.y,extended.width,extended.height);
  // Opaque white gutter prevents existing off-crop content showing through.
  const x=rotation===0?crop.x+crop.width:rotation===180?crop.x-gutter:crop.x;
  const y=rotation===90?crop.y+crop.height:rotation===270?crop.y-gutter:crop.y;
  page.drawRectangle({x,y,width:horizontal?crop.width:gutter,height:horizontal?gutter:crop.height,color:rgb(1,1,1)});
  const color=rgb(.47,.47,.47),side=rotation===0?crop.x+crop.width:rotation===180?crop.x-gutter:rotation===90?crop.y+crop.height:crop.y-gutter;
  for(const bar of barcode.bars)page.drawRectangle(horizontal?{x:crop.x+where.barcode+bar.position*unit,y:side+5,width:bar.width*unit,height:8,color}:{x:side+5,y:crop.y+where.barcode+bar.position*unit,width:8,height:bar.width*unit,color});
  page.drawText(code,horizontal?{x:crop.x+where.text,y:side+19,font,size,color}:{x:side+19,y:crop.y+where.text,font,size,color,rotate:degrees(90)});
  page.node.set(PDFName.of('BibliothecaTrace'),PDFString.of(code));
  if(index%20===0||index===pages.length-1){onProgress(index+1,pages.length);await new Promise(resolve=>setTimeout(resolve,0));}
 }
 const infoRef=doc.context.trailerInfo.Info;
 const info=infoRef?doc.context.lookup(infoRef):doc.context.obj({});
 info.set(PDFName.of('BibliothecaTrace'),PDFString.of(code));info.set(PDFName.of('BibliothecaWatermarkVersion'),PDFString.of('4'));
 if(!infoRef)doc.context.trailerInfo.Info=doc.context.register(info);
 return doc.save({useObjectStreams:false,addDefaultPage:false,updateFieldAppearances:false});
}
