import test from 'node:test';
import assert from 'node:assert/strict';
import {inferPlanRegistration,applyRegistration} from '../src/plan-registration.js';
import {xiOrientationDecision} from '../src/xi-orientation-evidence.js';

const anchors=[[3,7],[91,11],[24,75],[83,68]];
function fixture({mirrored=false,angle=37,sourceAxis='x-right-y-down',targetAxis='east-north'}={}) {
  const radians=angle*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
  const pairs=anchors.map(([rawX,rawY],i)=>{
    const x=rawX*(mirrored?-1:1),y=rawY*(sourceAxis==='x-right-y-down'?-1:1);
    const tx=250+1.7*(c*x-s*y),ty=-130+1.7*(s*x+c*y);
    return {id:['entrance','kitchen-window','bedroom-corner','balcony-end'][i],kind:i===0?'door':'opening',
      source:[rawX,rawY],target:[tx,ty*(targetAxis==='x-right-y-down'?-1:1)],role:i===3?'check':'fit'};
  });
  return {pairs,sourceAxis,targetAxis,tolerance:.25,sourceDocument:'unit-plan-revision-A',targetDocument:'whole-floor-revision-A',unitLinkStatus:'source-matched'};
}

test('registration separates image Y direction, arbitrary rotation and physical reflection',()=>{
  for(const mirrored of [false,true])for(const angle of [0,37,90,146,180,270,359])
    for(const sourceAxis of ['x-right-y-down','east-north'])for(const targetAxis of ['x-right-y-down','east-north']) {
      const input=fixture({mirrored,angle,sourceAxis,targetAxis}),result=inferPlanRegistration(input);
      assert.equal(result.status,'inferred');assert.equal(result.mirrored,mirrored);
      assert.equal(result.verified,false);assert.equal(result.automaticPlacement,true);
      for(const p of input.pairs)assert.ok(Math.hypot(...applyRegistration(result.matrix,p.source).map((x,i)=>x-p.target[i]))<1e-8);
    }
});

test('an independent holdout is not fitted away when it contradicts the other three anchors',()=>{
  const input=fixture();input.pairs[3].target[0]+=8;
  const result=inferPlanRegistration(input);
  assert.equal(result.reason,'inconsistent-landmarks');assert.equal(result.mirrored,null);
  assert.ok(result.candidates[0].fitRms<1e-8);assert.ok(result.candidates[0].holdoutMax>7);
  assert.equal(result.automaticPlacement,false);
});

test('small reading noise is tolerated, while indistinguishable candidates are withheld',()=>{
  const noisy=fixture({mirrored:true});noisy.pairs[0].target[0]+=.02;noisy.pairs[3].target[1]+=.03;
  assert.equal(inferPlanRegistration(noisy).mirrored,true);
  const ambiguous=fixture();ambiguous.tolerance=1000;
  assert.equal(inferPlanRegistration(ambiguous).reason,'reflection-margin-too-small');
});

test('missing identity, duplicate, collinear, nonfinite or insufficient evidence never defaults to unmirrored',()=>{
  const cases=[{}, {...fixture(),sourceDocument:null}, {...fixture(),unitLinkStatus:'guessed'},
    {...fixture(),targetDocument:'unit-plan-revision-A'}, {...fixture(),sourceAxis:'unspecified'},
    {...fixture(),tolerance:0}, {...fixture(),pairs:fixture().pairs.slice(0,3)}];
  for(const mutation of [
    x=>x.pairs[1].id=x.pairs[0].id,
    x=>x.pairs[1].source=x.pairs[0].source,
    x=>x.pairs[1].target=x.pairs[0].target,
    x=>x.pairs.forEach(p=>p.kind='door'),
    x=>x.pairs.forEach(p=>p.role='fit'),
    x=>x.pairs[1].source[0]=NaN,
    x=>x.pairs[1]=null,
    x=>x.sourceDocument={file:'not a document ID'},
    x=>x.pairs.slice(0,3).forEach((p,i)=>p.source=[i,0]),
  ]) {const input=fixture();mutation(input);cases.push(input);}
  for(const input of cases){const result=inferPlanRegistration(input);assert.equal(result.status,'unknown');assert.equal(result.mirrored,null);assert.equal(result.automaticPlacement,false);}
});

test('existing Xi entrance/core hypotheses do not qualify for automatic registration',()=>{
  for(const id of [608374570,608374571])for(const line of [1,2]) {
    const result=xiOrientationDecision({id},line);
    assert.equal(result.status,'inferred');assert.equal(result.automaticPlacement,false);
    assert.equal(result.registration.status,'unknown');assert.equal(result.verified,false);
  }
});
