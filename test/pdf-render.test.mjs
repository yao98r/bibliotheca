import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderCheckedPage,imageCompatibility} from '../public/pdf-render.mjs';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const OPS={paintImageXObject:85,paintImageXObjectRepeat:88},canvas={getContext:()=>({})};
const page=(ids,images,common={})=>({render:()=>({promise:Promise.resolve()}),getOperatorList:async()=>({fnArray:ids.map(()=>85),argsArray:ids.map(id=>[id])}),objs:{has:id=>id in images,get:id=>images[id]},commonObjs:{has:id=>id in common,get:id=>common[id]}});
test('missing decoded image cannot be reported as a successful blank render',async()=>{
 await assert.rejects(renderCheckedPage(page(['img_1'],{img_1:null}),canvas,{},OPS),/掃描圖片未能解碼/);
 await assert.rejects(renderCheckedPage(page(['missing'],{}),canvas,{},OPS),/掃描圖片未能解碼/);
});
test('decoded local and shared images, text-only pages and intentional blank pages can render',async()=>{
 await renderCheckedPage(page(['img_1','g_img'],{img_1:{data:new Uint8Array([1])}},{g_img:{width:1}}),canvas,{},OPS);
 await renderCheckedPage(page([],{}),canvas,{},OPS);
 assert.equal(imageCompatibility.isImageDecoderSupported,false);assert.equal(imageCompatibility.isOffscreenCanvasSupported,false);
});
test('built PDF decoder resources use absolute page-origin URLs even when fetched by a nested worker',async()=>{
 const html=await readFile('dist/viewer.html','utf8'),start=html.indexOf('function pdfOptions('),end=html.indexOf('async function pdfBytes(',start);
 const sandbox={URL,location:{href:'https://books.test/viewer.html?ticket=opaque'}};vm.createContext(sandbox);vm.runInContext(html.slice(start,end),sandbox);
 const options=sandbox.pdfOptions(new Uint8Array());
 for(const [key,directory] of [['wasmUrl','wasm'],['cMapUrl','cmaps'],['standardFontDataUrl','standard_fonts']])assert.equal(options[key],'https://books.test/assets/'+directory+'/');
 assert.equal(new URL(options.wasmUrl+'jbig2.wasm','https://books.test/assets/pdf.worker.min.mjs').href,'https://books.test/assets/wasm/jbig2.wasm');
});
