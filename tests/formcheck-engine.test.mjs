import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../formcheck/formcheck-engine.js', import.meta.url),'utf8');
const librarySource = readFileSync(new URL('../formcheck/formcheck-library.js', import.meta.url),'utf8');
const poseSource = readFileSync(new URL('../formcheck/formcheck-pose.js', import.meta.url),'utf8');
const demo = readFileSync(new URL('../formcheck/demo.html', import.meta.url),'utf8');

function loadEngine(){
 const ctx={window:{},console};
 vm.createContext(ctx);
 vm.runInContext(source,ctx);
 vm.runInContext(librarySource,ctx);
 vm.runInContext(poseSource,ctx);
 return ctx.window;
}
const modules=loadEngine();
function fixture(name){
 return JSON.parse(readFileSync(new URL('./fixtures/formcheck-squat-'+name+'.json',import.meta.url),'utf8'));
}
function run(name,override){
 const config=modules.FormCheckLibrary.find('Przysiad ze sztangą');
 assert.ok(config);
 const engine=modules.FormCheckEngine.createSession({...config,...override});
 let last;
 for(const frame of fixture(name).frames)last=engine.ingest(frame);
 return {session:engine.finish(),last,engine};
}
test('geometry: 2D knee-angle calculation, 180 and 90 degrees',()=>{
 const A={x:0,y:1},B={x:0,y:0},C={x:1,y:0},D={x:0,y:-1};
 assert.ok(Math.abs(modules.FormCheckEngine.angle(A,B,C)-90)<.0001);
 assert.ok(Math.abs(modules.FormCheckEngine.angle(A,B,D)-180)<.0001);
 assert.equal(modules.FormCheckEngine.angle(A,B,B),null);
});
test('configuration: name matched, Bulgarian squat left unsupported',()=>{
 const api=modules.FormCheckLibrary;
 assert.equal(api.hasConfig({name:'Przysiad ze sztangą'}),true);
 assert.equal(api.hasConfig({name:'Przysiad goblet z hantlem'}),true);
 assert.equal(api.hasConfig({name:'Przysiad bułgarski'}),false);
 assert.equal(api.hasConfig({name:'Wyciskanie na maszynie'}),false);
});
test('five correct synthetic squats count exactly five, no checkpoint errors',()=>{
 const {session}=run('good');
 assert.equal(session.repsDetected,5);
 assert.equal(session.repsGood,5);
 assert.equal(session.score,100);
 assert.equal(session.mainIssue,null);
 assert.ok(session.reps.every(x=>x.failed.length===0));
 assert.equal(session.quality.uncertain,false);
});
test('shallow squat is counted but depth is flagged as imperfect',()=>{
 const {session}=run('shallow');
 assert.equal(session.repsDetected,2);
 assert.equal(session.repsGood,0);
 assert.ok(session.reps.every(x=>x.failed.includes('depth')));
 assert.equal(session.mainIssue,'depth');
 assert.ok(session.score<100);
});
test('raising heels produces heel checkpoint issue on a counted squat',()=>{
 const {session}=run('heels');
 assert.equal(session.repsDetected,1);
 assert.ok(session.reps[0].failed.includes('heels'));
 assert.equal(session.mainIssue,'heels');
});
test('noise around standing position never counts repetitions',()=>{
 const {session}=run('noise');
 assert.equal(session.repsDetected,0);
 assert.equal(session.score,null);
 assert.equal(session.mainIssue,null);
});
test('occlusion during a rep causes pause and no phantom completion',()=>{
 const config=modules.FormCheckLibrary.find('Przysiad ze sztangą');
 const engine=modules.FormCheckEngine.createSession(config);
 let pausedEver=false;
 for(const frame of fixture('loss').frames){
  const info=engine.ingest(frame);
  pausedEver ||= info.paused;
 }
 assert.equal(pausedEver,true);
 assert.equal(engine.finish().repsDetected,0);
});
test('out of order timestamps are rejected without changing counters',()=>{
 const data=fixture('good').frames;
 const engine=modules.FormCheckEngine.createSession({});
 const first=engine.ingest(data[0]);
 const repeat=engine.ingest(data[0]);
 assert.equal(first.frames,1);
 assert.equal(repeat.frames,1);
 assert.equal(engine.finish().repsDetected,0);
});
test('fixture input has sparse 33-landmark arrays and no media',()=>{
 const samples=['good','shallow','heels','noise','loss'].map(fixture);
 assert.ok(samples.every(s=>s.frames.every(f=>f.landmarks.length===33)));
 assert.ok(samples.every(s=>s.kind==='synthetic-landmark-frames'));
});
test('PoC has no production storage integration or changes to saved workouts',()=>{
 assert.match(demo,/formcheck-engine\.js/);
 assert.match(demo,/formcheck-pose\.js/);
 assert.match(demo,/playsinline muted autoplay/);
 assert.doesNotMatch(demo,/moja-silownia-v01|localStorage\.setItem|<script[^>]*src="\.\.\/index\.html"/);
 assert.match(poseSource,/pose_landmarker_lite\.task/);
 assert.match(poseSource,/modelAssetBuffer/);
 assert.match(poseSource,/getUserMedia/);
 assert.match(poseSource,/getTracks\(\)\.forEach\(t=>t\.stop\(\)\)/);
});
test('replay adapter consumes landmark frames without camera',()=>{
 const data=fixture('heels').frames;
 const src=modules.FormCheckPose.createFixtureSource(data);
 assert.equal(src.length,data.length);
 assert.equal(src.next().timestamp,data[0].timestamp);
 for(let i=1;i<data.length;i++)assert.ok(src.next());
 assert.equal(src.next(),null);
 src.reset();
 assert.equal(src.next().timestamp,data[0].timestamp);
});
