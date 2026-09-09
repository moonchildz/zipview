import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { roadProfile, terrainHeight, ribbonVertices } from '../src/road-data.js';
import { buildStreets } from '../src/streets.js';
import { buildFacades } from '../src/facades.js';

test('road profile keeps assumptions separate and excludes unsupported structures', () => {
  assert.equal(roadProfile({ highway: 'residential', width: '7 m' }).widthSource, 'osm-width');
  assert.equal(roadProfile({ highway: 'residential', width: '7 m' }).width, 7);
  assert.equal(roadProfile({ highway: 'residential', lanes: '2' }).widthSource, 'lanes-assumption');
  assert.equal(roadProfile({ highway: 'service' }).widthSource, 'class-assumption');
  assert.equal(roadProfile({ highway: 'footway' }).walk, true);
  assert.equal(roadProfile({ highway: 'residential', lane_markings: 'no' }).centerLine, false);
  assert.equal(roadProfile({ highway: 'primary', tunnel: 'yes' }), null);
  assert.equal(roadProfile({ highway: 'residential', bridge: 'yes' }), null);
  assert.equal(roadProfile({ highway: 'pedestrian', area: 'yes' }), null);
});

test('terrain sampling uses the same diagonal as terrain mesh', () => {
  const terrain = { extent: 1, size: 2, heights: [0, 10, 20, 50] };
  assert.equal(terrainHeight(terrain, 0, 0), 15);
  assert.equal(terrainHeight(terrain, .5, .5), 32.5);
  const plane = new THREE.PlaneGeometry(2, 2, 1, 1);
  plane.rotateX(-Math.PI / 2);
  terrain.heights.forEach((height, i) => plane.attributes.position.setY(i, height));
  const mesh = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  const ray = new THREE.Raycaster(new THREE.Vector3(.5, 100, .5), new THREE.Vector3(0, -1, 0));
  assert.ok(Math.abs(ray.intersectObject(mesh)[0].point.y - terrainHeight(terrain, .5, .5)) < 1e-5);
});

test('road ribbon has physical width, follows grade and rejects duplicate-only paths', () => {
  const vertices = ribbonVertices([[0,0],[0,12]], 6, (x,z) => z / 2);
  assert.ok(vertices.length > 18 && vertices.every(Number.isFinite));
  const xs = vertices.filter((_, i) => i % 3 === 0);
  assert.equal(Math.max(...xs) - Math.min(...xs), 6);
  assert.deepEqual(ribbonVertices([[0,0],[0,0]], 6, () => 0), []);
});

test('saved roads retain IDs, provenance and renderable surface geometry', () => {
  const data = JSON.parse(readFileSync('research/sinchon-prugio/outlook/scene.json', 'utf8'));
  assert.ok(data.roads.every(r => r.id && r.tags && r.profile !== undefined));
  const group = buildStreets(data);
  assert.ok(group.userData.roadCount > 1000);
  assert.ok(group.children.length >= 3);
  for (const mesh of group.children) assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
  assert.equal(data.assumption.eyeHeight, 1.5);
});

test('facade geometry stays at original building location and within its height', () => {
  const b = { points:[[0,0],[10,0],[10,8],[0,8],[0,0]], base:50, height:30, levels:10, kind:'apartments' };
  const group = buildFacades(b);
  assert.equal(group.children.length, 3);
  const bounds = new THREE.Box3().setFromObject(group);
  assert.ok(bounds.min.y >= 50 && bounds.max.y <= 80);
  assert.ok(bounds.min.x >= -.1 && bounds.max.x <= 10.1);
});
