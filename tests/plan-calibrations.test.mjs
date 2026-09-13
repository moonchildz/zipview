import test from 'node:test';
import assert from 'node:assert/strict';
import {planCalibrations} from '../src/plan-calibrations.js';
import {planTraces,traceModel,planLocalPoint,windowPose,modelForPlan} from '../src/plan-models.js';
import {attachPlanTraces} from '../scripts/compile-plan-traces.mjs';

test('downloaded independent dimension sources calibrate exactly the intended plan variants',async()=>{
  const plans=planTraces.map(t=>({id:t.id,complexId:t.complexId,file:t.source.file,displayType:t.type,variant:t.variant,available:true}));
  const report=await attachPlanTraces(plans);
  for(const [id,c] of Object.entries(planCalibrations)){
    assert.equal(report.find(r=>r.id===id).calibration,'applied');
    const p=plans.find(p=>p.id===id),model=modelForPlan(p);
    assert.equal(model.scaleSource,'cross-source-dimension-estimate');
    for(const a of c.axes){
      const one=[...model.center],two=[...model.center];one[a.axis]=a.pixels[0];two[a.axis]=a.pixels[1];
      assert.ok(Math.abs(Math.hypot(...planLocalPoint(model,one).map((v,i)=>v-planLocalPoint(model,two)[i]))-a.meters)<1e-8);
    }
    assert.equal(modelForPlan({...p,complexId:'another-complex'}),null);
    const fallback=modelForPlan({...p,trace:{...p.trace,calibrationSha256:'changed'}});
    assert.equal(fallback.scaleSource,'display-normalization-only');
  }
});
test('anisotropic calibration keeps the observer 35cm perpendicular to the window in meters',()=>{
  const trace={outline:[[0,0],[100,0],[100,100],[0,100]],walls:[],windows:[{id:'diagonal',a:[0,0],b:[100,100],inside:[60,40]}],type:'fixture'};
  const model=traceModel(trace,{axes:[{axis:0,pixels:[0,100],meters:10},{axis:1,pixels:[0,100],meters:5}]});
  const pose=windowPose(model,'diagonal'),a=planLocalPoint(model,[0,0]),b=planLocalPoint(model,[100,100]),p=[pose.position[0],pose.position[2]];
  const perpendicular=Math.abs((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))/Math.hypot(b[0]-a[0],b[1]-a[1]);
  assert.ok(Math.abs(perpendicular-.35)<1e-9);assert.ok(Math.abs(pose.widthMeters-Math.sqrt(125))<1e-9);
  assert.equal(pose.geographicPlacementVerified,false);
});
