import {validTrace} from './trace-watermark.mjs';
export function traceQuery(value){
 const q=String(value||'').trim();if(!q)return '';
 if(/^[a-f0-9]{32}$/i.test(q))return '?md5='+q.toLowerCase();
 if(validTrace(q.toUpperCase()))return '?code='+q.toUpperCase();
 throw Error('請輸入 XXXX-XXXX 格式的追蹤碼，或 32 位原檔 MD5。');
}
let library;
async function loadDecoder(){
 if(!library)library=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src=new URL('./zxing.min.js',import.meta.url).href;
  script.onload=()=>resolve(globalThis.ZXing);script.onerror=()=>{script.remove();library=null;reject(Error('條碼辨識元件載入失敗，請重試。'));};document.head.append(script);
 });
 return library;
}
// Scan both axes because a page-edge barcode is too thin for normal row sampling.
// shortcut: perspective-warped photos need rectification; never guess a partial code.
export async function scanTracePixels({data,width,height},ZXing){
 if(width*height>40000000||Math.max(width,height)>12000)throw Error('圖片過大，請裁切完整條碼附近後重試。');
 const reader=new ZXing.Code39Reader(true,false),found=new Set();
 for(const vertical of [true,false]){
  const length=vertical?height:width,lines=vertical?width:height,row=new ZXing.BitArray(length);
  for(let line=0;line<lines;line++){
   row.clear();let dark=0;
   for(let at=0;at<length;at++){
    const i=4*(vertical?at*width+line:line*width+at),a=data[i+3]/255;
    const gray=(data[i]*.299+data[i+1]*.587+data[i+2]*.114)*a+255*(1-a);
    if(gray<235){row.set(at);dark++;}
   }
   if(dark>=30&&dark<length*.9){
    for(let direction=0;direction<2;direction++){
     if(direction)row.reverse();
     try{const code=reader.decodeRow(line,row).getText();if(validTrace(code))found.add(code);}catch(e){if(!['NotFoundException','ChecksumException','FormatException'].includes(e.constructor.name))throw e;}
    }
   }
   if(found.size>1)throw Error('圖片包含不同追蹤碼，請裁切單一完整條碼後重試。');
   if(line%64===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
 }
 return [...found][0]||null;
}
export async function extractImageTrace(file){
 if(file.size>25*1024*1024)throw Error('圖片超過 25 MB，請裁切完整條碼附近後重試。');
 if(!/^image\/(png|jpeg|webp|bmp)$/.test(file.type))throw Error('請使用 PNG、JPG、WebP 或 BMP 圖片。');
 const url=URL.createObjectURL(file),img=new Image();
 try{
  img.src=url;await img.decode();
  if(img.naturalWidth*img.naturalHeight>40000000||Math.max(img.naturalWidth,img.naturalHeight)>12000)throw Error('圖片過大，請裁切完整條碼附近後重試。');
  const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);
  return await scanTracePixels(ctx.getImageData(0,0,canvas.width,canvas.height),await loadDecoder());
 }finally{URL.revokeObjectURL(url);}
}
