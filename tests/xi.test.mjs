import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {insideFootprint,localPoint} from '../src/outlook-math.js';
import {xiWindowCandidates} from '../src/xi-window.js';
const data=JSON.parse(readFileSync('research/gyeonghuigung-xi/scene.json'));
test('Xi scenario targets its own 204 building without assigning an unverified unit plan',()=>{
  const target=data.buildings.find(b=>b.id===data.targetBuildingId);
  assert.equal(target.id,608374570);assert.equal(target.name,'204');
  assert.equal(target.levels,21);assert.equal(target.height,65);
  assert.equal(data.unit.type,null);assert.equal(data.unit.windowVerified,false);
  assert.equal(data.unit.floor,2);assert.equal(data.terrain.local,undefined);
  assert.ok(data.terrain.heights.every(Number.isFinite));
  assert.equal(new Set(data.buildings.map(b=>b.id)).size,data.buildings.length);
  for(const f of data.facadeCandidates){
    const p=localPoint(f.lon,f.lat,data.center);
    assert.equal(insideFootprint(p,target.points),false);
    const yaw=f.bearing*Math.PI/180;
    assert.equal(insideFootprint([p[0]+Math.sin(yaw),p[1]-Math.cos(yaw)],target.points),false);
  }
  assert.ok(data.window.bearing>130&&data.window.bearing<150);
});
test('living-room hypotheses occupy separate halves and face out of the SE wall',()=>{
  const building=data.buildings.find(b=>b.id===data.targetBuildingId);
  const facade=data.facadeCandidates[0];
  const candidates=xiWindowCandidates(building,facade,data.center);
  assert.equal(candidates.length,2);
  assert.ok(candidates[0].fraction<.5&&candidates[1].fraction>.5);
  assert.ok(Math.abs(candidates[0].fraction+candidates[1].fraction-1)<1e-10);
  for(const c of candidates){
    assert.equal(insideFootprint(c.point,building.points),false);
    assert.equal(c.verified,false);
    assert.equal(c.bearing,facade.bearing);
    assert.ok(c.mirroredPlanShiftMeters<.3);
  }
  const separation=Math.hypot(...candidates[0].point.map((v,i)=>v-candidates[1].point[i]));
  assert.ok(separation>9&&separation<11);
});
