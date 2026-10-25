export class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
export const fail=(status,message)=>{throw new HttpError(status,message);};
export const now=()=>Math.floor(Date.now()/1000);
export const iso=()=>new Date().toISOString();
export const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
export function unb64(s){const text=atob(s.replaceAll('-','+').replaceAll('_','/')),bytes=new Uint8Array(text.length);for(let i=0;i<text.length;i++)bytes[i]=text.charCodeAt(i);return bytes;}
export const random=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
export const hash=async s=>b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
export const day=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
export const isDownload=a=>['download_request','answer_download'].includes(a);
export const validAction=a=>['open','answer_open','download_request','answer_download'].includes(a);
export const scopeAllows=(scope,category)=>scope==='both'||(scope==='ref'&&category==='參考書')||(scope==='mock'&&category==='模擬考題本');
export const ranks=[{grade:'A',roman:'I',latin:'Textor Fati',title:'織命者'},{grade:'B',roman:'II',latin:'Vates',title:'神諭者'},{grade:'C',roman:'III',latin:'Praevidens',title:'先見者'},{grade:'D',roman:'IV',latin:'Augur',title:'解兆者'},{grade:'E',roman:'V',latin:'Quaerens Oraculum',title:'求諭者'}];
export function permission(user,policy,owner){
 if(owner) return {...user,owner:true,admin:true,active:true,access_scope:'both',download_mode:'download',view_enabled:1,reading_mode:'fast',daily_download_limit:null};
 const active=!user.blocked&&(!!user.individual||policy.enabled);
 if(user.individual) return {...user,active,owner:false,admin:false};
 return {...user,level:'E',active,owner:false,admin:false,inherited:true,access_scope:policy.scope,download_mode:policy.defaultTier==='download'?'download':'view',view_enabled:policy.defaultTier==='catalog'?0:1,reading_mode:'protected',daily_download_limit:policy.dailyLimit};
}
export function validateProfile(b){
 if(!['A','B','C','D','E'].includes(b.level)||!['ref','mock','both'].includes(b.scope)||!['view','download'].includes(b.downloadMode)||typeof b.viewEnabled!=='boolean'||!['protected','fast'].includes(b.readingMode))fail(400,'權限設定無效');
 if(b.dailyLimit!==null&&(!Number.isInteger(b.dailyLimit)||b.dailyLimit<0||b.dailyLimit>10000))fail(400,'每日額度必須是 0–10000 或留空');
 if(typeof b.displayName!=='string'||b.displayName.length>40)fail(400,'顯示名稱過長');
 if(b.readingMode==='fast'&&(!b.viewEnabled||b.downloadMode!=='download'))fail(400,'快速翻閱需要閱讀與下載權限');
 return b;
}
export async function bounded(response,max){
 const reader=response.body?.getReader();if(!reader)fail(502,'來源沒有內容');
 const chunks=[];let size=0;
 try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)fail(413,'內容超過可處理的大小');chunks.push(value);}}catch(e){await reader.cancel();throw e;}
 const out=new Uint8Array(size);let offset=0;for(const b of chunks){out.set(b,offset);offset+=b.length;}return out;
}
export async function seal(value,keyText){
 const key=await crypto.subtle.importKey('raw',unb64(keyText),'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 return b64(iv)+'.'+b64(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(value)));
}
export async function unseal(value,keyText){
 const [iv,data]=value.split('.');const key=await crypto.subtle.importKey('raw',unb64(keyText),'AES-GCM',false,['decrypt']);
 return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv)},key,unb64(data)));
}
export function traceCode(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const bytes=crypto.getRandomValues(new Uint8Array(8));const s=Array.from(bytes,b=>chars[b%32]).join('');return s.slice(0,4)+'-'+s.slice(4);}
export function replaceTrace(bytes,code){
 // The existing page index uses an octal-escaped hyphen to keep PDF offsets stable.
 const a=new TextEncoder().encode('ZZZZ\\055ZZZZ'),b=new TextEncoder().encode(code.replace('-','\\055'));
 const out=bytes.slice();outer:for(let i=0;i<=out.length-a.length;i++){for(let j=0;j<a.length;j++)if(out[i+j]!==a[j])continue outer;out.set(b,i);break;}return out;
}
