import test from 'node:test';
import assert from 'node:assert/strict';
import {regionPlacements, buildAerialRegions} from '../src/aerial-regions.js';
import {disposeAerialTrees} from '../src/aerial-objects.js';
const data = {schemaVersion: 2, coordinateSystem: 'image-pixels', source: {width: 100, height: 100},
  scale: {metersPerPixel: 0.5}, regions: [{id: 'r1', kind: 'vegetation-region',
    ring: [[60, 60], [90, 60], [90, 90], [60, 90]], holes: [], heightMeters: 5}],
  objects: [{id: 'v1', kind: 'vehicle', box: [10, 10, 20, 20], score: 0.3}]};
test('region outlines retain handedness and facilities do not depend on region count', () => {
  const placements = regionPlacements(data);
  assert.deepEqual(placements.regions[0].ring[0], [5, 5]);
  assert.equal(placements.objects[0].x, -17.5);
  const filtered = regionPlacements(data, {threshold: 0.5});
  assert.equal(filtered.regions.length, 1); assert.equal(filtered.objects.length, 0);
  const group = buildAerialRegions(placements, {vegetationMode: 'volume'});
  assert.equal(group.getObjectByName('vegetation').children.length, 1);
  assert.equal(group.getObjectByName('facilities').children.length, 1);
  const geometry = group.getObjectByName('vegetation').children[0].geometry;
  geometry.computeBoundingBox();
  assert.ok(geometry.boundingBox.min.x >= 5 && geometry.boundingBox.min.z >= 4.99);
  assert.ok(Math.abs(geometry.boundingBox.max.y - 5) < 0.001);
  disposeAerialTrees(group);
});
test('malformed region geometry fails instead of silently producing a shifted model', () => {
  assert.throws(() => regionPlacements({...data, regions: [{...data.regions[0], ring: [[NaN, 1], [2, 2], [3, 3]]}]}));
  assert.throws(() => regionPlacements({...data, regions: [{...data.regions[0], heightMeters: -1}]}));
  assert.throws(() => regionPlacements({...data, regions: [...data.regions, ...data.regions]}));
});
test('OBB corners survive image-to-ground conversion and extrusion without mirroring',()=>{
  const quad=[[10,5],[15,10],[10,15],[5,10]];
  const input={...data,objects:[{...data.objects[0],box:[5,5,15,15],quad,orientationStatus:'detected-axis-heading-unknown'}]};
  const placements=regionPlacements(input);
  assert.deepEqual(placements.objects[0].footprint[0],[-20,-22.5]);
  const group=buildAerialRegions(placements,{vegetationMode:'volume'});
  const mesh=group.getObjectByName('facilities').children[0];
  assert.equal(mesh.position.x,0); assert.equal(mesh.position.z,0);
  const vertices=mesh.geometry.attributes.position;
  for(let i=0;i<vertices.count;i++) {
    assert.ok(placements.objects[0].footprint.some(([x,z])=>Math.abs(x-vertices.getX(i))<1e-5&&Math.abs(z-vertices.getZ(i))<1e-5));
  }
  assert.equal(mesh.userData.orientationStatus,'detected-axis-heading-unknown');
  disposeAerialTrees(group);
  assert.throws(()=>regionPlacements({...input,objects:[{...input.objects[0],quad:[quad[0],quad[2],quad[1],quad[3]]}]}));
});
