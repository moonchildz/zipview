import test from 'node:test';
import assert from 'node:assert/strict';
import {treePlacements, buildAerialTrees, disposeAerialTrees} from '../src/aerial-objects.js';

const doc = {schemaVersion: 1, coordinateSystem: 'image-pixels', source: {width: 100, height: 80},
  scale: {metersPerPixel: 0.5, status: 'assumed'},
  objects: [{id: 't1', kind: 'tree-candidate', box: [60, 50, 70, 60], score: 0.8}]};
test('image right/down maps to positive x/z without mirroring; scale and height remain explicit', () => {
  const [tree] = treePlacements(doc);
  assert.equal(tree.x, 7.5); assert.equal(tree.z, 7.5);
  assert.equal(tree.crownWidth, 5); assert.equal(tree.height, 7.5);
  assert.equal(tree.heightStatus, 'assumed');
  assert.equal(treePlacements(doc, {scale: 1})[0].x, 15);
  assert.equal(treePlacements(doc, {threshold: 0.9}).length, 0);
  assert.equal(doc.scale.metersPerPixel, 0.5);
});
test('reject malformed boxes, duplicate ids, geospatial misuse, and invalid scales', () => {
  assert.throws(() => treePlacements({...doc, coordinateSystem: 'WGS84'}));
  assert.throws(() => treePlacements(doc, {scale: NaN}));
  assert.throws(() => treePlacements({...doc, objects: [...doc.objects, ...doc.objects]}));
  assert.throws(() => treePlacements({...doc, objects: [{...doc.objects[0], box: [0, 0, 101, 2]}]}));
});
test('one shared pair of instanced meshes, not a new scene per camera', () => {
  const group = buildAerialTrees(treePlacements(doc));
  assert.equal(group.children.length, 2);
  assert.ok(group.children.every(mesh => mesh.isInstancedMesh && mesh.count === 1));
  assert.equal(buildAerialTrees([]).children.length, 0);
  disposeAerialTrees(group);
});
