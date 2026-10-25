import {fail} from './core.mjs';
export function createDriveTokenCache(clock=Date.now){
 const entries=new Map();
 return async function accessToken(key,refresh){
  let entry=entries.get(key);
  if(entry?.pending)return entry.pending;
  if(entry&&entry.expires>clock())return entry.token;
  entries.delete(key);while(entries.size>=2)entries.delete(entries.keys().next().value);
  entry={expires:0,token:null,pending:null};entries.set(key,entry);
  entry.pending=(async()=>{
   const result=await refresh();if(typeof result.access_token!=='string'||!result.access_token)fail(502,'Google 未提供讀取憑證，請重新連線');
   const lifetime=Number(result.expires_in);entry.token=result.access_token;
   entry.expires=Number.isFinite(lifetime)&&lifetime>60?clock()+(Math.min(lifetime,3600)-60)*1000:0;
   return entry.token;
  })();
  try{return await entry.pending;}catch(error){if(entries.get(key)===entry)entries.delete(key);throw error;}
  finally{entry.pending=null;if(entry.expires<=clock()&&entries.get(key)===entry)entries.delete(key);}
 };
}
