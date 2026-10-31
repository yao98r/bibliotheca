import {readFile,writeFile} from 'node:fs/promises';
import * as PDFLib from 'pdf-lib';
import SparkMD5 from 'spark-md5';
import {preparePdf} from '../public/pdf-index-builder.mjs';
import {personalizeIndexedPage} from '../src/page-watermark.mjs';
const directory=new URL('../../../work/security-implementation-2026-10-31/',import.meta.url);
const source=new Uint8Array(await readFile(new URL('page-source.pdf',directory))),expected={size:source.length,md5:SparkMD5.ArrayBuffer.hash(source.buffer)};
const builder=await preparePdf(source,expected,{PDFLib,SparkMD5,pageWatermark:true}),output=await PDFLib.PDFDocument.create({updateMetadata:false});
const timings=[];
for(let n=1;n<=builder.header.pageCount;n++){
 const entry=await builder.page(n),chunks=entry.parts.map(p=>typeof p==='string'?new Uint8Array(Buffer.from(p,'base64')):source.slice(p[0],p[0]+p[1]));
 let bytes;for(let i=0;i<40;i++){const start=performance.now();bytes=personalizeIndexedPage(entry,chunks,'ABCD-EFGH');timings.push(performance.now()-start);}
 const document=await PDFLib.PDFDocument.load(bytes,{updateMetadata:false}),[page]=await output.copyPages(document,[0]);output.addPage(page);
}
await writeFile(new URL('page-stamped.pdf',directory),await output.save({useObjectStreams:false}));
timings.sort((a,b)=>a-b);const result={pages:output.getPageCount(),samples:timings.length,nodeWallMsP50:timings[Math.floor(timings.length*.5)],nodeWallMsP95:timings[Math.floor(timings.length*.95)],productionCpuVerified:false,sourceObjectsStillExtractable:true,productionIndexChanges:0};
await writeFile(new URL('page-prototype-result.json',directory),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
