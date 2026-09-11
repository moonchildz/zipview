import test from 'node:test';
import assert from 'node:assert/strict';
import {compileLinkage,createUnitIndex,providerComplexTarget,planImageCount} from '../src/unit-linkage.js';
const fixture=()=>({complexes:[{id:'a',name:'단지 A',address:'서울특별시 종로구 길 99',aliases:['공통 이름']},{id:'b',name:'단지 B',address:'서울특별시 종로구 길 100',aliases:['공통 이름']}],
  buildings:[{complexId:'a',building:'211',geometry:{id:1}},{complexId:'b',building:'211',geometry:{id:2}}],
  plans:[{complexId:'a',id:'84A',available:true},{complexId:'b',id:'59A',available:true}],
  units:[{complexId:'a',building:'211',unit:'1201',planId:'84A',source:'chart-a'},{complexId:'b',building:'211',unit:'1201',planId:'59A',source:'chart-b'}]});
test('address aliases normalize whitespace/Seoul name; identical dong-ho remain scoped',()=>{
  const index=createUnitIndex(compileLinkage(fixture()));
  assert.equal(index.resolve('서울 종로구 길99','211동','01201호').planId,'84A');
  assert.equal(index.resolve('단지 B','211','1201').planId,'59A');
  assert.equal(index.resolve('공통이름','211','1201').status,'ambiguous-address');
  assert.equal(index.resolve('길99','211','1201').planId,'84A');
});
test('unknown units and invalid floors never borrow a neighboring plan',()=>{
  const index=createUnitIndex(compileLinkage(fixture()));
  for(const unit of ['1207','1601','101'])assert.equal(index.resolve('a','211',unit).status,'unit-unlinked');
  assert.equal(index.resolve('a','999','1201').status,'building-unlinked');
  assert.equal(index.resolve('a','211','1200').status,'invalid-input');
});
test('contradictory input preserves both records and blocks any preview',()=>{
  const f=fixture();f.units.push({...f.units[0],planId:'59A',preview:'/?site=xi'});
  const c=compileLinkage(f),r=createUnitIndex(c).resolve('a','211','1201');
  assert.equal(r.status,'conflict');assert.equal(r.planId,null);assert.equal(r.preview,null);assert.equal(r.evidence.length,2);
  assert.equal(c.coverage.conflicts,1);
});
test('scenario, missing assets, and incomplete orientation never imply verified view',()=>{
  const f=fixture();f.units[0].scenario=true;f.units[0].preview='/demo';f.plans[0].available=false;
  const c=compileLinkage(f),r=createUnitIndex(c).resolve('a','211','1201');
  assert.equal(c.coverage.unitAssociations,1);assert.equal(c.coverage.scenarios,1);
  assert.equal(r.preview,null);assert.equal(r.viewReady,false);assert.ok(r.gaps.includes('orientation-unlinked'));
});
test('same inputs are deterministic and duplicate identities fail loudly',()=>{
  assert.deepEqual(compileLinkage(fixture()),compileLinkage(fixture()));
  const f=fixture();f.complexes.push(f.complexes[0]);assert.throws(()=>compileLinkage(f),/Duplicate/);
});

test('stored road/lot addresses support short forms and combined unit input offline',()=>{
  const f=fixture();f.complexes[0].landAddress='서울특별시 종로구 내수동 72';
  const index=createUnitIndex(compileLinkage(f));
  for(const address of ['종로구 길 99','길 99','서울시 종로구 길 99 (단지 A)','내수동 72','종로구 내수동 72']){
    assert.equal(index.resolve(address).complex.id,'a',address);
    assert.equal(index.resolve(`${address} 211동 1201호`).planId,'84A',address);
  }
  assert.equal(index.resolve('길 99 211동 1201호','212','1201').status,'invalid-input');
  assert.equal(index.resolve('').status,'invalid-address');
  assert.equal(index.resolve('다른도시 길99').status,'address-not-registered');
  assert.equal(index.resolve('길9').status,'address-not-registered');
});

test('shared and shortened addresses keep every candidate instead of selecting a plan',()=>{
  const f=fixture();f.complexes[1].address='서울특별시 중구 길 99';
  const index=createUnitIndex(compileLinkage(f));
  assert.equal(index.resolve('길 99','211','1201').status,'ambiguous-address');
  assert.equal(index.resolve('종로구 길99','211','1201').planId,'84A');
  assert.equal(index.resolve('중구 길99','211','1201').planId,'59A');
  assert.equal(index.search('길 99').length,2);
});

test('coverage separates address inventory from complexes with actual plan images',()=>{
  const f=fixture();f.plans[1].available=false;
  const c=compileLinkage(f);
  assert.equal(c.coverage.complexes,2);assert.equal(c.coverage.complexesWithPlanImages,1);
  assert.equal(c.coverage.complexesWithUnitLinks,2);
  const result=createUnitIndex(c).resolve('b','211','1201');
  assert.ok(result.gaps.includes('plan-file-missing'));assert.equal(result.viewReady,false);
});

test('provider identities sharing an address never overwrite or borrow each other',()=>{
  const a={id:'a',address:'서울 종로구 길 99'},b={id:'b',address:a.address};
  const p={providerId:'123',address:a.address};
  assert.equal(providerComplexTarget([a],p),a);
  assert.equal(providerComplexTarget([a,b],p),null);
  a.kbId='456';assert.equal(providerComplexTarget([a],p),null);
  b.kbId='123';assert.equal(providerComplexTarget([a,b],p),b);
  assert.equal(providerComplexTarget([{id:'missing-address'}],{providerId:'123'}),null);
});

test('shared reference images count once even when multiple plan variants refer to them',()=>{
  assert.equal(planImageCount([{id:'a',file:'same.png',available:true},{id:'b',file:'same.png',available:true}]),1);
});
