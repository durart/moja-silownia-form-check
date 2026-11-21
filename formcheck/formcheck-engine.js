(function(root){
'use strict';
// Pure, deterministic landmark analysis. No DOM, camera, network or storage access.
const JOINTS={left:{shoulder:11,hip:23,knee:25,ankle:27,heel:29},right:{shoulder:12,hip:24,knee:26,ankle:28,heel:30}};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
function angle(a,b,c){
 if(!a||!b||!c)return null;
 const ax=a.x-b.x,ay=a.y-b.y,cx=c.x-b.x,cy=c.y-b.y;
 const n=Math.hypot(ax,ay)*Math.hypot(cx,cy);
 return n<1e-7?null:Math.acos(clamp((ax*cx+ay*cy)/n,-1,1))*180/Math.PI;
}
function reliability(p){return !p||!finite(p.x)||!finite(p.y)?0:clamp(p.visibility??p.presence??1,0,1)}
function landmarksSide(points,side){
 const index=JOINTS[side],out={};let sum=0;
 for(const [name,i] of Object.entries(index)){out[name]=points?.[i];sum+=reliability(out[name])}
 return {points:out,visibility:sum/5,side};
}
function makeConfig(raw={}){
 const t=raw.repThresholds||{};
 return {minVisibility:raw.minVisibility??.60,ema:raw.ema??.48,
  top:t.top??158,bottom:t.bottom??126,minRepMs:t.minRepMs??1200,
  depthOk:raw.depthOk??95,depthWarn:raw.depthWarn??110,
  heelLimit:raw.heelLimit??.02,heelWarn:raw.heelWarn??.035};
}
function createSession(rawConfig={}){
 const config=makeConfig(rawConfig);let state='WAIT_TOP',side=null,smooth=null,cycle=null,
  lastTimestamp=-Infinity,lastAngle=null,lastMotionAt=null,invalidSince=null,paused=false,
  frames=0,validFrames=0,visibilitySum=0,seen=0,startedAt=null,reps=[];
 function resetMotion(){state='WAIT_TOP';cycle=null;smooth=null;lastAngle=null;side=null}
 function ingest(frame){
  const timestamp=Number(frame?.timestamp);
  if(!finite(timestamp)||timestamp<=lastTimestamp)return snapshot('Nieprawidłowy znacznik czasu');
  const gap=timestamp-lastTimestamp;
  lastTimestamp=timestamp;frames++;
  if(startedAt===null)startedAt=timestamp;
  if(gap>1500&&cycle)resetMotion();
  let chosen=landmarksSide(frame?.landmarks,side||'left');
  if(!side){const right=landmarksSide(frame?.landmarks,'right');if(right.visibility>chosen.visibility)chosen=right}
  const pts=chosen.points,confidence=chosen.visibility;
  const needed=Object.values(pts).every(p=>reliability(p)>=config.minVisibility);
  if(!needed){
   if(invalidSince===null)invalidSince=timestamp;
   if(timestamp-invalidSince>=3000){paused=true;resetMotion()}
   return snapshot(paused?'Nie widać całej sylwetki — pauza':'Ustaw całą sylwetkę w kadrze',null,confidence);
  }
  // A missing frame cannot be used for the motion state machine.
  invalidSince=null;
  if(paused){paused=false;resetMotion()}
  validFrames++;visibilitySum+=confidence;
  side=chosen.side;
  const fresh={};
  for(const [name,p] of Object.entries(pts)){
   const prev=smooth?.[name],alpha=config.ema;
   fresh[name]=prev?{x:alpha*p.x+(1-alpha)*prev.x,y:alpha*p.y+(1-alpha)*prev.y}: {x:p.x,y:p.y};
  }
  smooth=fresh;
  const knee=angle(fresh.hip,fresh.knee,fresh.ankle);
  if(knee===null)return snapshot('Nie można obliczyć kąta kolana');
  const height=Math.max(.15,Math.abs(fresh.shoulder.y-fresh.ankle.y));
  if(lastAngle===null||Math.abs(knee-lastAngle)>2.3)lastMotionAt=timestamp;
  lastAngle=knee;
  let event=null;
  if(state==='WAIT_TOP'){
   if(knee>=config.top-3){state='TOP';}
  }else if(state==='TOP'){
   if(knee<config.top-12){
    state='DOWN';cycle={started:timestamp,downEnd:null,minAngle:knee,
     baseHeelY:fresh.heel.y,height,maxHeelLift:0,minimumFrames:1,
     bottomSeen:false,downMs:null,upMs:null};
   }
  }else if(cycle){
   cycle.minAngle=Math.min(cycle.minAngle,knee);
   cycle.minimumFrames++;
   cycle.maxHeelLift=Math.max(cycle.maxHeelLift,Math.max(0,cycle.baseHeelY-fresh.heel.y)/cycle.height);
   if(state==='DOWN'&&knee<=config.bottom){state='BOTTOM';cycle.bottomSeen=true;cycle.downEnd=timestamp}
   else if(state==='BOTTOM'&&knee>=config.bottom+12){state='UP'}
   else if(state==='UP'){
    if(knee<=config.bottom){state='BOTTOM'}
    else if(knee>=config.top){
     if(timestamp-cycle.started>=config.minRepMs && cycle.bottomSeen && cycle.minimumFrames>=6){
      const depth=cycle.minAngle<=config.depthOk?100:cycle.minAngle<=config.depthWarn?50:0;
      const heels=cycle.maxHeelLift<=config.heelLimit?100:cycle.maxHeelLift<=config.heelWarn?50:0;
      const failed=[];
      if(depth<100)failed.push('depth');if(heels<100)failed.push('heels');
      const score=Math.round((2*depth+heels)/3);
      const rep={n:reps.length+1,score,failed,values:{depth:Math.round(cycle.minAngle*10)/10,
        heels:Math.round(cycle.maxHeelLift*10000)/10000},
       tempo:{down:cycle.downEnd===null?null:cycle.downEnd-cycle.started,
        up:cycle.downEnd===null?null:timestamp-cycle.downEnd}};
      reps.push(rep);event={type:'rep',rep};
     }
     cycle=null;state='TOP';
    }
   }
   if(cycle&&timestamp-cycle.started>12000){resetMotion()}
  }
  return snapshot(event?'Powtórzenie '+reps.length:state==='WAIT_TOP'?'Wyprostuj nogi, aby rozpocząć':
   state==='TOP'?'Gotowe — rozpocznij przysiad':state==='DOWN'?'Schodź w dół':
   state==='BOTTOM'?'Góra!':'Wracaj do wyprostu',knee,confidence,event);
 }
 function snapshot(message='',kneeAngle=null,visibility=0,event=null){
  return {state,paused,message,kneeAngle,visibility,repsDetected:reps.length,
   lastRep:reps.at(-1)||null,event,side,frames,validFrames,
   idleMs:lastMotionAt===null?0:Math.max(0,lastTimestamp-lastMotionAt)};
 }
 function finish(){
  const score=reps.length?Math.round(reps.reduce((v,r)=>v+r.score,0)/reps.length):null;
  const good=reps.filter(r=>r.score===100).length;
  const checkpoints=['depth','heels'].map(id=>{
   const entries=reps.map(r=>r.values[id]);
   const passes=reps.filter(r=>!r.failed.includes(id)).length;
   return {id,passRate:reps.length?Math.round(passes/reps.length*100):null,
    avgValue:entries.length?entries.reduce((a,b)=>a+b,0)/entries.length:null,
    worstValue:entries.length?(id==='depth'?Math.max(...entries):Math.max(...entries)):null,
    assessedReps:reps.length};
  });
  const counts={depth:0,heels:0};
  for(const rep of reps)for(const id of rep.failed)counts[id]++;
  const mainIssue=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
  return {durationMs:startedAt===null?0:Math.max(0,lastTimestamp-startedAt),
   repsDetected:reps.length,repsGood:good,score,
   quality:{validFrameRatio:frames?validFrames/frames:0,
    meanVisibility:validFrames?visibilitySum/validFrames:0,uncertain:!reps.length||validFrames<12},
   checkpoints,reps:reps.slice(0,30),mainIssue:mainIssue?.[1]?mainIssue[0]:null};
 }
 return Object.freeze({ingest,finish,snapshot:()=>snapshot(),config});
}
root.FormCheckEngine=Object.freeze({angle,reliability,landmarksSide,createSession,makeConfig});
})(typeof window==='object'?window:globalThis);
