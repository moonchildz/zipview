import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {terrainHeight} from '../src/road-data.js';
import {terrainGeometries} from '../src/terrain-mesh.js';

const original = JSON.parse(readFileSync('research/sinchon-prugio/outlook/scene.json'));
const correction = JSON.parse(readFileSync('research/sinchon-prugio/outlook/mapinfo-correction.json'));
const data = {...original.terrain, local:correction.terrain};

test('local terrain has source coverage, finite heights and continuous boundary', () => {
  assert.equal(data.local.heights.length, data.local.size ** 2);
  assert.ok(data.local.heights.every(h => Number.isFinite(h) && h > 0 && h < 200));
  for (let i=-250;i<=250;i+=2) for (const [x,z] of [[i,-250],[i,250],[-250,i],[250,i]]) {
    assert.ok(Math.abs(terrainHeight(data,x,z)-terrainHeight(original.terrain,x,z))<1e-7);
  }
  assert.ok(correction.sampleCount>1000);
  assert.ok(correction.maxCoincidentSampleDeviationM<=.5);
});

test('rendered local and distant ground agree with road and camera sampling', () => {
  const geometries=terrainGeometries(data);
  const meshes=geometries.map(g=>new THREE.Mesh(g,new THREE.MeshBasicMaterial({side:THREE.DoubleSide})));
  for(const [x,z] of [[.3,.7],[37.5,-5.3],[-85.2,12.3],[249.1,43.3],[251.1,12.7],[700.2,150.3]]) {
    const ray=new THREE.Raycaster(new THREE.Vector3(x,500,z),new THREE.Vector3(0,-1,0));
    const hits=ray.intersectObjects(meshes);
    assert.equal(hits.length,1,'one ground surface, no overlapping coarse terrain');
    assert.ok(Math.abs(hits[0].point.y-terrainHeight(data,x,z))<1e-4);
  }
  geometries.forEach(g=>g.dispose());
});

test('building correction preserves disputed identity and marks inferred elevations', () => {
  const target=correction.buildings.find(b=>b.id===original.targetBuildingId);
  assert.ok(target && target.baseSource.includes('unverified'));
  const disputed=correction.buildings.find(b=>b.id===902872238);
  assert.equal(disputed.points,undefined);
  assert.equal(disputed.height,undefined);
  for(const id of [902872241,902872243]) {
    const b=correction.buildings.find(b=>b.id===id);
    assert.equal(b.levels,3);
    assert.equal(b.heightSource,'ngii-levels-times-2.9');
    assert.ok(b.geometrySource && b.points.length>3);
    assert.deepEqual(b.points[0],b.points.at(-1));
  }
});
