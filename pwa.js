(()=>{
 const script=document.currentScript;if(!script)return;const base=new URL('./',script.src);
 if(base.origin!==location.origin)return;
 const actions=document.createElement('aside');actions.setAttribute('aria-label','安裝與連線狀態');actions.className='pwa-actions';
 const style=document.createElement('style');style.textContent='.pwa-actions{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:30;max-width:min(340px,calc(100vw - 32px));font:14px/1.6 system-ui,sans-serif}.pwa-actions button{border:1px solid #a4753b;border-radius:8px;background:#25231e;color:#eed7b0;padding:10px 16px;cursor:pointer}.pwa-actions p{background:#fff8e9;color:#302820;border:1px solid #ccb99a;border-radius:8px;padding:12px;margin:8px 0}.pwa-actions [hidden]{display:none!important}';document.head.append(style);
 const install=document.createElement('button');install.type='button';install.textContent='安裝天眼';install.hidden=true;
 const notice=document.createElement('p');notice.setAttribute('role','status');notice.hidden=true;actions.append(notice,install);document.body.append(actions);
 const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 let prompt;addEventListener('beforeinstallprompt',event=>{event.preventDefault();prompt=event;if(!standalone())install.hidden=false;});
 install.onclick=async()=>{if(prompt){const current=prompt;prompt=null;install.hidden=true;try{await current.prompt();const choice=await current.userChoice;if(choice.outcome!=='accepted')install.hidden=false;}catch{install.hidden=false;}}else{notice.hidden=false;notice.textContent='在 Safari 點選「分享」，再選「加入主畫面」，即可安裝天眼書庫。';}};
 if(ios&&!standalone()){install.textContent='加入主畫面';install.hidden=false;}
 addEventListener('appinstalled',()=>{prompt=null;install.hidden=true;});
 function connection(){notice.hidden=navigator.onLine;notice.textContent=navigator.onLine?'':'目前離線。連線後即可開啟書庫；已下載的 PDF 請從裝置開啟。';}
 addEventListener('online',connection);addEventListener('offline',connection);connection();
 if('serviceWorker' in navigator&&isSecureContext){navigator.serviceWorker.register(new URL('sw.js',base),{scope:base.pathname,updateViaCache:'none'}).then(reg=>reg.update()).catch(()=>{});}
})();

