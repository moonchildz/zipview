import test from 'node:test';
import assert from 'node:assert/strict';
import {apartmentInventory,collectionResult,apartmentSummary} from '../scripts/seoul-apartment-queue.mjs';
const row={apt_cd:'A1',apt_nm:'테스트',apt_rdn_addr:'서울특별시 강남구 테스트로 1',sgg_addr:'강남구',cmpx_clsf:'아파트',tnohsh:2,whol_dong_cnt:1};
const source=rows=>({DESCRIPTION:{APT_CD:'id'},DATA:rows});
test('citywide queue scopes apartment types, preserves checkpoints, and resumes interrupted items',()=>{
  const q=apartmentInventory(source([row,{...row,apt_cd:'A2',cmpx_clsf:'오피스텔'},{...row,apt_cd:'A3',cmpx_clsf:null}]));
  assert.equal(q.targets.length,1);assert.equal(q.excluded.length,2);
  const old={...q.targets[0],status:'running',attempts:1};
  assert.equal(apartmentInventory(source([row]),[old]).targets[0].status,'pending');
  old.status='partial';assert.equal(apartmentInventory(source([row]),[old]).targets[0].status,'partial');
  assert.equal(apartmentInventory(source([{...row,apt_rdn_addr:'서울 강남구 다른로 2'}]),[old]).targets[0].status,'pending');
  assert.throws(()=>apartmentInventory(source([row,row])),/중복/);
});
test('images and complete per-unit links are separate; city and provider counts must agree',()=>{
  const target={address:row.apt_rdn_addr,expectedHouseholds:2};
  const complex={providerId:'123',source:'test',address:row.apt_rdn_addr,households:2,errors:[],
    plans:[{areaId:'1',variants:[{file:'a.png',sha256:'hash'}]}],
    units:[{building:'101',unit:'101',areaId:'1'},{building:'101',unit:'102',areaId:'1'}]};
  assert.equal(collectionResult({complex},target).status,'collected');
  assert.equal(collectionResult({complex:{...complex,units:complex.units.slice(0,1)}},target).status,'partial');
  assert.equal(collectionResult({complex},{...target,expectedHouseholds:3}).status,'partial');
  assert.equal(collectionResult({complex:{...complex,address:'부산 테스트로 1'}},target).status,'review');
  const r=collectionResult({complex},target);
  const summary=apartmentSummary({targets:[r,r],excluded:[]});
  assert.equal(summary.uniqueProviders,1);assert.equal(summary.uniqueImages,1);assert.equal(summary.unitsWithPlans,2);
  assert.equal(r.geographicPlacement,'not-verified');
});
