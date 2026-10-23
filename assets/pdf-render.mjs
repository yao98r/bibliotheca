// Use PDF.js's software decoding path consistently across browser engines.
export const imageCompatibility={isImageDecoderSupported:false,isOffscreenCanvasSupported:false};
export async function renderCheckedPage(page,canvas,viewport,OPS){
 await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
 // PDF.js can resolve render() after an image decode failed, leaving a blank page.
 // Check its cached image resources before marking the page as successfully shown.
 const operators=await page.getOperatorList();
 for(let i=0;i<operators.fnArray.length;i++){
  if(![OPS.paintImageXObject,OPS.paintImageXObjectRepeat].includes(operators.fnArray[i]))continue;
  const id=operators.argsArray[i]?.[0];if(typeof id!=='string')continue;
  const objects=id.startsWith('g_')?page.commonObjs:page.objs;
  if(!objects?.has(id)||!objects.get(id))throw Error('此頁的掃描圖片未能解碼，請按重新載入。');
 }
}
