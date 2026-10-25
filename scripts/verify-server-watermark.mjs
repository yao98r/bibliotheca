import * as PDFLib from 'pdf-lib';
import {writeFile} from 'node:fs/promises';
import SparkMD5 from 'spark-md5';
import {compileWatermarkedPdf} from '../public/pdf-watermark-builder.mjs';
import {validateWatermarkTemplate,personalizeWatermark,composeWatermarkedPdf} from '../src/backend-watermark.mjs';
const doc=await PDFLib.PDFDocument.create({updateMetadata:false});
for(let n=1;n<=2;n++){
 const page=doc.addPage([595,842]);
 page.drawText('Server watermark verification',{x:42,y:785,size:23});
 page.drawText('Synthetic test document - no library source files',{x:42,y:755,size:12});
 for(let line=0;line<16;line++)page.drawText(`Page ${n}, paragraph ${line+1}: original document content stays readable.`,{x:42,y:705-line*33,size:11});
 page.drawRectangle({x:42,y:80,width:480,height:70,borderColor:PDFLib.rgb(.2,.4,.6),borderWidth:1});
 page.drawText('A subtle edge barcode is embedded in this PDF.',{x:52,y:122,size:11});
 page.drawText('Original page size and text placement are unchanged.',{x:52,y:102,size:11});
}
const source=await doc.save(),timings=[],asset={size:source.length,md5:SparkMD5.ArrayBuffer.hash(source.buffer)};
const plan=await compileWatermarkedPdf(source,asset,{PDFLib,SparkMD5}),template=validateWatermarkTemplate(plan,asset);
let marked;
for(let n=0;n<4;n++){
 const cpu=process.cpuUsage(),start=performance.now();
 const metadata=personalizeWatermark(template,'ABCD-EFGH','1'.repeat(64));
 marked=new Uint8Array(await new Response(composeWatermarkedPdf(new Response(source).body,asset,template,metadata)).arrayBuffer());
 const used=process.cpuUsage(cpu);timings.push({wallMs:performance.now()-start,cpuMs:(used.user+used.system)/1000});
}
await writeFile(process.argv[2],marked);
console.log(JSON.stringify({version:'server-v2',inputBytes:source.length,outputBytes:marked.length,pages:2,metadataBytes:template.metadata.length,nodeMeasurements:timings,warning:'Local Node CPU measurements do not measure Cloudflare production CPU.'}));
