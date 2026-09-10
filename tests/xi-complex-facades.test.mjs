import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {applyXiLayoutHypothesis} from '../src/xi-unit-layout.js';
import {applyXiComplexFacades,XI_COMPLEX_SITE} from '../src/xi-complex-facades.js';
import {buildFacades} from '../src/facades.js';

const source=JSON.parse(readFileSync('research/gyeonghuigung-xi/scene.json'));
const area=p=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0))/2;
test('all fourteen complex buildings receive explicit facades, never other sites or civic buildings',()=>{
  const data=structuredClone(source);applyXiLayoutHypothesis(data);
  const coverage=applyXiComplexFacades(data);
  assert.deepEqual(coverage,{buildings:14,partialPlan:2,referencePattern:12,verified:0});
  for(const b of data.buildings) {
    if(!b.facadeEvidence) {
      assert.deepEqual(b,source.buildings.find(original=>original.id===b.id));
      continue;
    }
    assert.equal(b.siteSource,XI_COMPLEX_SITE);assert.equal(b.kind,'apartments');
    assert.equal(b.facadeEvidence.verified,false);
    const original=source.buildings.find(o=>o.id===b.id);
    assert.deepEqual(b.points,original.points);assert.equal(b.height,original.height);
    for(const part of b.parts??[b]) {
      assert.ok(Array.isArray(part.facadeOpenings));
      const group=buildFacades(part);
      if(part.facadeOpenings.length) {
        const bounds=new THREE.Box3().setFromObject(group);
        assert.ok(bounds.min.y>=b.base-.001&&bounds.max.y<=b.base+part.height+.001);
      }
      for(const mesh of group.children) {
        assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
        mesh.geometry.dispose();mesh.material.dispose();
      }
    }
  }
  const b=data.buildings.find(b=>b.id===608374571),wing=b.parts[1];
  assert.equal(wing.facadeOpenings.length,10);assert.equal(wing.levels,21);
  assert.ok(Math.abs(area(b.points)-b.parts.reduce((s,p)=>s+area(p.points),0))<1e-6);
  for(const w of wing.facadeOpenings)assert.equal(w.widthSource,'dimension-scaled-raster-estimate');
  assert.ok(data.buildings.find(b=>b.name==='207'&&b.siteSource===XI_COMPLEX_SITE).facadeOpenings.every(w=>w.widthSource==='unsurveyed-complex-style'));
});
