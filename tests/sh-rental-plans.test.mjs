import test from 'node:test';
import assert from 'node:assert/strict';
import {connectShRentalPlans} from '../scripts/connect-sh-rental-plans.mjs';
import {sinchonShTraces} from '../src/plan-traces/sinchon-sh.js';
import {validatePlanTrace,traceModel,windowPose,modelForPlan,planTraces} from '../src/plan-models.js';
import {planCalibrations} from '../src/plan-calibrations.js';

test('SH rental crosswalk replaces only the identified 203 wing, retaining provider evidence',async()=>{
  const plans=[['29616','34AT'],['75982','34B'],['179187','49A']].map(([providerAreaId,displayType])=>({id:`kb-${providerAreaId}`,complexId:'sinchon-prugio',providerAreaId,displayType,area:34.25}));
  const units=['203','207','208','209','210','105'].flatMap(building=>plans.map(p=>({complexId:p.complexId,building,unit:'205',planId:p.id,source:'provider'})));
  const other={...units[0],complexId:'another-complex'};units.push(other);
  const report=await connectShRentalPlans(plans,units);
  assert.deepEqual(report.map(r=>r.units),[1,1,1]);
  for(const u of units){
    if(u.building==='203'&&u.complexId==='sinchon-prugio'){
      assert.match(u.planId,/^sh-rental-/);assert.match(u.planMappingEvidence.previousPlanId,/^kb-/);assert.equal(u.source,'provider');
    }else assert.match(u.planId,/^kb-/);
  }
});
test('all three SH guide traces keep every opening on one wall with an interior observer',()=>{
  for(const trace of sinchonShTraces){
    assert.deepEqual(validatePlanTrace(trace),[]);
    const model=traceModel(trace);
    for(const w of model.windows){const p=windowPose(model,w.id);assert.equal(p.eyeHeight,1.5);assert.equal(p.insetMeters,.35);assert.equal(p.geographicPlacementVerified,false);}
  }
});
test('a terrace dimension cannot propagate to a different building with an aliased provider label',()=>{
  const t=planTraces.find(t=>t.id==='sinchon-prugio/kb-29616-basic'),c=planCalibrations[t.id];
  const plan={complexId:t.complexId,file:t.source.file,trace:{id:t.id,sourceSha256:t.source.sha256,calibrationSha256:c.sha256}};
  assert.equal(modelForPlan(plan,{building:'207'}).scaleSource,'cross-source-dimension-estimate');
  for(const building of ['203','105'])assert.equal(modelForPlan(plan,{building}).scaleSource,'display-normalization-only');
});
