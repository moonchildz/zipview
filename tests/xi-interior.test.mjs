import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {applyXiLayoutHypothesis,xiOpeningCandidates} from '../src/xi-unit-layout.js';
import {buildXiInterior,planToWorld,validPlanPoint,canMovePlan} from '../src/xi-interior-geometry.js';
const data=JSON.parse(readFileSync('research/gyeonghuigung-xi/scene.json'));
const target=applyXiLayoutHypothesis(data);
test('interior front wall and existing geographic windows share one coordinate transform',()=>{
  for(const line of [1,2])for(const mirrored of [false,true]){
    const living=xiOpeningCandidates(target,data.center,{line,mirrored}).find(w=>w.id==='living');
    const wall=planToWorld(target,line,mirrored,[1142,572]);
    assert.ok(Math.hypot(wall[0]-living.wall[0],wall[1]-living.wall[1])<1e-8);
  }
});
test('window aperture passes rays but the adjoining wall blocks them at both comparison floors',()=>{
  for(const floor of [2,7]){
    const options={line:1,mirrored:true,floor,floorHeight:2.9,offset:0};
    const group=buildXiInterior(target,data.center,options);group.updateMatrixWorld(true);
    const w=xiOpeningCandidates(target,data.center,options).find(w=>w.id==='living');
    const yaw=w.bearing*Math.PI/180,n=[Math.sin(yaw),-Math.cos(yaw)],t=[-n[1],n[0]];
    function hits(side){
      const x=w.wall[0]+t[0]*side,z=w.wall[1]+t[1]*side;
      const origin=new THREE.Vector3(x-n[0]*.7,group.userData.base+1.5,z-n[1]*.7);
      const ray=new THREE.Raycaster(origin,new THREE.Vector3(n[0],0,n[1]),0,1.4);
      return ray.intersectObject(group,true);
    }
    assert.equal(hits(.35).length,0,'clear glass opening must have no solid facade');
    assert.ok(hits(w.widthMeters/2+.25).length>0,'wall beside opening must occlude');
    assert.equal(group.userData.base,target.base+(floor-1)*2.9);
  }
});
test('movement cannot cross partitions, while valid room positions are selectable',()=>{
  assert.equal(validPlanPoint([1142,430]),true);
  assert.equal(validPlanPoint([1052,420]),false);
  assert.equal(validPlanPoint([1142,600]),false);
  assert.equal(canMovePlan([1100,420],[990,420]),false);
  assert.equal(canMovePlan([1142,430],[1142,530]),true);
});
