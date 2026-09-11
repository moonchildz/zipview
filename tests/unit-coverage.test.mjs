import test from 'node:test';
import assert from 'node:assert/strict';
import {compileLinkage} from '../src/unit-linkage.js';
import {unitCoverage} from '../src/unit-coverage.js';
const fixture=()=>({complexes:[{id:'a',providerHouseholds:2}],plans:[{complexId:'a',id:'84A',available:true}],
  units:[{complexId:'a',building:'101',unit:'101',planId:'84A',source:'provider',status:'provider-unit-link'}]});
test('having a plan and one successful unit does not imply whole-complex coverage',()=>{
  const [r]=unitCoverage(compileLinkage(fixture()));
  assert.equal(r.expectedUnits,2);assert.equal(r.knownUnits,1);assert.equal(r.unitsWithPlanImages,1);
  assert.equal(r.missingExpectedUnits,1);assert.equal(r.completePlanLookup,false);
});
test('source-complete, image-complete and candidate-only states remain separate',()=>{
  const f=fixture();f.units.push({...f.units[0],unit:'102'});
  assert.equal(unitCoverage(compileLinkage(f))[0].completePlanLookup,true);
  f.plans[0].available=false;
  let r=unitCoverage(compileLinkage(f))[0];assert.equal(r.typeLinkedUnits,2);assert.equal(r.missingUnits.length,2);assert.equal(r.completePlanLookup,false);
  f.units=f.units.map(u=>({...u,status:'source-linked-candidate'}));
  r=unitCoverage(compileLinkage(f))[0];assert.equal(r.knownUnits,0);assert.equal(r.unitCandidates,2);assert.equal(r.completePlanLookup,false);
});
test('missing or contradictory totals cannot pass the completion gate',()=>{
  const f=fixture();delete f.complexes[0].providerHouseholds;
  assert.equal(unitCoverage(compileLinkage(f))[0].completePlanLookup,false);
  f.complexes[0].providerHouseholds=1;f.units.push({...f.units[0],unit:'102'});
  const r=unitCoverage(compileLinkage(f))[0];assert.equal(r.countMismatch,true);assert.equal(r.completePlanLookup,false);
});
test('provider corroboration counts unit identity without promoting the comparison view to verified',()=>{
  const f=fixture();f.units[0].scenario=true;f.units[0].status=null;f.units[0].providerEvidence={areaId:'123',source:'provider'};
  const c=compileLinkage(f);assert.equal(unitCoverage(c)[0].knownUnits,1);assert.equal(c.units[0].viewReady,false);
});
