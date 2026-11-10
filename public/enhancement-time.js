// Progress weights are not durations; estimates are approximate and reset at each phase.
class EnhancementEstimate {
 constructor(now=Date.now(),resumed=false){this.started=now;this.resumed=resumed;this.samples=[];this.stage='';this.finished=false;}
 update(state,now=Date.now()){
  this.finished=state.stage==='done';
  const progress=Number(state.progress);
  if(!Number.isFinite(progress)||progress<0||progress>100)return;
  const last=this.samples[this.samples.length-1];
  if(state.stage!==this.stage||(last&&progress<last.progress))this.samples=[];
  this.stage=state.stage;
  const previous=this.samples[this.samples.length-1];
  if(!previous||progress>previous.progress)this.samples.push({progress,at:now});
  // Bound the observation window, while retaining stalled time in the rate calculation.
  if(this.samples.length>12)this.samples.shift();
 }
 text(now=Date.now()){
  const elapsed=(this.resumed?'本次已處理 ':'已處理 ')+EnhancementEstimate.duration(now-this.started);
  if(this.finished)return elapsed+' · 處理完成';
  const first=this.samples[0],last=this.samples[this.samples.length-1];
  if(!first||this.samples.length<3||last.at-first.at<10000||last.progress-first.progress<1)return elapsed+' · 預估剩餘時間：估算中…';
  if(now-last.at>60000)return elapsed+' · 進度尚未更新，剩餘時間重新估算中…';
  const remaining=(100-last.progress)*(now-first.at)/(last.progress-first.progress);
  if(remaining<=0)return elapsed+' · 正在完成最後處理…';
  return elapsed+' · 預估剩餘約 '+EnhancementEstimate.duration(remaining*.7,true)+'～'+EnhancementEstimate.duration(remaining*1.4,true);
 }
 static duration(ms,estimate=false){
  const seconds=Math.max(estimate?10:0,Math.ceil(ms/1000/(estimate?10:1))*(estimate?10:1));
  if(seconds<60)return seconds+' 秒';
  const minutes=Math.ceil(seconds/60);
  return minutes<60?minutes+' 分鐘':Math.floor(minutes/60)+' 小時'+(minutes%60?' '+minutes%60+' 分鐘':'');
 }
}
