import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { buildLandmarks, landmarkSight } from '../src/landmarks.js';

const data = JSON.parse(readFileSync('research/sinchon-prugio/outlook/scene.json', 'utf8'));
test('ten sourced landmarks fit terrain and have positive dimensions', () => {
  assert.equal(data.landmarks.length, 10);
  assert.equal(new Set(data.landmarks.map(l => l.id)).size, 10);
  for (const l of data.landmarks) {
    assert.ok(l.source.startsWith('https://www.openstreetmap.org/'));
    assert.ok(l.heightSource.startsWith('https://'));
    assert.ok(l.height > 0 && Number.isFinite(l.base));
    assert.ok(l.point.every(p => Math.abs(p) < data.terrain.extent));
  }
  const namsan = data.landmarks.find(l => l.name === '남산타워');
  assert.equal(namsan.height, 236.7);
  assert.ok(Math.hypot(...namsan.point) > 3100 && Math.hypot(...namsan.point) < 3200);
  assert.equal(data.landmarks.find(l => l.name === '롯데월드타워').height, 555);
});
test('landmark silhouettes retain specified real-world heights', () => {
  const scene = new THREE.Scene();
  for (const l of buildLandmarks(data.landmarks, scene)) {
    const size = new THREE.Box3().setFromObject(l.group).getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.y - l.height) < .01);
    assert.ok(size.x > 1 && size.z > 1);
  }
});
test('top-point visibility respects blockers, hidden geometry and framing', () => {
  const camera = new THREE.PerspectiveCamera(65, 1, .1, 1000);
  camera.lookAt(0,0,-1);
  const landmark = { anchor: new THREE.Vector3(0,0,-100) };
  const blocker = new THREE.Mesh(new THREE.BoxGeometry(20,20,10),new THREE.MeshBasicMaterial());
  blocker.position.z = -50; blocker.updateMatrixWorld();
  assert.equal(landmarkSight(camera,landmark,[]).clear,true);
  assert.equal(landmarkSight(camera,landmark,[blocker]).clear,false);
  blocker.visible = false;
  assert.equal(landmarkSight(camera,landmark,[blocker]).clear,true);
  camera.lookAt(100,0,0);
  assert.equal(landmarkSight(camera,landmark,[]).inFrame,false);
});
