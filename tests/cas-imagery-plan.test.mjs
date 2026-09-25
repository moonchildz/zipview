import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTargets,targetCells,sceneFromRow,solarElevation,planScenes} from '../scripts/cas-imagery-plan.mjs';

test('national target input rejects missing coordinates and duplicate identities without assuming coverage',()=>{
  const r=normalizeTargets([{id:'a',point:[127,37]},{id:'a',point:[128,35]},{id:'b',point:[null,null]},{id:'c',point:[129,35]}]);
  assert.equal(r.targets.length,2);assert.equal(r.rejected.length,2);
  assert.equal(normalizeTargets({features:[{properties:{id:'a'},geometry:{type:'Point',coordinates:[127,37]}}]}).targets.length,1);
});
test('nearby apartment buffers share cells and retain both identities',()=>{
  const one=targetCells([{id:'a',point:[127,37]}]);
  const both=targetCells([{id:'a',point:[127,37]},{id:'b',point:[127,37]}]);
  assert.equal(one.length,both.length);assert.ok(both.every(c=>c.targetIds.length===2));
});
test('solar altitude distinguishes summer from winter at same UTC over Seoul',()=>{
  const summer=solarElevation('2025-06-21T03:00:00Z',127,37.5),winter=solarElevation('2025-12-21T03:00:00Z',127,37.5);
  assert.ok(summer>70&&summer<77);assert.ok(winter>25&&winter<31);
});
const cell=(id,x)=>({id,center:[x+.5,.5],corners:[[x+.1,.1],[x+.9,.1],[x+.9,.9],[x+.1,.9]],targetIds:[id]});
const scene=(id,x1,x2,extra={})=>({id,ring:[[x1,-1],[x1,2],[x2,2],[x2,-1]],cloud:0,roll:0,pitch:0,sunElevation:60,estimatedBytes:6e9,...extra});
test('coverage optimizer shares scenes, rejects clouds and respects download budget',()=>{
  const r=planScenes([cell('a',0),cell('b',1)],[scene('cloud',-1,3,{cloud:10}),scene('both',-1,3),scene('one',-1,1)],{maxGB:6});
  assert.deepEqual(r.selected.map(s=>s.id),['both']);assert.equal(r.plannedCoveredCells,2);assert.equal(r.estimatedDownloadGB,6);
  assert.equal(r.excluded[0].reason,'cloud');
  const small=planScenes([cell('a',0)],[scene('one',-1,1)],{maxGB:5});assert.equal(small.selected.length,0);assert.deepEqual(small.incompleteTargetIds,['a']);
});
test('footprint must contain entire target cell; low sun and unknown cloud remain gaps',()=>{
  const r=planScenes([cell('a',0)],[scene('partial',.2,.8),scene('dark',-1,1,{sunElevation:20}),scene('unknown',-1,1,{cloud:null})]);
  assert.equal(r.selected.length,0);assert.equal(r.plannedCoveredCells,0);
});
test('available higher quality cannot be replaced by a cheap darker scene outside tolerance',()=>{
  const r=planScenes([cell('a',0)],[scene('bright',-1,1,{sunElevation:80}),scene('old',-1,1,{sunElevation:41})],{existingIds:['old']});
  assert.equal(r.selected[0].id,'bright');
});
test('catalog dates come from capture ID, not date-only search timestamp',()=>{
  const r=sceneFromRow({CATALOGTYPE:'L2G',CATALOGID:'C1_20211024021358_03282_00201284',UL_LOT:126.9,UL_LAT:37.6,BL_LOT:126.9,BL_LAT:37.5,BR_LOT:127.1,BR_LAT:37.5,UR_LOT:127.1,UR_LAT:37.6,AVRG_AMTCLD_CNT:0,ROLL_TILT_VL:0,PITCH_TILT_VL:0});
  assert.equal(r.capturedAt,'2021-10-24T02:13:58Z');assert.ok(r.sunElevation>30&&r.sunElevation<50);
  assert.equal(sceneFromRow({CATALOGTYPE:'L3M'}),null);
});
