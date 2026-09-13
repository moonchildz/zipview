import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyBuildingFootprints} from '../src/building-footprints.js';
import {applyOfficialBuildingFacts,compileOfficialSites} from '../src/official-buildings.js';
import {geographicPoint,insideFootprint} from '../src/outlook-math.js';
import {buildFacades} from '../src/facades.js';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const correction=read('research/sinchon-prugio/outlook/building-footprints.json');
const sinchon=read('research/sinchon-prugio/outlook/scene.json');

test('209 is recovered once, 210 remains separate, and unrelated same-number buildings survive',()=>{
  const scene=structuredClone(sinchon),unrelated=scene.buildings.find(b=>b.name==='209');
  const snapshot=structuredClone(unrelated);
  applyBuildingFootprints(scene,correction);applyBuildingFootprints(scene,correction);
  assert.deepEqual(scene.buildings.find(b=>b.id===snapshot.id),snapshot);
  const rows=scene.buildings.filter(b=>b.siteSource===correction.siteSource);
  assert.equal(rows.filter(b=>b.name==='209').length,1);
  assert.equal(rows.filter(b=>b.name==='210').length,1);
  const a=rows.find(b=>b.name==='209'),b=rows.find(b=>b.name==='210');
  assert.equal(a.parts.length,2);
  // Independent dense point sampling catches the old overlap in either volume.
  for(let x=10;x<55;x+=.3)for(let z=-25;z<25;z+=.3)
    assert.ok(!(a.parts.some(p=>insideFootprint([x,z],p.points))&&b.parts.some(p=>insideFootprint([x,z],p.points))));
  assert.equal(a.geometryVerified,false);assert.equal(b.geometryVerified,false);
});
test('the same geographic corners survive the neighbouring Xi scene origin',()=>{
  const a=structuredClone(sinchon),b=read('research/gyeonghuigung-xi/scene.json');
  applyBuildingFootprints(a,correction);applyBuildingFootprints(b,correction);
  for(const row of correction.buildings){
    const aa=a.buildings.find(x=>x.id===row.id),bb=b.buildings.find(x=>x.id===row.id);
    for(let i=0;i<aa.points.length;i++){
      const ga=geographicPoint(...aa.points[i],a.center),gb=geographicPoint(...bb.points[i],b.center);
      assert.ok(Math.abs(ga.lon-gb.lon)<1e-10&&Math.abs(ga.lat-gb.lat)<1e-10);
    }
  }
});
test('official heights propagate to every recovered part without replacing terrain elevation',()=>{
  const scene=structuredClone(sinchon);applyBuildingFootprints(scene,correction);
  const sites=compileOfficialSites(read('research/linkage/downloads/hub/target-buildings.json'));
  applyOfficialBuildingFacts(scene,sites);
  for(const row of correction.buildings){
    const b=scene.buildings.find(x=>x.id===row.id);
    assert.equal(b.base,row.base);
    assert.ok(b.parts.every(p=>p.height===b.officialBuilding.height&&p.levels===b.officialBuilding.levels));
    for(const part of b.parts){const group=buildFacades(part);group.traverse(m=>{if(m.geometry){assert.ok([...m.geometry.attributes.position.array].every(Number.isFinite));m.geometry.dispose();m.material.dispose();}});}
  }
});
