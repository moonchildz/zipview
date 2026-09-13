import test from 'node:test';
import assert from 'node:assert/strict';
import {TARGET_SITES,compileOfficialSites,applyOfficialBuildingFacts,buildingNumber} from '../src/official-buildings.js';

const target=TARGET_SITES[0];
test('dong suffix is normalized within a site; addresses and annex labels are not building identities',()=>{
  assert.equal(buildingNumber('208동'),'208');assert.equal(buildingNumber(' 208 동 '),'208');
  assert.equal(buildingNumber('208동 상가'),null);assert.equal(buildingNumber('송월길 99'),null);
  const scene={buildings:[{name:'208동',siteSource:target.siteSource,height:8.7,base:50.201}]};
  assert.equal(applyOfficialBuildingFacts(scene,[{...target,facts:[{building:'208',height:11.52,levels:3}]}]),1);
  assert.equal(scene.buildings[0].height,11.52);assert.equal(scene.buildings[0].base,50.201);
});
const row=building=>({building,bldrgstSeqno:`registry-${building}`,rdnmadr:target.address,detailSource:'https://www.hub.go.kr/portal/gis/bld/idx-bld-detail.do',households:10,levels:5,heightMeters:17});
test('official scope excludes the other Sinchon phase and requires every target building',()=>{
  const snapshot={checkedAt:'2026-09-11',targets:[{id:target.id,address:target.address,status:'complete-search',buildings:[row('105'),...target.buildings.map(row)]}]};
  const [site]=compileOfficialSites(snapshot);
  assert.equal(site.expectedUnits,100);assert.equal(site.inventoryComplete,true);assert.equal(site.facts.length,10);
  snapshot.targets[0].buildings.pop();assert.equal(compileOfficialSites(snapshot)[0].inventoryComplete,false);
  assert.equal(compileOfficialSites(null)[0].expectedUnits,null);
});
test('official height never changes terrain or assigns parcel centroid as a building location',()=>{
  const scene={buildings:[{name:'201',siteSource:target.siteSource,height:60,levels:20,base:123,points:[[1,2],[3,4]],heightSource:'assumed'},
    {name:'201',siteSource:'different-complex',height:70}]};
  const sites=[{...target,facts:[{building:'201',height:41.32,levels:14}]}];
  assert.equal(applyOfficialBuildingFacts(scene,sites),1);
  assert.equal(scene.buildings[0].height,41.32);assert.equal(scene.buildings[0].base,123);
  assert.deepEqual(scene.buildings[0].points,[[1,2],[3,4]]);assert.equal(scene.buildings[1].height,70);
  applyOfficialBuildingFacts(scene,sites);assert.equal(scene.buildings[0].previousBuildingHeight.height,60);
});
test('duplicate official and scene identities cannot silently choose a record',()=>{
  assert.throws(()=>compileOfficialSites({targets:[{...target,buildings:[row('201'),row('201')]}]}),/Duplicate/);
  assert.throws(()=>applyOfficialBuildingFacts({buildings:[{name:'201',siteSource:target.siteSource},{name:'201',siteSource:target.siteSource}]},[{...target,facts:[{building:'201'}]}]),/Ambiguous/);
});
