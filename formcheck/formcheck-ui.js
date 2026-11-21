(function(root){
'use strict';
const $=id=>document.getElementById(id);
const engineAPI=root.FormCheckEngine,lib=root.FormCheckLibrary,poseAPI=root.FormCheckPose;
const connections=[[11,23],[23,25],[25,27],[27,29],[12,24],[24,26],[26,28],[28,30],[11,12],[23,24],[11,13],[12,14],[23,24]];
let camera=null,engine=null,raf=0,playing=false,stopRequested=false,openResolver=null;
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
function draw(landmarks){
 if(!landmarks){ctx.clearRect(0,0,canvas.width,canvas.height);return}
 const vw=video.videoWidth||640,vh=video.videoHeight||960;
 if(canvas.width!==vw||canvas.height!==vh){canvas.width=vw;canvas.height=vh}
 ctx.clearRect(0,0,vw,vh);ctx.lineWidth=Math.max(3,vw/170);ctx.lineCap='round';
 for(const [a,b] of connections){
  const p=landmarks[a],q=landmarks[b];if(!p||!q||(p.visibility??1)<.6||(q.visibility??1)<.6)continue;
  ctx.strokeStyle='#46f1d0';ctx.beginPath();ctx.moveTo(p.x*vw,p.y*vh);ctx.lineTo(q.x*vw,q.y*vh);ctx.stroke();
 }
 for(const n of [11,12,23,24,25,26,27,28,29,30]){
  const p=landmarks[n];if(!p||(p.visibility??1)<.6)continue;
  ctx.beginPath();ctx.fillStyle=[25,26].includes(n)?'#f9d46f':'#35e6fa';
  ctx.arc(p.x*vw,p.y*vh,Math.max(4,vw/100),0,Math.PI*2);ctx.fill();
 }
}
function present(info){
 text('fcCount',info.repsDetected);
 text('fcKnee',info.kneeAngle==null?'—':Math.round(info.kneeAngle)+'°');
 text('fcLiveStatus',info.message);
 if(info.event?.rep)text('fcAdvice',info.event.rep.failed.length?
  'Sprawdź: '+info.event.rep.failed.map(x=>x==='depth'?'głębokość':'pięty').join(', '):
  'Powtórzenie wykonane w założonym zakresie.');
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
 engine=engineAPI.createSession(config);
 video.style.display='';$('fcSimBadge').hidden=true;
 stopRequested=false;started=true;lastDrawn=null;frameTimes=[];delegate='';
 text('fcHint',config.cameraHint);text('fcAdvice','System nie zastępuje oceny trenera.');
 text('fcCount','0');text('fcTransfer','');$('fcProgress').removeAttribute('value');
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
  lastDrawn=frame.landmarks;draw(frame.landmarks);
  const info=engine.ingest(frame);present(info);
 }catch(e){setStatus('Błąd analizy: '+(e?.message||e));stopCamera();showScreen('initial')}
}
function syntheticDisplay(frame){
 const landmarks=frame?.landmarks;
 if(!landmarks)return;
 const dims={width:360,height:640};
 if(canvas.width!==dims.width||canvas.height!==dims.height){canvas.width=dims.width;canvas.height=dims.height}
 // Same 2D drawing as the camera, with a static simulated viewport.
 ctx.clearRect(0,0,canvas.width,canvas.height);
 ctx.strokeStyle='#46f1d0';ctx.lineWidth=3;ctx.lineCap='round';
 for(const [a,b] of connections){let p=landmarks[a],q=landmarks[b];if(!p||!q||(p.visibility??1)<.6||(q.visibility??1)<.6)continue;
  ctx.beginPath();ctx.moveTo(p.x*canvas.width,p.y*canvas.height);ctx.lineTo(q.x*canvas.width,q.y*canvas.height);ctx.stroke()}
 for(const n of [11,23,25,27,29]){let p=landmarks[n];if(!p)continue;ctx.fillStyle='#35e6fa';ctx.beginPath();ctx.arc(p.x*canvas.width,p.y*canvas.height,5,0,7);ctx.fill()}
}
async function simulate(){
 if(playing||!engine)return;
 stopRequested=false;playing=true;delegate='fixture';
 showScreen('live');stage.style.aspectRatio='9 / 16';video.style.display='none';
 $('fcSimBadge').hidden=false;
 try{
  const response=await fetch('../tests/fixtures/formcheck-squat-good.json',{cache:'no-cache'});
  if(!response.ok)throw Error('Brak syntetycznych sekwencji');
  const fixture=await response.json(),source=poseAPI.createFixtureSource(fixture.frames);
  while(playing&&!stopRequested){
   const frame=source.next();if(!frame)break;
   syntheticDisplay(frame);present(engine.ingest(frame));
   await new Promise(resolve=>setTimeout(resolve,38));
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
$('fcSim').addEventListener('click',simulate);
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
