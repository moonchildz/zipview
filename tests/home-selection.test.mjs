import test from 'node:test';
import assert from 'node:assert/strict';
import {compileLinkage} from '../src/unit-linkage.js';
import {resolveHomeSelection} from '../src/home-selection.js';
const catalog=compileLinkage({complexes:[{id:'site',name:'단지',address:'서울 종로구 길 1'}],
  plans:[{id:'provider-84',displayType:'84E',complexId:'site',file:'research/84.jpg',available:true,area:84.9}],
  units:[{complexId:'site',building:'206',unit:'1403',planId:'provider-84',source:'provider'}]});
test('scene selection uses the common unit identity and source plan, not a separate demo whitelist',()=>{
  const r=resolveHomeSelection(catalog,'단지','206','1403');
  assert.equal(r.type,'84E');assert.equal(r.plan.imageFile,'research/84.jpg');assert.equal(r.floor,14);assert.equal(r.line,3);
  assert.equal(r.orientation,null);assert.equal(r.mirrored,null);assert.equal(r.viewReady,false);
});
test('unknown units cannot enter a scene with a neighboring floor plan',()=>{
  assert.ok(resolveHomeSelection(catalog,'단지','206','1404').error);
});
