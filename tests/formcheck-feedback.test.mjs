import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function read(relative){return readFileSync(new URL(relative,import.meta.url),'utf8')}
const context={window:{},console};
vm.createContext(context);
vm.runInContext(read('../formcheck/formcheck-engine.js'),context);
vm.runInContext(read('../formcheck/formcheck-library.js'),context);
const {FormCheckEngine,FormCheckLibrary}=context.window;
function run(name){
 const engine=FormCheckEngine.createSession(FormCheckLibrary.find('Przysiad ze sztangą'));
 const frames=JSON.parse(read('./fixtures/formcheck-squat-'+name+'.json')).frames;
 return frames.map(frame=>({frame,out:engine.ingest(frame)}));
}
test('deep squat: valid depth and steady heels are visibly green',()=>{
 const frames=run('good');
 assert.equal(frames.at(-1).out.repsDetected,5);
 assert.ok(frames.some(x=>x.out.state==='BOTTOM'&&x.out.feedback.depth==='ok'));
 assert.ok(frames.some(x=>x.out.state==='UP'&&x.out.feedback.depth==='ok'));
 assert.ok(frames.every(x=>x.out.feedback.depth!=='error'&&x.out.feedback.heels!=='error'));
});
test('shallow squat: knee warning turns red only after ascent begins',()=>{
 const frames=run('shallow');
 const red=frames.filter(x=>x.out.feedback.depth==='error');
 assert.ok(red.length>0,'expected red depth alerts');
 assert.ok(red.some(x=>x.out.state==='UP'),'should alert during ascent');
 assert.ok(red.some(x=>x.out.feedback.message.includes('płytki')));
 assert.ok(frames.filter(x=>x.out.state==='DOWN').every(x=>x.out.feedback.depth!=='error'),'do not warn before finishing descent');
 assert.equal(frames.at(-1).out.repsDetected,2);
});
test('heel lift: heel warning turns red and does not affect knee color',()=>{
 const frames=run('heels');
 assert.ok(frames.some(x=>x.out.feedback.heels==='error'));
 assert.ok(frames.some(x=>x.out.feedback.level==='error'));
 assert.ok(frames.every(x=>x.out.feedback.depth!=='error'));
 assert.equal(frames.at(-1).out.repsDetected,1);
});
test('neutral/no-data does not create a false red warning',()=>{
 const frames=run('loss');
 assert.ok(frames.some(x=>x.out.feedback.level==='unknown'));
 assert.ok(frames.filter(x=>x.frame.landmarks[25]==null).every(x=>
   x.out.feedback.level==='unknown'&&x.out.feedback.depth==='unknown'&&x.out.feedback.heels==='unknown'));
});
test('noise cannot trigger red technique advice',()=>{
 const frames=run('noise');
 assert.ok(frames.every(x=>x.out.feedback.level!=='error'));
 assert.equal(frames.at(-1).out.repsDetected,0);
});
test('on-camera overlay and simulated error controls are present',()=>{
 const html=read('../formcheck/demo.html');
 const ui=read('../formcheck/formcheck-ui.js');
 const css=read('../formcheck.css');
 for(const id of ['fcDepthBadge','fcHeelBadge','fcSimShallow','fcSimHeels']){
  assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(ui,new RegExp(id));
 }
 assert.match(ui,/paintSkeleton\(frame\.landmarks,info/);
 assert.match(css,/\.fc-camera-chip\[data-state="error"\]/);
 assert.match(css,/#ff596c|#ff4f64|#ff5268/);
 assert.doesNotMatch(html,/moja-silownia-v01|localStorage\.setItem/);
});
