// Use PDF.js's software decoding path consistently across browser engines.
export const imageCompatibility={isImageDecoderSupported:false,isOffscreenCanvasSupported:false};
export async function renderCheckedPage(page,canvas,viewport,OPS){
 let missingImage=false;
 // A separate operator-list request can assign different image IDs from rendering.
 await page.render({canvasContext:canvas.getContext('2d'),viewport,operationsFilter(i,operators){
  if(![OPS.paintImageXObject,OPS.paintImageXObjectRepeat].includes(operators.fnArray[i]))return true;
  const id=operators.argsArray[i]?.[0];if(typeof id!=='string')return true;
  const objects=id.startsWith('g_')?page.commonObjs:page.objs;
  if(!objects?.has(id)||!objects.get(id))missingImage=true;
  return true;
 }}).promise;
 if(missingImage)throw Error('此頁的掃描圖片未能解碼，請按重新載入。');
}
