const enc=new TextEncoder(),dec=new TextDecoder();
export const portalOrigin=value=>typeof value==='string'&&/^https:\/\/tianyan-pdf-enhance-(0[1-9]|10)\.tsea-6580\.chatgpt\.site$/.test(value);
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const unb64=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
async function key(secret){if(typeof secret!=='string'||secret.length<32)throw Error('Portal signing is unavailable');return crypto.subtle.importKey('raw',enc.encode('tianhe:portal:v1:'+secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function signPortalTicket(secret,value){const payload=b64(enc.encode(JSON.stringify({v:1,...value})));return payload+'.'+b64(await crypto.subtle.sign('HMAC',await key(secret),enc.encode(payload)));}
export async function readPortalTicket(secret,token,audience,now=Math.floor(Date.now()/1000)){
 try{if(typeof token!=='string'||token.length>2000||!/^[\w-]+\.[\w-]+$/.test(token))return null;const [payload,signature]=token.split('.');if(!await crypto.subtle.verify('HMAC',await key(secret),unb64(signature),enc.encode(payload)))return null;const data=JSON.parse(dec.decode(unb64(payload)));if(data.v!==1||!portalOrigin(audience)||data.aud!==audience||!Number.isInteger(data.exp)||data.exp<=now||data.exp>now+7200||!Number.isInteger(data.iat)||data.iat>now+30||data.exp-data.iat>7200||!/^[-\w]{43}$/.test(data.session||'')||!/^[-\w]{43}$/.test(data.sub||''))return null;return data;}catch{return null;}
}
