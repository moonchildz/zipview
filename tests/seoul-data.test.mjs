import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import osmtogeojson from 'osmtogeojson';
import {normalizeComplex,normalizeComplexes,normalizeEnvironment,metersTag,geometryBounds,expandUnitRanges} from '../src/seoul-data.js';
import {validateDownload} from '../scripts/collect-seoul.mjs';

const row={apt_cd:'A1',apt_nm:'Test',sgg_addr:'종로구',xcrd:'126.98',ycrd:'37.57',hh_type:'분양',apt_rdn_addr:'서울특별시 종로구 테스트',whol_dong_cnt:'3',tnohsh:'100',phone:'private',insurance_id:'private'};
test('lot aliases use only complete numeric lot fields, not unstructured address notes',()=>{
  assert.equal(normalizeComplex({...row,emd_addr:'내수동',daddr:'72번지'}).landAddress,'서울특별시 종로구 내수동 72');
  for(const daddr of ['관리사무소','72번지 담당자','아파트명',null])assert.equal(normalizeComplex({...row,emd_addr:'내수동',daddr}).landAddress,null);
});
test('Seoul normalization preserves unknown coordinates and excludes unrelated personal fields',()=>{
  const c=normalizeComplex(row);
  assert.deepEqual(c.point,[126.98,37.57]);assert.equal(c.tenure,'분양');assert.equal(c.type,undefined);
  assert.equal(c.phone,undefined);assert.equal(c.insurance_id,undefined);assert.equal(c.verified,false);
  for(const empty of ['',null,undefined,' ']){const n=normalizeComplex({...row,xcrd:empty});assert.equal(n.point,null);assert.equal(n.coordinateStatus,'missing');}
  assert.equal(normalizeComplex({...row,xcrd:0}).coordinateStatus,'out-of-range');
  assert.throws(()=>normalizeComplex({...row,sgg_addr:'not Seoul'}),/district/);
  assert.throws(()=>normalizeComplexes({DESCRIPTION:{APT_CD:'id'},DATA:[row,row]}),/Duplicate/);
  assert.throws(()=>normalizeComplexes({DATA:[row]}),/full-export/);
});

test('unprovided building height and road width are not invented from levels or lanes',()=>{
  for(const value of ['40 ft','12;15','about 5','0','-4','Infinity',null])assert.equal(metersTag(value),null);
  assert.equal(metersTag('12.5 m'),12.5);
  const geometry={type:'Polygon',coordinates:[[[126,37],[127,37],[127,38],[126,37]]]};
  const f=normalizeEnvironment({id:'way/1',properties:{building:'apartments','building:levels':'20'},geometry});
  assert.equal(f.height,null);assert.equal(f.levels,20);assert.equal(f.verified,false);
  const road=normalizeEnvironment({id:'way/2',properties:{highway:'residential',lanes:'2'},geometry:{type:'LineString',coordinates:[[126,37],[127,38]]}});
  assert.equal(road.width,null);
  assert.equal(normalizeEnvironment({id:'way/1',properties:{building:'yes',tainted:true},geometry}),null);
  assert.throws(()=>geometryBounds({coordinates:[]}),/Empty/);
});

test('the OSM converter preserves multipolygon holes and original relation identity',()=>{
  const ring=(id,coords,role)=>({type:'way',ref:id,role,geometry:coords.map(([lon,lat])=>({lon,lat}))});
  const raw={version:.6,elements:[{type:'relation',id:7,tags:{type:'multipolygon',building:'yes'},members:[
    ring(1,[[0,0],[10,0],[10,10],[0,10],[0,0]],'outer'),
    ring(2,[[2,2],[2,4],[4,4],[4,2],[2,2]],'inner')]}]};
  const features=osmtogeojson(raw,{flatProperties:true}).features;
  assert.equal(features.length,1);assert.equal(features[0].id,'relation/7');
  assert.equal(features[0].geometry.coordinates.length,2);
  const normalized=normalizeEnvironment(features[0]);assert.deepEqual(normalized.bounds,[0,0,10,10]);
  assert.equal(normalized.geometry.coordinates[1].length,5);
  const streamed=[];osmtogeojson(structuredClone(raw),{flatProperties:true},f=>streamed.push(normalizeEnvironment(f)));
  assert.deepEqual(streamed,[normalized],'the actual streaming import must match batch conversion');
  assert.equal(normalizeEnvironment({id:'way/3',properties:{tags:{building:'yes'},tainted:true},geometry:features[0].geometry}),null);
});

test('Daebang transcription respects floor steps and piloti exclusions without asserting reflection or accessible subtype',()=>{
  const chart=JSON.parse(readFileSync('research/seoul/daebang-unit-ranges.json','utf8')),units=expandUnitRanges(chart.ranges);
  assert.equal(units.length,283);
  for(const [building,count] of Object.entries(chart.expectedBuildingCounts))assert.equal(units.filter(u=>u.building===building).length,count);
  const get=(building,unit)=>units.find(u=>u.building===building&&u.unit===unit);
  assert.equal(get('101','202'),undefined);assert.ok(get('101','201'));
  assert.equal(get('101','2203'),undefined);assert.ok(get('101','2802'));
  assert.equal(get('102','1401'),undefined);assert.ok(get('102','1403'));
  assert.equal(get('103','103'),undefined);assert.ok(get('103','2902'));
  assert.ok(units.every(u=>u.mirrored===null&&!u.verified&&u.exactVariant===null));
  assert.throws(()=>expandUnitRanges([chart.ranges[0],chart.ranges[0]]),/Overlapping/);
});

test('an Overpass timeout is rejected by default and only explicit salvage records it as incomplete',()=>{
  const raw={osm3s:{timestamp_osm_base:'2026-01-01T00:00:00Z'},elements:[{tags:{'ISO3166-2':'KR-11'}}],remark:'runtime error: timeout'};
  const bytes=Buffer.from(JSON.stringify(raw));
  assert.throws(()=>validateDownload('osm',bytes),/Incomplete/);
  const result=validateDownload('osm',bytes,{allowPartial:true});assert.equal(result.queryComplete,false);assert.equal(result.providerRemark,raw.remark);
  assert.throws(()=>validateDownload('osm',Buffer.from('{bad'),{allowPartial:true}));
  assert.throws(()=>validateDownload('osm',Buffer.from(JSON.stringify({...raw,elements:[]})),{allowPartial:true}),/wrong-area/);
});
