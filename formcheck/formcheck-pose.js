(function(root){
'use strict';
// All third-party URLs are version pinned and centralized here.
const SOURCES=Object.freeze({
 version:'1.2.3',
 sdk:'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/vision_bundle.mjs',
 wasm:'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm',
 lite:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
 full:'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
 cache:'moja-silownia-formcheck-model-v1'
});
const MAX_MODEL_BYTES=32*1024*1024;
function report(fn,stage,done=null,total=null){try{fn?.({stage,done,total})}catch(_e){}}
async function downloadModel(url,onProgress,signal){
 let cache=null;
 if('caches' in root){try{cache=await caches.open(SOURCES.cache)}catch(_e){}}
 if(cache){
  try{
   const hit=await cache.match(url);
   if(hit){const bytes=await hit.arrayBuffer();if(bytes.byteLength&&bytes.byteLength<=MAX_MODEL_BYTES){
    report(onProgress,'Model z pamięci przeglądarki',bytes.byteLength,bytes.byteLength);return bytes;
   }}
  }catch(_e){}
 }
 report(onProgress,'Pobieranie modelu',0,null);
 const response=await fetch(url,{mode:'cors',signal,cache:'default'});
 if(!response.ok)throw Error('Nie udało się pobrać modelu (HTTP '+response.status+')');
 const length=Number(response.headers.get('Content-Length'))||null;
 if(length>MAX_MODEL_BYTES)throw Error('Plik modelu przekracza limit wielkości.');
 let buffer;
 if(response.body?.getReader){
  const reader=response.body.getReader(),parts=[];let size=0;
  try{
   while(true){
    const {done,value}=await reader.read();if(done)break;
    size+=value.byteLength;
    if(size>MAX_MODEL_BYTES)throw Error('Model jest zbyt duży.');
    parts.push(value);
    report(onProgress,'Pobieranie modelu',size,length);
   }
  }finally{reader.releaseLock()}
  const combined=new Uint8Array(size);let offset=0;
  for(const part of parts){combined.set(part,offset);offset+=part.byteLength}
  buffer=combined.buffer;
 }else{
  buffer=await response.arrayBuffer();
  if(buffer.byteLength>MAX_MODEL_BYTES)throw Error('Model jest zbyt duży.');
 }
 if(!buffer.byteLength)throw Error('Pobrany model jest pusty.');
 if(cache){
  try{await cache.put(url,new Response(buffer.slice(0),{
    headers:{'Content-Type':'application/octet-stream'}
  }))}catch(_e){/* Storage denied/full: memory-only model is still usable. */}
 }
 report(onProgress,'Model gotowy',buffer.byteLength,buffer.byteLength);
 return buffer;
}
async function createLandmarker(onProgress,signal,model='lite'){
 report(onProgress,'Ładowanie MediaPipe');
 const sdk=await import(SOURCES.sdk);
 if(signal?.aborted)throw new DOMException('Przerwano','AbortError');
 const fileset=await sdk.FilesetResolver.forVisionTasks(SOURCES.wasm);
 if(signal?.aborted)throw new DOMException('Przerwano','AbortError');
 const bytes=new Uint8Array(await downloadModel(SOURCES[model]||SOURCES.lite,onProgress,signal));
 if(signal?.aborted)throw new DOMException('Przerwano','AbortError');
 const baseOptions={modelAssetBuffer:bytes,delegate:'GPU'};
 try{
  report(onProgress,'Uruchamianie analizy GPU');
  const landmarker=await sdk.PoseLandmarker.createFromOptions(fileset,{
   baseOptions,runningMode:'VIDEO',numPoses:1,outputSegmentationMasks:false
  });
  return {landmarker,delegate:'GPU'};
 }catch(gpuError){
  if(signal?.aborted)throw new DOMException('Przerwano','AbortError');
  report(onProgress,'GPU niedostępne — przełączanie na CPU');
  const landmarker=await sdk.PoseLandmarker.createFromOptions(fileset,{
   baseOptions:{modelAssetBuffer:bytes,delegate:'CPU'},
   runningMode:'VIDEO',numPoses:1,outputSegmentationMasks:false
  });
  return {landmarker,delegate:'CPU'};
 }
}
function createCamera(video){
 let stream=null,landmarker=null,abortController=null,disposed=false;
 const canvas=document.createElement('canvas');
 const ctx=canvas.getContext('2d',{willReadFrequently:false});
 if(!ctx)throw Error('Ta przeglądarka nie obsługuje Canvas 2D.');
 async function start({onProgress,model='lite',facingMode='environment'}={}){
  if(disposed)throw Error('Sesja kamery została zakończona.');
  if(!root.isSecureContext||!navigator.mediaDevices?.getUserMedia)
   throw Error('Kamera wymaga HTTPS oraz obsługi getUserMedia.');
  abortController=new AbortController();
  // Get the permission request started directly from a real user gesture.
  const pending=navigator.mediaDevices.getUserMedia({
   audio:false,video:{facingMode:{ideal:facingMode},width:{ideal:1280},height:{ideal:720}}
  });
  try{
   stream=await pending;
   if(disposed){stream.getTracks().forEach(t=>t.stop());throw Error('Sesja zakończona.')}
   video.srcObject=stream;
   await video.play();
   report(onProgress,'Kamera uruchomiona');
   const opened=await createLandmarker(onProgress,abortController.signal,model);
   if(disposed){opened.landmarker.close();throw Error('Sesja zakończona.')}
   landmarker=opened.landmarker;
   return {delegate:opened.delegate};
  }catch(error){
   stop();
   throw error;
  }
 }
 let lastSourceWidth=0,lastSourceHeight=0;
 function detect(now){
  if(disposed||!landmarker||!stream||video.readyState<2)return null;
  const width=video.videoWidth,height=video.videoHeight;
  if(!width||!height)return null;
  const scale=320/Math.min(width,height);
  const w=Math.round(width*scale),h=Math.round(height*scale);
  if(w!==lastSourceWidth||h!==lastSourceHeight){
   canvas.width=w;canvas.height=h;lastSourceWidth=w;lastSourceHeight=h;
  }
  ctx.drawImage(video,0,0,w,h);
  const result=landmarker.detectForVideo(canvas,now);
  return {timestamp:now,landmarks:result.landmarks?.[0]||null,width:w,height:h};
 }
 function stop(){
  if(disposed)return;
  disposed=true;
  abortController?.abort();
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}
  video.pause();video.srcObject=null;
  if(landmarker){try{landmarker.close()}catch(_e){}landmarker=null}
 }
 return Object.freeze({start,detect,stop,isRunning:()=>!disposed&&!!landmarker});
}
function createFixtureSource(frames){
 const data=Array.isArray(frames)?frames:[];let pos=0;
 return Object.freeze({next:()=>data[pos++]||null,reset:()=>{pos=0},length:data.length});
}
root.FormCheckPose=Object.freeze({SOURCES,createCamera,createFixtureSource,downloadModel});
})(typeof window==='object'?window:globalThis);
