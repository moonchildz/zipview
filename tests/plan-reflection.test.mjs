import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {inferPlanReflection} from '../src/plan-reflection.js';
import {XI_PLAN_ENTRANCE,XI_ORIENTATION_ANCHORS,xiOrientationDecision,xiLineOrientations} from '../src/xi-orientation-evidence.js';
import {xiOpeningCandidates} from '../src/xi-unit-layout.js';

test('source entrance/core anchors select a reflection for each registered line',()=>{
  for(const id of [608374570,608374571]) {
    assert.deepEqual(xiLineOrientations({id}),{1:true,2:false});
    for(const line of [1,2]) {
      const result=xiOrientationDecision({id},line);
      assert.equal(result.status,'inferred');assert.equal(result.verified,false);
      assert.ok(result.sources.every(source=>source.startsWith('https://') ? new URL(source).hostname.length>0 : existsSync(source)));
      assert.ok(result.sources.includes(XI_PLAN_ENTRANCE.source));
      assert.equal(result.sources.filter(source=>source.startsWith('https://')).length,2,'external evidence is cited without requiring redistributed originals');
      assert.equal(result.candidates.filter(c=>c.entranceTowardCore).length,1);
      assert.equal(result.candidates.find(c=>c.entranceTowardCore).mirrored,line===1);
    }
  }
});

test('reflection follows the core anchor, not a hardcoded unit number or user toggle',()=>{
  const placement=structuredClone(XI_ORIENTATION_ANCHORS[608374570][1]);
  placement.core[1]=placement.center[1]-60;
  assert.equal(inferPlanReflection({plan:XI_PLAN_ENTRANCE,placement}).mirrored,false);
  const plan=structuredClone(XI_PLAN_ENTRANCE);
  plan.entrance[0]=2*plan.center[0]-plan.entrance[0];
  assert.equal(inferPlanReflection({plan,placement}).mirrored,true);
});

test('missing, ambiguous and conflicting anchors produce unknown instead of a default',()=>{
  const cases=[{}, {plan:XI_PLAN_ENTRANCE},
    {plan:{...XI_PLAN_ENTRANCE,entrance:[1135,243]},placement:XI_ORIENTATION_ANCHORS[608374570][1]},
    {plan:XI_PLAN_ENTRANCE,placement:{...XI_ORIENTATION_ANCHORS[608374570][1],core:[1454,2088]}},
    {plan:XI_PLAN_ENTRANCE,placement:{...XI_ORIENTATION_ANCHORS[608374570][1],front:[-1,0]}},
    {plan:XI_PLAN_ENTRANCE,placement:{...XI_ORIENTATION_ANCHORS[608374570][1],lineSource:null}}];
  for(const input of cases) {
    const result=inferPlanReflection(input);
    assert.equal(result.mirrored,null);assert.equal(result.status,'unknown');
  }
  assert.throws(()=>xiLineOrientations({id:999}),/근거가 부족/);
  const data=JSON.parse(readFileSync('research/gyeonghuigung-xi/scene.json'));
  const unregistered={...data.buildings.find(b=>b.id===data.targetBuildingId),id:999};
  assert.throws(()=>xiOpeningCandidates(unregistered,data.center),/근거가 부족/);
  assert.ok(xiOpeningCandidates(unregistered,data.center,{mirrored:false}).every(w=>w.orientationStatus==='manual-candidate'&&!w.verified));
});
