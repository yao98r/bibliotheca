const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function authErrorPage(status,message,home){
 const title=status===403?'目前無法進入書庫':'這次登入未完成';
 const help=status===403?'書庫目前僅開放管理者指定的帳號。若你尚未獲准，請聯絡管理者加入使用名單；也可以返回首頁，選擇已有權限的 Google 帳號。':'請回到書庫首頁重新登入，並在同一個瀏覽器完成 Google 驗證。';
 return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Bibliotheca</title><style>body{margin:0;background:#f4f1e9;color:#20382e;font:18px/1.8 system-ui,sans-serif}main{max-width:580px;margin:12vh auto;padding:36px;background:#fffdf7;border:1px solid #d8d4c6;border-radius:18px}small{letter-spacing:.15em}h1{font-size:30px;line-height:1.4}p{color:#4d5d53}a{display:inline-block;background:#244f3a;color:white;padding:12px 24px;border-radius:8px;text-decoration:none}@media(max-width:640px){main{margin:8vh 16px;padding:24px}}</style></head><body><main><small>BIBLIOTHECA</small><h1>${title}</h1><p>${escape(message)}</p><p>${help}</p><a href="${escape(home)}">返回書庫・重新選擇帳號</a></main></body></html>`;
}
