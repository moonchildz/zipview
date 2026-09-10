import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {buildFacades} from '../src/facades.js';
import {applyXiLayoutHypothesis,xiOpeningCandidates,XI_PLAN_SCALE} from '../src/xi-unit-layout.js';
import {xiFacadeSpec} from '../src/xi-window-facade.js';

const data=JSON.parse(readFileSync('research/gyeonghuigung-xi/scene.json'));
const target=applyXiLayoutHypothesis(data);
const dispose=group=>group.children.forEach(m=>{m.geometry.dispose();m.material.dispose();});

test('dimension-scaled widths and facade centers share the window-camera mapping',()=>{
  assert.equal(XI_PLAN_SCALE.widthMeters,(3510+3800+3215)/1000);
  for(const line of [1,2])for(const mirrored of [false,true]) {
    for(const w of xiOpeningCandidates(target,data.center,{line,mirrored})) {
      const [a,b]=w.endpoints;
      assert.ok(Math.abs(Math.hypot(b[0]-a[0],b[1]-a[1])-w.widthMeters)<1e-10);
      assert.ok(Math.abs(w.widthMeters-Math.abs(w.segment[2]-w.segment[0])*10.525/467)<1e-10);
      assert.ok(Math.hypot(...a.map((v,i)=>(v+b[i])/2-w.wall[i]))<1e-10);
      assert.equal(w.verified,false);
    }
  }
});

test('explicit facade has five windows per line per floor and no procedural duplicates',()=>{
  const empty=buildFacades(target.parts[1]);
  assert.equal(empty.children.length,0);
  const spec=xiFacadeSpec(target,data.center),group=buildFacades(spec);
  assert.equal(spec.facadeOpenings.length,10);
  assert.equal(group.children.length,2);
  const glass=group.children.find(m=>m.material.color.getHexString()==='557c88');
  assert.equal(glass.geometry.attributes.position.count,10*18*6);
  const positions=glass.geometry.attributes.position;
  spec.facadeOpenings.forEach((w,i)=>{
    const start=i*18*6;
    const width=Math.hypot(positions.getX(start+1)-positions.getX(start),positions.getZ(start+1)-positions.getZ(start));
    assert.ok(Math.abs(width-w.widthMeters)<1e-4);
    assert.ok(Math.abs(positions.getY(start+6)-positions.getY(start)-2.9)<1e-4);
  });
  const bounds=new THREE.Box3().setFromObject(group);
  assert.ok(bounds.min.y>=target.base&&bounds.max.y<=target.base+spec.height);
  dispose(group);
});

test('facade mirror is line-specific and floor-height changes stay within the shell',()=>{
  const initial=xiFacadeSpec(target,data.center);
  const flipped=xiFacadeSpec(target,data.center,{orientations:{1:false,2:false},floorHeight:4});
  assert.notDeepEqual(initial.facadeOpenings[0].endpoints,flipped.facadeOpenings[0].endpoints);
  assert.deepEqual(initial.facadeOpenings.slice(5),flipped.facadeOpenings.slice(5));
  const group=buildFacades(flipped),bounds=new THREE.Box3().setFromObject(group);
  assert.ok(bounds.max.y<=target.base+flipped.height);
  dispose(group);
});
