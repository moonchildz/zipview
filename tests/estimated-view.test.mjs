import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {estimateElevation,estimateFacade,facadeCandidates,attachEstimatedViews} from '../src/estimated-view.js';
import {createUnitIndex} from '../src/unit-linkage.js';
import {insideFootprint,localPoint} from '../src/outlook-math.js';
const geometry={base:50,height:60,levels:20,scene:'research/example/scene.json',center:[127,37.5],points:[[0,0],[40,0],[40,10],[0,10],[0,0]]};

test('same-floor cross-building elevation reflects ground differences and floor increments',()=>{
  const a=estimateElevation(geometry,2),b=estimateElevation({...geometry,base:61},2);
  assert.equal(a.floorElevation,52.9);assert.equal(a.eyeElevation,54.4);
  assert.ok(Math.abs(b.eyeElevation-a.eyeElevation-11)<1e-9);
  assert.ok(Math.abs(estimateElevation(geometry,7).eyeElevation-a.eyeElevation-14.5)<1e-9);
  assert.equal(estimateElevation(geometry,2,{floorHeight:3,eyeHeight:1.6,offset:.5}).eyeElevation,55.1);
  assert.equal(a.verified,false);assert.throws(()=>estimateElevation(geometry,21));
});
test('facade selection handles reversed rings and retains geographic coordinates',()=>{
  for(const g of [geometry,{...geometry,points:[...geometry.points].reverse()}]){
    assert.equal(facadeCandidates(g).length,4);
    const w=estimateFacade(g,{unit:'202',lines:[1,2,3,4]});
    assert.equal(w.bearing,180);assert.equal(insideFootprint(w.point,g.points),false);
    const point=localPoint(w.lon,w.lat,g.center);
    assert.ok(Math.hypot(point[0]-w.point[0],point[1]-w.point[1])<.001);
    assert.equal(w.verified,false);
  }
});
test('absent plans do not block an estimated view; fabricated scenarios and invalid floors are excluded',()=>{
  const catalog={coverage:{},buildings:[{complexId:'a',building:'1',geometry}],units:[
    {complexId:'a',building:'1',unit:'201',status:'linked',plan:null,viewReady:false},
    {complexId:'a',building:'1',unit:'2101',status:'linked'},
    {complexId:'a',building:'1',unit:'501',scenario:true},
  ]};
  attachEstimatedViews(catalog);assert.equal(catalog.coverage.estimatedViews,1);
  assert.equal(catalog.units[0].viewReady,false);assert.equal(catalog.estimatedViewReport[0].errors.length,1);
});
const catalog=JSON.parse(readFileSync('research/linkage/generated/catalog.json','utf8')),index=createUnitIndex(catalog);
test('all 24 pilot buildings and Hanshin 205 have complete estimated elevation coverage',()=>{
  for(const [id,count,buildings] of [['gyeonghuigung-xi',1148,14],['sinchon-prugio',426,10],['seoul:A13606004',84,1]]){
    const rows=catalog.estimatedViewReport.filter(r=>r.complexId===id);
    assert.equal(rows.length,buildings);assert.equal(rows.reduce((n,r)=>n+r.estimatedUnits,0),count);
    assert.ok(rows.every(r=>r.errors.length===0&&r.sourceUnits===r.estimatedUnits));
    for(const u of catalog.units.filter(u=>u.complexId===id&&u.estimatedViewReady)){
      assert.ok(Number.isFinite(u.elevation.eyeElevation));
      assert.ok(!(u.geometry.parts??[u.geometry]).some(p=>insideFootprint(u.estimatedWindow.point,p.points)),`${u.key}: camera outside footprint`);
      assert.ok(u.elevation.eyeElevation<u.elevation.roofElevation,`${u.key}: observer below roof`);
    }
  }
});
test('shared Hanshin rental address resolves 205 from scoped inventory and rejects nonexistent units',()=>{
  const r=index.resolve('서울특별시 성북구 성북로4길 52','205','1201');
  assert.equal(r.complex.id,'seoul:A13606004');assert.equal(r.officialUnit.exclusiveArea,132.96);
  assert.equal(r.geometry.id,559970274);assert.equal(r.elevation.floor,12);assert.equal(r.estimatedViewReady,true);
  assert.equal(r.geometry.heightSource,'official-levels-times-assumed-2.9');
  assert.equal(index.resolve('한신한진','205','2105').status,'unit-not-found');
  assert.equal(index.resolve('한신한진','205','2201').estimatedViewReady,undefined);
});
test('Xi 204 elevation preserves the existing DEM base; Sinchon 209 and 210 remain separate',()=>{
  const r=index.resolve('gyeonghuigung-xi','204','201');assert.equal(r.elevation.ground,49.27736770844799);
  assert.ok(Math.abs(r.elevation.eyeElevation-53.67736770844799)<1e-9);
  const b=catalog.buildings.filter(b=>b.complexId==='sinchon-prugio');
  assert.notEqual(b.find(b=>b.building==='209').geometry.id,b.find(b=>b.building==='210').geometry.id);
  assert.notEqual(b.find(b=>b.building==='206').geometry.base,b.find(b=>b.building==='210').geometry.base);
});
