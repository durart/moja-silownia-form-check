import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const read=relative=>readFileSync(new URL(relative,import.meta.url),'utf8');
const ctx={window:{},console};
vm.createContext(ctx);
vm.runInContext(read('../formcheck/formcheck-engine.js'),ctx);
vm.runInContext(read('../formcheck/formcheck-library.js'),ctx);
vm.runInContext(read('../formcheck/formcheck-quality.js'),ctx);
const {FormCheckQuality,FormCheckEngine,FormCheckLibrary}=ctx.window;
const raw=JSON.parse(read('./fixtures/formcheck-squat-good.json')).frames;
const first=raw[0];
const clone=(frame,t)=>({...frame,timestamp:t,landmarks:frame.landmarks.map(p=>p?{...p}:null)});
const calibrated=()=>{
 const m=FormCheckQuality.createCalibration();
 let latest;
 for(let i=0;i<15;i++)latest=m.ingest(clone(first,100+i*100));
 return {m,latest};
};
test('stable sideways stance calibrates automatically after 1.2s',()=>{
 const m=FormCheckQuality.createCalibration();
 const observations=Array.from({length:15},(_,i)=>m.ingest(clone(first,100+i*100)));
 assert.ok(observations.slice(0,10).every(o=>o.ready===false));
 assert.ok(observations.some(o=>o.progress>0&&o.progress<100));
 assert.equal(observations.at(-1).ready,true);
 assert.equal(observations.at(-1).status,'ready');
 assert.equal(observations.at(-1).baseline.side,'left');
 assert.ok(observations.at(-1).baseline.standingKnee>155);
});
test('initial motion postpones calibration',()=>{
 const m=FormCheckQuality.createCalibration();
 const frames=raw.slice(0,16);
 const snapshots=frames.map(f=>m.ingest(f));
 assert.equal(snapshots.at(-1).ready,false);
 assert.ok(snapshots.some(o=>o.message.includes('Stań')));
});
test('short loss of pose pauses analysis and clears unsafe feedback',()=>{
 const {m}=calibrated();
 const poor=clone(first,1600);poor.landmarks[25]=null;
 const status=m.ingest(poor);
 assert.equal(status.ready,true);assert.equal(status.ok,false);
 assert.equal(status.status,'reposition');
 const filter=FormCheckQuality.createFeedbackFilter();
 filter.update({depth:'error',heels:'ok'});
 filter.update({depth:'error',heels:'ok'});
 assert.equal(filter.update({depth:'error',heels:'ok'}).level,'error');
 assert.equal(filter.update({depth:'error',heels:'ok'},false).level,'unknown');
 const back=m.ingest(clone(first,1700));
 assert.equal(back.ok,true);
});
test('persistent loss triggers fresh calibration, no false ready state',()=>{
 const {m}=calibrated();
 const bad=clone(first,1600);bad.landmarks[25]=null;
 assert.equal(m.ingest(bad).status,'reposition');
 assert.equal(m.ingest({...bad,timestamp:4200}).ready,false);
 assert.equal(m.snapshot().ready,false);
});
test('frame size and clipping have actionable hints',()=>{
 const small=clone(first,1600);
 for(const p of small.landmarks)if(p){p.y=.5+(p.y-.5)*.4}
 assert.match(FormCheckQuality.inspect(small).reason,/bliżej/);
 const clipped=clone(first,1600);
 clipped.landmarks[29].y=.997;
 assert.match(FormCheckQuality.inspect(clipped).reason,/Odsuń/);
 const side=FormCheckQuality.inspect(clone(first,1600));
 assert.equal(side.ok,true);
});
test('front-facing view rejected when both shoulders and hips visible',()=>{
 const frame=clone(first,1600);
 for(const i of [12,24,26,28,30])frame.landmarks[i]={...frame.landmarks[i-1],x:.8,visibility:.98};
 frame.landmarks[12]={x:.80,y:frame.landmarks[11].y,visibility:.98};
 frame.landmarks[24]={x:.75,y:frame.landmarks[23].y,visibility:.98};
 assert.match(FormCheckQuality.inspect(frame).reason,/bokiem/);
});
test('single pose confidence dip does not show red and does not give a rep',()=>{
 const {m}=calibrated();
 const e=FormCheckEngine.createSession(FormCheckLibrary.find('Przysiad ze sztangą'));
 const filter=FormCheckQuality.createFeedbackFilter();
 let valid=0;
 const frames=raw.map(f=>({...f,timestamp:f.timestamp+1600}));
 for(const frame of frames){
  const status=m.ingest(frame);
  if(status.ok){valid++;filter.update(e.ingest(frame).feedback,true)}
  else{e.ingest({...frame,landmarks:null});assert.equal(filter.update(null,false).level,'unknown')}
 }
 assert.ok(valid>120);
 assert.equal(e.finish().repsDetected,5);
});
test('debounce: no red on single-frame spikes, stable error turns red',()=>{
 const f=FormCheckQuality.createFeedbackFilter();
 const ok={depth:'ok',heels:'ok'},err={depth:'error',heels:'ok'};
 assert.equal(f.update(ok).level,'unknown');
 assert.equal(f.update(ok).level,'ok');
 assert.equal(f.update(err).depth,'ok');
 assert.equal(f.update(ok).depth,'ok');
 f.update(err);f.update(err);
 assert.equal(f.update(err).depth,'error');
 assert.equal(f.update(null,false).depth,'unknown');
});
test('missing pose does not advance calibration progress',()=>{
 const m=FormCheckQuality.createCalibration();
 for(let i=0;i<5;i++)m.ingest(clone(first,100+i*100));
 const missing=clone(first,600);missing.landmarks[23]=null;
 const state=m.ingest(missing);
 assert.equal(state.progress,0);
 assert.equal(state.ready,false);
});
for(const [name,expected] of [['good',5],['shallow',2],['heels',1]]){
 test('full calibrated replay preserves repetition count: '+name,()=>{
  const fixture=JSON.parse(read('./fixtures/formcheck-squat-'+name+'.json')).frames;
  const pre=Array.from({length:15},(_,i)=>clone(fixture[0],100+i*100));
  const frames=[...pre,...fixture.map(f=>clone(f,f.timestamp+1500))];
  const monitor=FormCheckQuality.createCalibration();
  const filter=FormCheckQuality.createFeedbackFilter();
  let engine=FormCheckEngine.createSession(FormCheckLibrary.find('Przysiad ze sztangą'));
  let activated=false;
  for(const frame of frames){
   const q=monitor.ingest(frame);
   if(q.ok&&!activated){
    const top=Math.max(152,Math.min(164,Math.round(q.baseline.standingKnee-12)));
    const config=FormCheckLibrary.find('Przysiad ze sztangą');
    engine=FormCheckEngine.createSession({...config,repThresholds:{...config.repThresholds,top}});
    activated=true;
   }
   if(q.ok)filter.update(engine.ingest(frame).feedback,true);
   else if(activated){engine.ingest({...frame,landmarks:null});filter.update(null,false)}
  }
  assert.equal(activated,true);
  const summary=engine.finish();
  assert.equal(summary.repsDetected,expected);
  if(name==='good')assert.equal(summary.score,100);
  if(name==='shallow')assert.equal(summary.mainIssue,'depth');
  if(name==='heels')assert.equal(summary.mainIssue,'heels');
 });
}
test('UI wires quality module and guidance without writing to storage',()=>{
 const html=read('../formcheck/demo.html');
 const js=read('../formcheck/formcheck-ui.js');
 const css=read('../formcheck.css');
 assert.match(html,/formcheck-quality\.js/);
 assert.match(html,/id="fcCalibration"/);
 assert.match(html,/id="fcCalibrationProgress"/);
 assert.match(js,/calibration\.ingest\(frame\)/);
 assert.match(js,/qualityAPI\.createFeedbackFilter/);
 assert.match(js,/landmarks:null/);
 assert.match(css,/#fcCalibration\[hidden\]/);
 assert.doesNotMatch(js,/localStorage\.|indexedDB\.|fetch\([^)]*upload/);
});
