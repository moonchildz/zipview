import test from 'node:test';
import assert from 'node:assert/strict';
import {connectHousingInventory} from '../src/housing-inventory.js';
import {compileLinkage,createUnitIndex} from '../src/unit-linkage.js';

function input(){return {
  snapshot:{source:'https://example.test/official',sourceFile:'housing.csv',sha256:'test',targets:[{id:'a',units:[
    {building:'201',unit:'102',exclusiveArea:59.8547},{building:'201',unit:'201',exclusiveArea:59.8547}]}]},
  sites:[{id:'a',buildings:['201'],inventoryComplete:true,facts:[{building:'201',households:2}]}],
  plans:[{complexId:'a',id:'p',providerAreaId:'1',displayType:'59A',area:59.85,providerHouseholds:2,variant:'basic',source:'provider',available:true}],units:[],
};}
test('official identities plus unique displayed area and independent type totals connect exact units',()=>{
  const args=input(),r=connectHousingInventory(args);
  assert.equal(r.reports[0].areaLinked,2);
  assert.deepEqual(r.units.map(u=>[u.unit,u.planId]),[['102','p'],['201','p']]);
  assert.ok(r.units.every(u=>u.officialUnit&&!u.placement));
  const c=compileLinkage({complexes:[{id:'a',address:'address',officialInventory:{complete:true}}],plans:args.plans,units:r.units});
  const index=createUnitIndex(c);
  assert.equal(index.resolve('a','201','102').planId,'p');
  assert.equal(index.resolve('a','201','101').status,'unit-not-found');
  assert.equal(index.resolve('a','201','102').viewReady,false);
});
test('same-area subtypes, wrong totals, and contradictory line plans cannot be resolved by area',()=>{
  for(const change of [a=>a.plans.push({...a.plans[0],id:'p2',providerAreaId:'2'}),a=>a.plans[0].providerHouseholds=3,
    a=>{a.plans.push({...a.plans[0],id:'other',area:84,providerAreaId:'2'});a.lineAssociations=[{complexId:'a',building:'201',line:2,planId:'other'}];}]){
    const args=input();change(args);const r=connectHousingInventory(args);
    assert.equal(r.units.find(u=>u.unit==='102').planId,null);
    assert.ok(r.reports[0].unresolved.length>0);
  }
});
test('incomplete price inventories do not erase independently sourced units',()=>{
  const args=input();args.snapshot.targets[0].units.pop();
  args.units=[{complexId:'a',building:'201',unit:'102',planId:'p',status:'provider-unit',source:'provider'},
    {complexId:'a',building:'201',unit:'201',planId:'p',status:'provider-unit',source:'provider'}];
  const r=connectHousingInventory(args);
  assert.equal(r.units.length,2);assert.equal(r.reports[0].completeInventory,false);
  assert.ok(r.units[0].officialUnit);assert.equal(r.units[1].officialUnit,undefined);
});
test('contradictory provider evidence remains a conflict; duplicate official identities fail',()=>{
  const args=input();args.plans.push({...args.plans[0],id:'wrong',area:84,providerAreaId:'2'});
  args.units=[{complexId:'a',building:'201',unit:'102',planId:'wrong',status:'provider-unit',source:'provider'}];
  const r=connectHousingInventory(args);
  const c=compileLinkage({complexes:[{id:'a'}],plans:args.plans,units:r.units});
  assert.equal(c.units.find(u=>u.unit==='102').status,'conflict');
  args.snapshot.targets[0].units.push(args.snapshot.targets[0].units[0]);
  assert.throws(()=>connectHousingInventory(args),/Duplicate official/);
});
