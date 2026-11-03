import {fail,now,b64,unb64} from './core.mjs';
const encode=new TextEncoder(),decode=new TextDecoder();
export function enhancementService(env){let value;try{value=JSON.parse(env.PDF_ENHANCE_SERVICE||'null');}catch{}if(!value||typeof value.token!=='string'||!value.token||typeof value.apiKey!=='string'||value.apiKey.length<32)return null;let url;try{url=new URL(value.url);}catch{return null;}if(url.origin!=='https://tianyan-pdf-enhance-01.tsea-6580.chatgpt.site')return null;return {url:url.origin,token:value.token,apiKey:value.apiKey};}
async function signingKey(env){if(!env.TOKEN_ENCRYPTION_KEY)fail(503,'增強服務尚未準備完成');const bytes=await crypto.subtle.digest('SHA-256',encode.encode('bibliotheca:tianhe:download:v1:'+env.TOKEN_ENCRYPTION_KEY));return crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function signEnhancementJob(env,user,value){const data={v:1,email:user.email,job:value.job,book:value.book,asset:value.asset,expires:now()+86400};const payload=b64(encode.encode(JSON.stringify(data))),signature=b64(await crypto.subtle.sign('HMAC',await signingKey(env),encode.encode(payload)));return payload+'.'+signature;}
export async function readEnhancementJob(env,user,token){
 if(typeof token!=='string'||token.length>3000||!/^[\w-]+\.[\w-]+$/.test(token))fail(400,'增強工作憑證無效');const [payload,signature]=token.split('.');let data;try{if(!await crypto.subtle.verify('HMAC',await signingKey(env),unb64(signature),encode.encode(payload)))fail(403,'增強工作憑證無效');data=JSON.parse(decode.decode(unb64(payload)));}catch(e){if(e.status)throw e;fail(403,'增強工作憑證無效');}
 if(data.v!==1||data.email!==user.email||!Number.isInteger(data.expires)||data.expires<=now()||!/^[-a-f0-9]{36}$/i.test(data.job||'')||typeof data.book!=='string'||typeof data.asset!=='string')fail(403,'增強工作已過期或不屬於此帳號');return data;
}
export async function enhancementRequest(env,path,{method='GET',body,headers={}}={}){
 const service=enhancementService(env);if(!service)fail(503,'天河增強系統正在準備中，請先下載原始畫質。');
 if(!/^jobs(?:\/[-a-f0-9]{36}(?:\/(?:step|result|file|original))?)?$/.test(path))fail(400,'增強操作入口無效');
 const h=new Headers(headers);h.set('OAI-Sites-Authorization','Bearer '+service.token);h.set('X-Tianhe-Service-Key',service.apiKey);
 let response;try{response=await fetch(service.url+'/api/pdf/'+path,{method,headers:h,body,redirect:'manual'});}catch{fail(503,'天河增強系統暫時無法連線，請稍後繼續。');}
 if(!response.ok){const data=await response.json().catch(()=>({}));fail(response.status===429?429:response.status>=500?503:400,data.error||'增強服務目前無法完成操作，請稍後重試。');}return response;
}
