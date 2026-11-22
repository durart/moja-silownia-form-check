(function(root){
'use strict';
// Local frame-quality gate. This module does not access the DOM, camera, network or storage.
// A short, still, upright side-on pose is required before sending frames to rep detection.
const SIDE={left:{shoulder:11,hip:23,knee:25,ankle:27,heel:29},
 right:{shoulder:12,hip:24,knee:26,ankle:28,heel:30}};
const clamp=(v,low,high)=>Math.max(low,Math.min(high,v));
const valid=n=>typeof n==='number'&&Number.isFinite(n);
function confidence(p){
 if(!p||!valid(p.x)||!valid(p.y))return 0;
 return clamp(p.visibility??p.presence??1,0,1);
}
function inspect(frame,{side=null,minVisibility=.60}={}){
 const points=frame?.landmarks;
 if(!points)return {ok:false,reason:'Ustaw całą sylwetkę w kadrze',side:null};
 let chosen=side;
 if(!chosen){
  const score=s=>Object.values(SIDE[s]).reduce((sum,i)=>sum+confidence(points[i]),0);
  chosen=score('right')>score('left')?'right':'left';
 }
 const p=Object.fromEntries(Object.entries(SIDE[chosen]).map(([name,i])=>[name,points[i]]));
 if(Object.values(p).some(v=>confidence(v)<minVisibility))
  return {ok:false,reason:'Ustaw całą sylwetkę bokiem do kamery',side:chosen};
 const engine=root.FormCheckEngine;
 const knee=engine.angle(p.hip,p.knee,p.ankle);
 if(!valid(knee))return {ok:false,reason:'Nie można rozpoznać stawów',side:chosen};
 const height=Math.abs(p.shoulder.y-p.heel.y);
 // Make sure the person is large enough in the image but not clipped at either edge.
 if(height<.43)return {ok:false,reason:'Podejdź bliżej lub ustaw telefon bliżej',side:chosen};
 if(p.shoulder.y<.07||p.heel.y>.968||p.heel.y<.12)
  return {ok:false,reason:'Odsuń telefon: głowa i całe stopy muszą być w kadrze',side:chosen};
 if(Object.values(p).some(v=>v.x<.035||v.x>.965||v.y<.03||v.y>.975))
  return {ok:false,reason:'Odsuń telefon, aby zmieścić całą sylwetkę',side:chosen};
 // Both shoulders + hips far apart in the image usually mean a frontal camera view.
 // Require both pairs to avoid reacting to an arm extended towards the camera.
 const sl=points[11],sr=points[12],hl=points[23],hr=points[24];
 if([sl,sr,hl,hr].every(v=>confidence(v)>=minVisibility)){
  const shoulderWidth=Math.abs(sl.x-sr.x)/Math.max(.2,height);
  const hipWidth=Math.abs(hl.x-hr.x)/Math.max(.2,height);
  if(shoulderWidth>.33&&hipWidth>.17)
   return {ok:false,reason:'Obróć się bokiem do telefonu',side:chosen};
 }
 return {ok:true,side:chosen,knee,height,hip:p.hip,heel:p.heel};
}
function createCalibration(options={}){
 const durationMs=options.durationMs??1200,minFrames=options.minFrames??9,
  gapLimitMs=options.gapLimitMs??450,timeoutMs=options.timeoutMs??2400;
 const uprightMin=options.uprightMin??148;
 let ready=false,side=null,first=null,previous=null,base=null,samples=0,badSince=null;
 let standingAngles=[],reference=null,last=null;
 function restart(){ready=false;side=null;first=null;base=null;samples=0;standingAngles=[];badSince=null;reference=null}
 function status(kind,message,progress=0,ok=false){
  return {status:kind,ready,ok,progress:clamp(Math.round(progress),0,100),
    message,side,baseline:reference};
 }
 function ingest(frame){
  const ts=Number(frame?.timestamp);
  if(!valid(ts)||ts<= (previous??-Infinity))
   return status('calibrating','Czekam na poprawny obraz',0);
  const gap=previous===null?0:ts-previous;previous=ts;
  if(gap>gapLimitMs&&!ready)restart();
  const sample=inspect(frame,{side:ready?side:null,
   minVisibility:options.minVisibility??.60});
  if(!ready){
   if(!sample.ok){restart();return status('calibrating',sample.reason,0)}
   if(sample.knee<uprightMin){
    restart();return status('calibrating','Stań prosto i chwilę się nie ruszaj',0);
   }
   if(base&& (Math.abs(sample.hip.x-base.hip.x)>.026||
     Math.abs(sample.hip.y-base.hip.y)>.025||
     Math.abs(sample.knee-base.knee)>13)){
    restart();return status('calibrating','Stań nieruchomo przez chwilę',0);
   }
   if(first===null){first=ts;base=sample}
   samples++;standingAngles.push(sample.knee);
   const pct=Math.min((ts-first)/durationMs,samples/minFrames)*100;
   if(ts-first>=durationMs&&samples>=minFrames){
    ready=true;side=sample.side;
    reference={side,standingKnee:standingAngles.reduce((a,b)=>a+b,0)/standingAngles.length,
     bodyHeight:sample.height};
    return status('ready','Kalibracja gotowa — rozpocznij przysiady',100,true);
   }
   return status('calibrating','Kalibracja: stań nieruchomo bokiem do kamery',pct);
  }
  if(!sample.ok){
   if(badSince===null)badSince=ts;
   if(ts-badSince>timeoutMs){
    restart();return status('calibrating','Utracono pozycję. Skalibruj się ponownie',0);
   }
   return status('reposition',sample.reason,100,false);
  }
  badSince=null;
  last=sample;
  return status('ready','Kalibracja aktywna',100,true);
 }
 function snapshot(){return {ready,side,baseline:reference}}
 return Object.freeze({ingest,snapshot,reset:()=>{restart();previous=null}});
}
// Debounce color changes; an unknown or untrusted reading clears warnings immediately.
function createFeedbackFilter({framesToWarn=3,framesToOk=2}={}){
 const keys=['depth','heels'];let state={depth:'unknown',heels:'unknown'};
 let pending={depth:null,heels:null},counts={depth:0,heels:0};
 function reset(){state={depth:'unknown',heels:'unknown'};pending={depth:null,heels:null};counts={depth:0,heels:0}}
 function update(raw,validFrame=true){
  if(!validFrame){reset();return make()}
  for(const key of keys){
   const next=['ok','warn','error'].includes(raw?.[key])?raw[key]:'unknown';
   if(next==='unknown'){state[key]='unknown';pending[key]=null;counts[key]=0;continue}
   if(next===state[key]){pending[key]=null;counts[key]=0;continue}
   if(pending[key]!==next){pending[key]=next;counts[key]=1}else{counts[key]++}
   if(counts[key]>=(next==='ok'?framesToOk:framesToWarn)){
    state[key]=next;pending[key]=null;counts[key]=0;
   }
  }
  return make();
 }
 function make(){
  const level=keys.some(key=>state[key]==='error')?'error':
   keys.some(key=>state[key]==='warn')?'warn':
   keys.some(key=>state[key]==='ok')?'ok':'unknown';
  const message=state.depth==='error'?'Przysiad może być zbyt płytki':
   state.heels==='error'?'Możliwe oderwanie pięty':
   state.depth==='warn'?'Sprawdź głębokość przysiadu':
   state.heels==='warn'?'Obserwuj stabilność pięty':
   level==='ok'?'Parametr w normie — kontynuuj kontrolowany ruch':
   'Czekam na wiarygodną ocenę…';
  return {...state,level,message};
 }
 return Object.freeze({update,reset,snapshot:make});
}
root.FormCheckQuality=Object.freeze({inspect,createCalibration,createFeedbackFilter});
})(typeof window==='object'?window:globalThis);
