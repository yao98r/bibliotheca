(()=>{
 const script=document.currentScript;if(!script)return;const base=new URL('./',script.src);
 if(base.origin!==location.origin)return;
 const actions=document.createElement('aside');actions.setAttribute('aria-label','安裝與連線狀態');actions.className='pwa-actions';
 const style=document.createElement('style');style.textContent='.pwa-actions{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:30;max-width:min(340px,calc(100vw - 32px));font:14px/1.6 system-ui,sans-serif}.pwa-actions button{border:1px solid #a4753b;border-radius:8px;background:#25231e;color:#eed7b0;padding:10px 16px;cursor:pointer}.pwa-actions p{background:#fff8e9;color:#302820;border:1px solid #ccb99a;border-radius:8px;padding:12px;margin:8px 0}.pwa-actions [hidden]{display:none!important}';document.head.append(style);
 const install=document.createElement('button');install.type='button';install.textContent='加入主畫面';
 const notice=document.createElement('p');notice.setAttribute('role','status');notice.hidden=true;
 const help=document.createElement('p');help.id='pwa-install-help';help.hidden=true;
 install.setAttribute('aria-controls',help.id);install.setAttribute('aria-expanded','false');
 actions.append(notice,help,install);document.body.append(actions);
 const display=matchMedia('(display-mode: standalone)');
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const safari=/Safari/.test(navigator.userAgent)&&!/Chrome|Chromium|Android|Edg|CriOS|FxiOS/.test(navigator.userAgent);
 help.textContent=ios?'點選瀏覽器的「分享」，再選「加入主畫面」。如果清單沒有這一項，請往下滑到「編輯動作」查看。':safari?'在 Safari 的「檔案」選單選擇「加入 Dock」。':'打開瀏覽器選單，尋找「安裝應用程式」或「加入主畫面」。若瀏覽器未提供安裝選項，可將書庫加入書籤。';
 function showHelp(visible){help.hidden=!visible;install.setAttribute('aria-expanded',String(visible));}
 function syncDisplay(){install.hidden=display.matches||navigator.standalone===true;if(install.hidden)showHelp(false);}
 syncDisplay();display.addEventListener?.('change',syncDisplay);
 let prompt;
 addEventListener('beforeinstallprompt',event=>{event.preventDefault();prompt=event;});
 install.onclick=async()=>{
   if(!prompt){showHelp(help.hidden);return;}
   const current=prompt;prompt=null;showHelp(false);install.disabled=true;
   try{await current.prompt();const choice=await current.userChoice;if(choice.outcome==='dismissed')showHelp(true);}
   catch{showHelp(true);}
   finally{install.disabled=false;}
 };
 addEventListener('appinstalled',()=>{prompt=null;install.hidden=true;showHelp(false);});
 function connection(){notice.hidden=navigator.onLine;notice.textContent=navigator.onLine?'':'目前離線。連線後即可開啟書庫；已下載的 PDF 請從裝置開啟。';}
 addEventListener('online',connection);addEventListener('offline',connection);connection();
 if('serviceWorker' in navigator&&isSecureContext){navigator.serviceWorker.register(new URL('sw.js',base),{scope:base.pathname,updateViaCache:'none'}).then(reg=>reg.update()).catch(()=>{});}
})();

