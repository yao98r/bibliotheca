// The administrator compiles a PDF once. Only these fixed-width slots are
// personalized by the backend; no PDF parser or font library runs in Workers.
export const WATERMARK_VERSION=2;
export const CODE_PLACEHOLDER='ZZZZ-ZZZZ';
export const PROOF_PLACEHOLDER='F'.repeat(64);
export const BARCODE_BYTES=4096;
export const BARCODE_PLACEHOLDER='%BIBLIOTHECA_BARCODE_V2\n'.padEnd(BARCODE_BYTES,' ');
export const MAX_TEMPLATE_BYTES=4*1024*1024;
export const MAX_TEMPLATE_PAYLOAD=700000;
export function invisibleHex(code){
 let value='FEFF2063';
 for(const char of code)for(const bit of char.charCodeAt(0).toString(2).padStart(8,'0'))value+=bit==='0'?'200B':'200C';
 return value+'2063';
}
export function barcodeCommands(code,encode){
 if(!/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code))throw Error('授權碼無效');
 const {bars}=encode(code);
 const commands='q\n0.8 g\n'+bars.map(b=>`0 ${(b.position*.35).toFixed(2)} 1.3 ${(b.width*.35).toFixed(2)} re f\n`).join('')+'Q\n';
 if(commands.length>BARCODE_BYTES)throw Error('水印超過預留長度');
 return commands.padEnd(BARCODE_BYTES,' ');
}
