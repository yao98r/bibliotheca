(()=>{
 const key='bibliotheca-private-display-v1',aliases=new Map();
 let masked=true;try{masked=localStorage.getItem(key)!=='off';}catch{}
 function alias(email){
  const identity=String(email||'unknown').toLowerCase();
  if(!aliases.has(identity)){const bytes=crypto.getRandomValues(new Uint8Array(6)),tag=Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();aliases.set(identity,{name:tag.slice(0,8),email:tag+'@example.invalid'});}
  return aliases.get(identity);
 }
 window.TianyanPrivacy={
  get masked(){return masked;},
  name:(name,email,reveal=false)=>masked&&!reveal?alias(email).name:(name||''),
  email:(email,reveal=false)=>masked&&!reveal?alias(email).email:(email||''),
  toggle(){masked=!masked;try{localStorage.setItem(key,masked?'on':'off');}catch{}return masked;},
  control(onChange){const button=document.createElement('button');button.id='privacyToggle';button.type='button';button.textContent=masked?'◇':'◆';button.setAttribute('aria-label','切換顯示');button.setAttribute('aria-pressed',String(masked));button.onclick=onChange;return button;}
 };
})();
