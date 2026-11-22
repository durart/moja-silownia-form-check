(function(root){
'use strict';
const $=id=>document.getElementById(id);
const engineAPI=root.FormCheckEngine,lib=root.FormCheckLibrary,poseAPI=root.FormCheckPose,qualityAPI=root.FormCheckQuality;
const connections=[[11,23],[23,25],[25,27],[27,29],[12,24],[24,26],[26,28],[28,30],[11,12],[23,24],[11,13],[12,14]];
const palette=Object.freeze({ok:'#48f0a5',warn:'#ffcd66',error:'#ff4f64',unknown:'#4be3f1'});
let camera=null,engine=null,calibration=null,feedbackFilter=null,exerciseConfig=null,calibratedOnce=false,raf=0,playing=false,stopRequested=false,openResolver=null;
let lastInference=0,lastVideoTime=-1,frameTimes=[],lastDrawn=null,started=false,delegate='';
const video=$('fcVideo'),overlay=$('fcOverlay'),canvas=$('fcCanvas'),ctx=canvas.getContext('2d');
const initial=$('fcInitial'),live=$('fcLive'),result=$('fcResult'),stage=$('fcStage');
const debug=new URLSearchParams(location.search).get('fcdebug')==='1';
$('fcDebug').hidden=!debug;
function secure(){return !!(root.isSecureContext&&navigator.mediaDevices?.getUserMedia&&root.WebAssembly)}
function text(id,value){$(id).textContent=String(value)}
function showScreen(which){initial.hidden=which!=='initial';live.hidden=which!=='live';result.hidden=which!=='result'}
function setStatus(msg){text('fcStatus',msg);text('fcLiveStatus',msg)}
function progress(data){
 text('fcStatus',data.stage);
 const bar=$('fcProgress');
 if(data.total&&data.done!=null){
  bar.removeAttribute('value');bar.value=Math.min(100,Math.floor(data.done/data.total*100));
  text('fcTransfer',Math.round(data.done/1048576*10)/10+' / '+Math.round(data.total/1048576*10)/10+' MB');
 }else{bar.removeAttribute('value');text('fcTransfer','Pobieranie / uruchamianie…')}
}
function paintSkeleton(landmarks,info,{width=640,height=960}={}){
 const vw=width,vh=height;
 if(canvas.width!==vw||canvas.height!==vh){canvas.width=vw;canvas.height=vh}
 ctx.clearRect(0,0,vw,vh);
 if(!landmarks)return;
 const side=info?.side==='right'?'right':'left';
 const knee=side==='right'?26:25,hip=side==='right'?24:23;
 const ankle=side==='right'?28:27,heel=side==='right'?30:29;
 const feedback=info?.feedback||{depth:'unknown',heels:'unknown'};
 function connectionColor(a,b){
  if((a===hip&&b===knee)||(a===knee&&b===ankle))return palette[feedback.depth];
  if(a===ankle&&b===heel)return palette[feedback.heels];
  return '#46f1d0';
 }
 ctx.lineCap='round';
 for(const [a,b] of connections){
  const p=landmarks[a],q=landmarks[b];
  if(!p||!q||(p.visibility??1)<.6||(q.visibility??1)<.6)continue;
  const monitored=(a===hip&&b===knee)||(a===knee&&b===ankle)||(a===ankle&&b===heel);
  ctx.lineWidth=Math.max(monitored?5:3,vw/(monitored?105:170));
  ctx.strokeStyle=connectionColor(a,b);
  ctx.beginPath();ctx.moveTo(p.x*vw,p.y*vh);ctx.lineTo(q.x*vw,q.y*vh);ctx.stroke();
 }
 for(const n of [11,12,23,24,25,26,27,28,29,30]){
  const p=landmarks[n];if(!p||(p.visibility??1)<.6)continue;
  let fill='#35e6fa';
  if(n===knee)fill=palette[feedback.depth];
  if(n===ankle||n===heel)fill=palette[feedback.heels];
  ctx.beginPath();ctx.fillStyle=fill;
  ctx.arc(p.x*vw,p.y*vh,Math.max(n===knee||n===heel?6:4,vw/100),0,Math.PI*2);ctx.fill();
 }
}
function liveBadge(id,label,state){
 const el=$(id);el.dataset.state=state;
 const symbols={ok:'✓',warn:'!',error:'!',unknown:'–'};
 el.textContent=symbols[state]+' '+label;
}
function present(info){
 text('fcCount',info.repsDetected);
 text('fcKnee',info.kneeAngle==null?'—':Math.round(info.kneeAngle)+'°');
 const feedback=info.feedback||{level:'unknown',depth:'unknown',heels:'unknown',message:''};
 const level=feedback.level||'unknown';
 stage.dataset.level=level;
 liveBadge('fcDepthBadge','Głębokość',feedback.depth||'unknown');
 liveBadge('fcHeelBadge','Pięty',feedback.heels||'unknown');
 const status=$('fcLiveStatus');
 status.dataset.level=level;
 status.textContent=level==='error'||level==='warn'?feedback.message:info.message;
 if(info.event?.rep)text('fcAdvice',info.event.rep.failed.length?
  'Uwaga po powtórzeniu: '+info.event.rep.failed.map(x=>x==='depth'?'głębokość':'pięty').join(', '):
  'Powtórzenie w założonym zakresie.');
 else if(level==='error'||level==='warn')text('fcAdvice','Wskazówka orientacyjna — pojedyncza kamera 2D.');
 if(debug)text('fcDebug','Faza: '+info.state+' · '+(info.side||'—')+' · klatki: '+info.validFrames+'/'+info.frames+
  ' · '+delegate+' · FPS: '+(frameTimes.length?Math.round(frameTimes.length*1000/Math.max(1,frameTimes.at(-1)-frameTimes[0])):0));
}
function showResults(){
 if(!engine)return;
 const data=engine.finish();
 showScreen('result');
 const score=data.score==null?'—':data.score+'%';
 text('fcScore',score);text('fcReps',data.repsDetected);text('fcGood',data.repsGood);
 text('fcQuality',Math.round(data.quality.validFrameRatio*100)+'% klatek z widocznymi punktami');
 const labels={depth:'Głębokość',heels:'Stabilność pięt'};
 $('fcChecks').replaceChildren();
 for(const x of data.checkpoints){
  const row=document.createElement('div');row.className='fc-check';
  const title=document.createElement('strong');title.textContent=labels[x.id]||x.id;
  const value=document.createElement('span');value.textContent=x.passRate==null?'Brak danych':x.passRate+'% bez wykrytego błędu';
  row.append(title,value);$('fcChecks').appendChild(row);
 }
 text('fcIssue',data.mainIssue?'Najczęstsza uwaga: '+(labels[data.mainIssue]||data.mainIssue):
  data.repsDetected?'Brak zgłoszonych nieprawidłowości':'Brak pełnych powtórzeń — wynik niepewny');
 if(openResolver){openResolver(data);openResolver=null}
}
function stopCamera(){
 stopRequested=true;playing=false;cancelAnimationFrame(raf);raf=0;
 if(camera){camera.stop();camera=null}
 video.srcObject=null;lastVideoTime=-1;lastInference=0;
}
function terminate(){stopCamera();overlay.hidden=true;document.body.classList.remove('fc-open');
 if(openResolver){openResolver(null);openResolver=null}}
function beginOverlay(exercise='Przysiad ze sztangą'){
 if(openResolver)return Promise.resolve(null);
 const config=lib.find(exercise);
 if(!config){setStatus('Brak konfiguracji dla tego ćwiczenia');return Promise.resolve(null)}
 exerciseConfig=config;calibratedOnce=false;
 calibration=qualityAPI.createCalibration();feedbackFilter=qualityAPI.createFeedbackFilter();
 engine=engineAPI.createSession(config);
 video.style.display='';$('fcSimBadge').hidden=true;
 stopRequested=false;started=true;lastDrawn=null;frameTimes=[];delegate='';
 text('fcHint',config.cameraHint);text('fcAdvice','System nie zastępuje oceny trenera.');
 text('fcCount','0');text('fcTransfer','');$('fcProgress').removeAttribute('value');
 stage.dataset.level='unknown';liveBadge('fcDepthBadge','Głębokość','unknown');liveBadge('fcHeelBadge','Pięty','unknown');
 $('fcCalibration').hidden=false;$('fcCalibrationLabel').textContent='Kalibracja nie rozpoczęta';$('fcCalibrationProgress').value=0;
 overlay.hidden=false;document.body.classList.add('fc-open');showScreen('initial');
 return new Promise(resolve=>{openResolver=resolve});
}
async function beginCamera(){
 if(playing||!engine)return;
 if(!secure()){setStatus('Kamera jest niedostępna. Wymagany HTTPS, zgoda i obsługa WebAssembly.');return}
 stopRequested=false;playing=true;
 camera=poseAPI.createCamera(video);
 try{
  $('fcStart').disabled=true;
  const details=await camera.start({onProgress:progress});
  if(stopRequested)return;
  delegate=details.delegate;showScreen('live');
  stage.style.aspectRatio=(video.videoWidth||9)+' / '+(video.videoHeight||16);
  lastVideoTime=-1;lastInference=0;frameTimes=[];raf=requestAnimationFrame(loop);
 }catch(error){
  if(!stopRequested)setStatus(error?.name==='NotAllowedError'?
   'Odmówiono dostępu do kamery. Zmień uprawnienia w przeglądarce.':
   'Nie uruchomiono analizy: '+(error?.message||error));
  stopCamera();
 }finally{$('fcStart').disabled=false}
}
function analyzeFrame(frame){
 const quality=calibration.ingest(frame);
 const progressBar=$('fcCalibrationProgress');
 progressBar.value=quality.progress;
 const calibrationCard=$('fcCalibration');
 calibrationCard.hidden=quality.ok&&calibratedOnce;
 const label=$('fcCalibrationLabel');
 label.textContent=quality.ok?'Kalibracja gotowa':quality.message;
 calibrationCard.dataset.status=quality.status;
 if(quality.ok&&!calibratedOnce){
  // A comfortable standing angle helps calibrate the starting position.
  // Depth and heel thresholds are not personalized without verified biomechanics.
  const standing=quality.baseline?.standingKnee??175;
  const top=Math.max(152,Math.min(164,Math.round(standing-12)));
  engine=engineAPI.createSession({...exerciseConfig,
   repThresholds:{...exerciseConfig.repThresholds,top}});
  calibratedOnce=true;
 }
 if(!quality.ok){
  // Invalid views must not contribute to rep counting or technique scoring.
  if(calibratedOnce)engine.ingest({...frame,landmarks:null});
  feedbackFilter.reset();
  const snap=engine.snapshot();
  return {...snap,state:quality.status,side:quality.side,
   message:quality.message,kneeAngle:null,feedback:feedbackFilter.snapshot()};
 }
 const raw=engine.ingest(frame);
 const stable=feedbackFilter.update(raw.feedback,raw.kneeAngle!==null&&!raw.paused);
 return {...raw,feedback:stable};
}
function loop(now){
 if(!playing||!camera)return;
 raf=requestAnimationFrame(loop);
 frameTimes.push(now);if(frameTimes.length>28)frameTimes.shift();
 const fps=frameTimes.length<6?30:(frameTimes.length-1)*1000/Math.max(1,now-frameTimes[0]);
 const minMs=fps<20?85:45;
 if(now-lastInference<minMs||video.currentTime===lastVideoTime)return;
 lastInference=now;lastVideoTime=video.currentTime;
 try{
  const frame=camera.detect(now);
  if(!frame)return;
  stage.style.aspectRatio=frame.width+' / '+frame.height;
  const info=analyzeFrame(frame);
  lastDrawn=frame.landmarks;paintSkeleton(frame.landmarks,info,{width:video.videoWidth||640,height:video.videoHeight||960});present(info);
 }catch(e){setStatus('Błąd analizy: '+(e?.message||e));stopCamera();showScreen('initial')}
}
async function simulate(kind='good'){
 if(playing||!engine)return;
 const allowed=['good','shallow','heels'];
 if(!allowed.includes(kind))return;
 stopRequested=false;playing=true;delegate='fixture';
 showScreen('live');stage.style.aspectRatio='9 / 16';video.style.display='none';
 $('fcSimBadge').hidden=false;
 try{
  const response=await fetch('../tests/fixtures/formcheck-squat-'+kind+'.json',{cache:'no-cache'});
  if(!response.ok)throw Error('Brak syntetycznych sekwencji');
  const fixture=await response.json();
  // Camera users have a natural standing calibration period before exercising.
  // Test fixtures begin squatting immediately, so prepend a stationary pre-roll.
  const first=fixture.frames[0],pre=Array.from({length:15},(_,i)=>(
   {...first,timestamp:first.timestamp+i*100}));
  const shifted=fixture.frames.map(frame=>({...frame,timestamp:frame.timestamp+1500}));
  const source=poseAPI.createFixtureSource([...pre,...shifted]);
  while(playing&&!stopRequested){
   const frame=source.next();if(!frame)break;
   const info=analyzeFrame(frame);
   paintSkeleton(frame.landmarks,info,{width:360,height:640});present(info);
   await new Promise(resolve=>setTimeout(resolve,55));
  }
  if(!stopRequested)finish();
 }catch(e){setStatus('Nie można odtworzyć danych testowych: '+(e?.message||e));stopCamera();showScreen('initial')}
}
function finish(){
 if(!engine)return;
 stopCamera();
 showResults();
}
$('fcOpen').addEventListener('click',()=>{beginOverlay()});
$('fcStart').addEventListener('click',beginCamera);
$('fcSim').addEventListener('click',()=>simulate('good'));
$('fcSimShallow').addEventListener('click',()=>simulate('shallow'));
$('fcSimHeels').addEventListener('click',()=>simulate('heels'));
$('fcStop').addEventListener('click',finish);
$('fcClose').addEventListener('click',terminate);
$('fcDone').addEventListener('click',terminate);
$('fcAgain').addEventListener('click',()=>{terminate();beginOverlay()});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&playing){stopCamera();setStatus('Kamera zatrzymana po przejściu w tło.');showScreen('initial')}});
root.addEventListener('pagehide',terminate);
root.FormCheck=Object.freeze({
 isAvailable:secure,
 hasConfig:lib.hasConfig,
 open:({exerciseId}={})=>beginOverlay(exerciseId||'Przysiad ze sztangą'),
 getSessions:()=>[],getSetBadge:()=>null,
 getStats:()=>({trends:[],avgScore:null,topIssues:[],count:0}),
 onWorkoutFinished:()=>{},onWorkoutDeleted:()=>{}
});
})(typeof window==='object'?window:globalThis);
