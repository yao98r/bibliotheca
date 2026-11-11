import test from 'node:test';import assert from 'node:assert/strict';
import ZXing from '@zxing/library';
import {encodeCode39} from '../public/trace-watermark.mjs';
import {scanTracePixels,traceQuery} from '../public/trace-image.mjs';
function image({rotate=false,reverse=false,damage=false}={}){
 const barcode=encodeCode39('ABCD-EFGH'),length=barcode.units*3,width=rotate?length:40,height=rotate?40:length,data=new Uint8ClampedArray(width*height*4).fill(255);
 for(const [i,bar] of barcode.bars.entries())if(!damage||i!==20)for(let t=0;t<bar.width*3;t++)for(let across=35;across<38;across++){
  const along=reverse?length-1-(bar.position*3+t):bar.position*3+t,offset=4*(rotate?across*width+along:along*width+across);data[offset]=data[offset+1]=data[offset+2]=204;
 }
 return {data,width,height};
}
test('tiny gray page-edge codes decode in both axes and directions with checked checksum',async()=>{
 for(const rotate of [false,true])for(const reverse of [false,true])assert.equal(await scanTracePixels(image({rotate,reverse}),ZXing),'ABCD-EFGH');
 assert.equal(await scanTracePixels(image({damage:true}),ZXing),null);
 assert.equal(await scanTracePixels({data:new Uint8ClampedArray(100*100*4).fill(255),width:100,height:100},ZXing),null);
});
test('trace queries distinguish original MD5 from normalized trace codes and reject incomplete inputs',()=>{
 assert.equal(traceQuery(' abcd-efgh '),'?code=ABCD-EFGH');assert.equal(traceQuery('ABCDEF0123456789ABCDEF0123456789'),'?md5=abcdef0123456789abcdef0123456789');assert.equal(traceQuery(''),'');
 for(const s of ['abc','a'.repeat(31),'1234-5678'])assert.throws(()=>traceQuery(s),/追蹤碼/);
});
test('subpixel gray bars survive antialiasing without relaxing checksum validation',async()=>{
 const {bars,units}=encodeCode39('ABCD-EFGH'),width=25,height=Math.ceil(units*1.46)+8,data=new Uint8ClampedArray(width*height*4).fill(255);
 for(let y=0;y<height;y++){let coverage=0;for(const bar of bars){const start=4+bar.position*1.46,end=start+bar.width*1.46;coverage+=Math.max(0,Math.min(y+1,end)-Math.max(y,start));}for(let x=19;x<23;x++){const i=4*(y*width+x);data[i]=data[i+1]=data[i+2]=Math.round(255-51*Math.min(1,coverage));}}
 assert.equal(await scanTracePixels({data,width,height},ZXing),'ABCD-EFGH');
});
test('minified browser exception class names do not abort ordinary unsuccessful scan lines',async()=>{
 class Minified extends ZXing.NotFoundException{}
 const decoder={...ZXing,Code39Reader:class{decodeRow(){throw new Minified();}}};
 assert.equal(await scanTracePixels(image(),decoder),null);
});
