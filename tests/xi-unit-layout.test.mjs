import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {insideFootprint,localPoint} from '../src/outlook-math.js';
import {XI_OPENINGS,xiOpeningCandidates,xiUnitPolygon,applyXiLayoutHypothesis} from '../src/xi-unit-layout.js';

const source=JSON.parse(readFileSync('research/gyeonghuigung-xi/scene.json'));
const target=source.buildings.find(b=>b.id===source.targetBuildingId);
const area=points=>Math.abs(points.reduce((sum,p,i)=>{
  const next=points[(i+1)%points.length];return sum+p[0]*next[1]-next[0]*p[1];
},0))/2;

test('five legible openings have distinct positions outside the target in both lines and orientations',()=>{
  assert.equal(XI_OPENINGS.length,5);
  for(const line of [1,2]) for(const mirrored of [false,true]) {
    const windows=xiOpeningCandidates(target,source.center,{line,mirrored});
    assert.equal(new Set(windows.map(w=>w.point.join(','))).size,5);
    for(const w of windows) {
      assert.equal(w.verified,false);
      assert.equal(insideFootprint(w.point,target.points),false,`${line} ${mirrored} ${w.id}`);
      assert.ok(Math.abs(Math.hypot(...w.point.map((v,i)=>v-w.wall[i]))-.2)<1e-8);
      const local=localPoint(w.lon,w.lat,source.center);
      assert.ok(Math.hypot(...local.map((v,i)=>v-w.point[i]))<1e-6);
      assert.ok(w.bearing>(w.side==='front'?138:318)&&w.bearing<(w.side==='front'?140:320));
      assert.ok(line===1?w.fraction>.5:w.fraction<.5);
    }
  }
});

test('mirror changes positions without changing IDs, faces, or line boundaries',()=>{
  const a=xiOpeningCandidates(target,source.center,{mirrored:false}),b=xiOpeningCandidates(target,source.center,{mirrored:true});
  a.forEach((w,i)=>{
    assert.equal(w.id,b[i].id);assert.equal(w.bearing,b[i].bearing);
    assert.ok(Math.abs(w.fraction+b[i].fraction-1.5)<1e-10);
  });
  assert.throws(()=>xiUnitPolygon(target,3),RangeError);
});

test('default orientation follows the entrance/core inference for both lines',()=>{
  for(const line of [1,2]) {
    assert.deepEqual(xiOpeningCandidates(target,source.center,{line}),
      xiOpeningCandidates(target,source.center,{line,mirrored:line===1}));
    const original=xiOpeningCandidates(target,source.center,{line,mirrored:false});
    const mirrored=xiOpeningCandidates(target,source.center,{line,mirrored:true});
    for(const ids of [['bedroom-front','living','balcony'],['bedroom-rear','kitchen']]) {
      const positions=windows=>ids.map(id=>windows.find(w=>w.id===id).fraction);
      const a=positions(original),b=positions(mirrored);
      for(let i=1;i<a.length;i++) assert.ok((a[i]-a[i-1])*(b[i]-b[i-1])<0);
    }
  }
  const living=xiOpeningCandidates(target,source.center)[0];
  assert.ok(Math.abs(living.point[0]-18.191)<.001&&Math.abs(living.point[1]+3.119)<.001);
});

test('18-floor rendering hypothesis partitions the footprint without modifying source metadata',()=>{
  const data=structuredClone(source),result=applyXiLayoutHypothesis(data);
  assert.equal(result.height,65);assert.equal(result.levels,21);
  assert.equal(data.unit.type,null);assert.equal(data.unit.windowVerified,false);
  assert.deepEqual(result.points,target.points);
  assert.equal(result.parts.length,2);
  assert.equal(result.parts[1].levels,18);
  assert.equal(result.parts[1].height,65*18/21);
  assert.ok(Math.abs(result.parts.reduce((s,p)=>s+area(p.points),0)-area(target.points))<1e-6);
  assert.ok(Math.abs(area(xiUnitPolygon(target,1))+area(xiUnitPolygon(target,2))-area(result.parts[1].points))<.1);
  assert.equal(source.buildings.find(b=>b.id===source.targetBuildingId).parts,undefined);
});
