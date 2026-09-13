import test from 'node:test';
import assert from 'node:assert/strict';
import {createNeighborhoodStore} from '../src/neighborhood.js';

test('shared environment downloads once and home/facade changes cannot contaminate the next view',async()=>{
  const calls=[],source={center:[127,37],targetBuildingId:1,window:{bearing:30},terrain:{local:{height:1}},buildings:[{id:1,base:10}]};
  const store=createNeighborhoodStore(async url=>{calls.push(url);return {ok:true,json:async()=>url==='scene'?source:{terrain:{height:2},buildings:[{id:1,base:20}],status:'survey'}};});
  const [a,b]=await Promise.all([store.load({sceneUrl:'scene',correctionUrl:'survey'}),store.load({sceneUrl:'scene',correctionUrl:'survey'})]);
  assert.deepEqual(calls.sort(),['scene','survey']);
  assert.equal(a.environment.window,undefined);assert.equal(a.environment.targetBuildingId,undefined);
  a.defaultSelection.window.bearing=99;a.environment.buildings[0].base=999;a.environment.terrain.local.height=99;
  assert.equal(b.defaultSelection.window.bearing,30);assert.equal(b.environment.buildings[0].base,20);assert.equal(b.environment.terrain.local.height,2);
  const original=await store.load({sceneUrl:'scene'});
  assert.equal(original.environment.buildings[0].base,10);assert.equal(original.environment.terrain.local.height,1);
  assert.equal(calls.length,2);
});
test('a failed fetch is retryable and different regions have separate identities',async()=>{
  let calls=0;
  const store=createNeighborhoodStore(async()=>({ok:++calls>1,json:async()=>({center:[127,37],terrain:{},buildings:[],targetBuildingId:calls})}));
  await assert.rejects(store.load({sceneUrl:'a'}),/unavailable/);
  assert.equal((await store.load({sceneUrl:'a'})).defaultSelection.targetBuildingId,2);
  assert.equal((await store.load({sceneUrl:'b'})).defaultSelection.targetBuildingId,3);
  store.invalidate('a');assert.equal((await store.load({sceneUrl:'a'})).defaultSelection.targetBuildingId,4);
});
