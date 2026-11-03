import {portalOrigin,signPortalTicket,readPortalTicket} from './portal-ticket.mjs';
import {enhancementService} from './enhancement.mjs';
import {one,setting,userFor} from './auth.mjs';
import {fail,now,hash} from './core.mjs';
export async function portalAllowed(env,user){if(user.download_mode!=='download'||(!user.admin&&(await setting(env,'enhance:'+user.email))===false))fail(403,'此帳號尚未開放天河增強權限，請聯絡管理者。');}
export async function createPortalGrant(env,user,audience){const service=enhancementService(env);if(!service)fail(503,'天河增強系統暫時無法使用');if(!portalOrigin(audience))fail(400,'增強系統入口無效');await portalAllowed(env,user);const iat=now();return {token:await signPortalTicket(service.apiKey,{aud:audience,sub:await hash('tianhe:'+user.email),session:user.sessionHash,iat,exp:iat+7200}),url:audience+'/studio'};}
export async function verifyPortalGrant(env,token,audience){const service=enhancementService(env),data=service&&await readPortalTicket(service.apiKey,token,audience);if(!data)fail(403,'天眼授權已失效');const row=await one(env,'SELECT email FROM sessions WHERE hash=? AND expires>?',data.session,now());if(!row)fail(401,'天眼登入已過期，請重新登入');const user=await userFor(env,row.email);await portalAllowed(env,user);const subject=await hash('tianhe:'+user.email);if(subject!==data.sub)fail(403,'天眼授權資料不符');return {subject};}
