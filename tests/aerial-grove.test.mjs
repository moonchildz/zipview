import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {sampleGrove, crownClearance, buildGrove} from '../src/aerial-grove.js';
import {disposeAerialTrees} from '../src/aerial-objects.js';

const region = {id:'r1', ring:[[0,0],[24,0],[24,24],[0,24]],
  holes:[[[8,8],[16,8],[16,16],[8,16]]], heightMeters:5};
test('deterministic crowns stay within the region and outside holes', () => {
  const trees = sampleGrove([region]);
  assert.ok(trees.length > 20);
  assert.deepEqual(trees, sampleGrove([region]));
  assert.ok(new Set(trees.map(t => t.height)).size > 10);
  for (const tree of trees) assert.ok(tree.radius < crownClearance([tree.x,tree.z],region));
  assert.ok(sampleGrove([region], {density:1.6}).length > trees.length);
  assert.throws(() => sampleGrove([region], {density:NaN}));
});
test('rendered foliage vertices respect the mask, including internal empty space', () => {
  const group = buildGrove([region]);
  assert.equal(group.children.length, 2);
  assert.ok(group.children.every(m => m.isInstancedMesh));
  const mesh = group.getObjectByName('foliage-clusters'), matrix = new THREE.Matrix4(), vertex = new THREE.Vector3();
  for (let i=0;i<mesh.count;i++) {
    mesh.getMatrixAt(i,matrix);
    for (let j=0;j<mesh.geometry.attributes.position.count;j++) {
      vertex.fromBufferAttribute(mesh.geometry.attributes.position,j).applyMatrix4(matrix);
      assert.ok(crownClearance([vertex.x,vertex.z],region) > 0);
    }
  }
  assert.equal(group.userData.heightStatus,'assumed');
  disposeAerialTrees(group);
});
test('small regions get an interior fallback and height changes preserve horizontal placement', () => {
  const small = {...region,ring:[[0,0],[1.5,0],[1.5,1.5],[0,1.5]],holes:[]};
  assert.ok(sampleGrove([small]).length >= 1);
  const normal = sampleGrove([region]), taller = sampleGrove([region],{heightScale:1.5});
  assert.deepEqual(normal.map(t=>[t.x,t.z,t.radius]),taller.map(t=>[t.x,t.z,t.radius]));
  assert.ok(taller.some((t,i)=>t.height>normal[i].height));
});
