import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveXiUnit} from '../src/xi-unit-registry.js';

const linked=(building,unit,type)=>({complex:{id:'gyeonghuigung-xi'},building,unit,status:'linked',sourceStatus:'official-inventory-area-linked',source:'official',plan:{id:'p',displayType:type,available:true,area:59.85}});
test('shared inventory admits an evidenced first-floor home and preserves the exact plan identity',()=>{
  const row=linked('204','102','59A');
  const r=resolveXiUnit({building:'204',unit:'102',linked:row,buildingUnits:[row,linked('204','202','59A')]});
  assert.equal(r.ready,true);assert.equal(r.floor,1);assert.deepEqual(r.availableFloors,[1,2]);
  assert.equal(r.status,'official-inventory-area-linked');assert.equal(r.verified,false);
});
test('shared lookup failure, mismatched identity and unsupported plan cannot fall back to the demo',()=>{
  for(const row of [{status:'unit-not-found'},linked('205','102','59A'),linked('204','101','84B')]){
    assert.equal(resolveXiUnit({building:'204',unit:'101',linked:row,buildingUnits:[row]}).ready,false);
  }
});
