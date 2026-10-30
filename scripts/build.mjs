import {mkdir,readFile,writeFile,cp,rm} from 'node:fs/promises';
import vm from 'node:vm';
const github=process.argv.includes('--github');
const output=github?'dist-pages':'dist';
const backend='https://bibliotheca-backend.bibliotheca-cloudflare.workers.dev';
const pwaHead='<link rel="manifest" href="./manifest.webmanifest"><link rel="apple-touch-icon" href="./icons/apple-touch-icon.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="天眼書庫"><script src="./pwa.js" defer></script>';
await mkdir(output+'/assets',{recursive:true});
for(const name of ['index','files','go','viewer','access','download']) {
 let html=await readFile(`${name}.html`,'utf8');
 html=html.replaceAll("const BACKEND='https://tianyan-books.yao98r.chatgpt.site';",github?`const BACKEND='${backend}';`:'const BACKEND=location.origin;')
   .replaceAll('https://tianyan-books.yao98r.chatgpt.site/assets/','./assets/')
   .replaceAll("'bibliotheca-session-v1'","'bibliotheca-cloudflare-session-v1'");
 const start=html.indexOf('async function startLogin('),end=html.indexOf('async function savePdf(',start);
 if(start<0||end<0)throw Error('Missing login boundary in '+name);
 html=html.slice(0,start)+`async function startLogin(onSuccess,onError){
 try {
 const encode=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
 const state=encode(crypto.getRandomValues(new Uint8Array(32))),verifier=encode(crypto.getRandomValues(new Uint8Array(48))),challenge=encode(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
 localStorage.setItem(PENDING_LOGIN_KEY+state,JSON.stringify({state,verifier,expiresAt:Date.now()+600000}));
 const returnTo=new URL('./',location.href).href;
 const after=new URLSearchParams(location.search).get('return');if(after)sessionStorage.setItem('bibliotheca-after-login',after);
 location.href=BACKEND+'/auth?'+new URLSearchParams({state,challenge,return_to:returnTo});
 }catch(e){onError(e);}
}
`+html.slice(end);
 html=html.replace('await completeRedirectLogin();','if(await completeRedirectLogin()){const after=sessionStorage.getItem("bibliotheca-after-login");sessionStorage.removeItem("bibliotheca-after-login");if(after){const u=new URL(location.href);u.searchParams.set("return",after);history.replaceState(null,"",u.href);if(returnAfterLogin())return;}}');
 html=html.replace('const blob=await response.blob();',`const blob=await response.blob();const expected=response.headers.get('X-PDF-Bytes');if(expected!==null&&blob.size!==Number(expected))throw Error('PDF 傳輸中斷，請重新下載。');`);
 html=html.replace('return new Uint8Array(await response.arrayBuffer());',`const bytes=new Uint8Array(await response.arrayBuffer());const expected=response.headers.get('X-PDF-Bytes');if(expected!==null&&bytes.length!==Number(expected))throw Error('PDF 傳輸中斷，請重新載入。');return bytes;`);
 // PDF.js 6 releases document resources through the loading task.
 html=html.replaceAll('fastDoc.destroy()','fastDoc.loadingTask.destroy()').replaceAll('doc.destroy()','doc.loadingTask.destroy()');
 // Keep navigation on the frontend origin where the bearer session is stored.
 const openStart=html.indexOf('async function recordOpen('),openEnd=html.indexOf('async function showFiles()',openStart);
 if(openStart>=0&&openEnd>openStart)html=html.slice(0,openStart)+`async function recordOpen(book,action,button,asset){status('');button.disabled=true;try{const answer=action.startsWith('answer');asset=asset||(answer?book.answerAsset:book.asset);const bookId=answer?(book.answerBookId||book.id):book.id;const r=await api('/api/event',{id:crypto.randomUUID(),csrf:me.csrf,action,bookId,...(asset?{asset}:{})});location.href=r.url;}catch(e){status(e.message);}finally{button.disabled=false;}}\n`+html.slice(openEnd);
 html=html.replace('bookId:context.bookId,action:context.action','bookId:context.bookId,action:context.action,...(context.asset?{asset:context.asset}:{})');
 html=html.replace(/\$\('download'\)\.onclick=async\(\)=>\{const popup=window\.open[\s\S]*?finally\{\$\('download'\)\.disabled=false;\}\};/,`$('download').onclick=async()=>{$('download').disabled=true;try{const result=await api('/api/viewer/download',{csrf:me.csrf,ticket:params.get('ticket')});location.href=result.url;}catch(e){$('status').textContent=e.message;}finally{$('download').disabled=false;}};`);
 if(['index','files','go'].includes(name)) html=html.replace('<footer>',`<p><a href="${backend}/manage.html">管理者：Drive 連線與書目同步</a></p><footer>`);
 html=html.replace('</head>',pwaHead+'</head>');
 for(const match of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]?.includes('module')?'(async()=>{'+match[2]+'})':match[2],{filename:name+'.html'});
 await writeFile(`${output}/${name}.html`,html);
}
if(!github){
 const manage=await readFile('public/manage.html','utf8');for(const match of manage.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1],{filename:'manage.html'});
 await writeFile(output+'/manage.html',manage.replace('</head>',pwaHead+'</head>'));
 await cp('public/pdf-index-worker.js',output+'/assets/pdf-index-worker.js');
 await cp('public/pdf-index-builder.mjs',output+'/assets/pdf-index-builder.mjs');
 for(const file of ['pdf-watermark-worker.js','pdf-watermark-builder.mjs','pdf-watermark-format.mjs'])await cp('public/'+file,output+'/assets/'+file);
 await cp('node_modules/pdf-lib/dist/pdf-lib.min.js',output+'/assets/pdf-lib.min.js');
 await cp('node_modules/spark-md5/spark-md5.min.js',output+'/assets/spark-md5.min.js');
 await cp('node_modules/pdf-lib/LICENSE.md',output+'/assets/PDF-LIB-LICENSE');
 await cp('node_modules/spark-md5/LICENSE',output+'/assets/SPARK-MD5-LICENSE');
}
await cp('node_modules/pdfjs-dist/build/pdf.min.mjs',output+'/assets/pdf.min.mjs');
await rm(output+'/assets/tsea-mark.png',{force:true});
await cp('public/trace-watermark.mjs',output+'/assets/trace-watermark.mjs');
await cp('public/pdf-render.mjs',output+'/assets/pdf-render.mjs');
await cp('node_modules/pdf-lib/dist/pdf-lib.esm.min.js',output+'/assets/pdf-lib.esm.min.js');
await cp('node_modules/pdf-lib/LICENSE.md',output+'/assets/PDF-LIB-LICENSE');
await cp('node_modules/pdfjs-dist/build/pdf.worker.min.mjs',output+'/assets/pdf.worker.min.mjs');
for(const dir of ['cmaps','standard_fonts','wasm']) await cp(`node_modules/pdfjs-dist/${dir}`,`${output}/assets/${dir}`,{recursive:true});
await cp('PDFJS-LICENSE',output+'/PDFJS-LICENSE');
for(const file of ['manifest.webmanifest','sw.js','pwa.js','offline.html'])await cp('public/'+file,output+'/'+file);
await cp('public/icons',output+'/icons',{recursive:true});
await writeFile(output+'/.nojekyll','');
console.log('Built '+output+' with local PDF.js assets; inline scripts parsed successfully.');
