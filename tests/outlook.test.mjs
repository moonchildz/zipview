import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eyeElevation, localPoint, facadeView, insideFootprint } from '../src/outlook-math.js';
import { lookup } from '../src/data.js';

test('comparison units are explicitly scenarios, not confirmed units', () => {
  for (const unit of ['504', '1004']) {
    const result = lookup('신촌푸르지오', '206', unit);
    assert.equal(result.type, '59D');
    assert.equal(result.scenario, true);
    assert.equal(result.orientation, null);
  }
  assert.ok(lookup('신촌푸르지오', '206', '604').error);
});
test('same window uses only floor delta, plus shared calibration', () => {
  assert.equal(eyeElevation(0, 1), 1.5);
  assert.equal(eyeElevation(0, 1, 2.9, 0, 1.7), 1.7);
  assert.ok(Math.abs(eyeElevation(51.19, 10) - eyeElevation(51.19, 5) - 14.5) < 1e-8);
  assert.ok(Math.abs(eyeElevation(51.19, 10, 3.2, 4) - eyeElevation(51.19, 5, 3.2, 4) - 16) < 1e-8);
});
test('local geographic snapshot has actual target and valid terrain', () => {
  const data = JSON.parse(readFileSync('research/sinchon-prugio/outlook/scene.json', 'utf8'));
  const target = data.buildings.find(b => b.id === data.targetBuildingId);
  assert.equal(target.name, '206');
  assert.equal(target.height, 50);
  assert.equal(target.levels, 17);
  assert.equal(data.terrain.heights.length, data.terrain.size ** 2);
  assert.ok(data.terrain.heights.every(Number.isFinite));
  assert.ok(data.buildings.every(b => b.height > 0 && Number.isFinite(b.base)));
  const point = localPoint(data.window.lon, data.window.lat, data.center);
  assert.ok(Math.hypot(...point) < 30);
  const view = facadeView(target.points);
  assert.ok(view.bearing > 115 && view.bearing < 140, 'southeast facade normal');
  assert.ok(Math.abs(data.window.bearing - view.bearing) < 1e-8);
  assert.ok(Math.hypot(point[0] - view.point[0], point[1] - view.point[1]) < 1e-6);
  assert.equal(insideFootprint(point, target.points), false, 'camera outside own building');
  const yaw = view.bearing * Math.PI / 180;
  for (const distance of [1, 2, 5, 10, 20]) {
    assert.equal(insideFootprint([point[0] + Math.sin(yaw) * distance, point[1] - Math.cos(yaw) * distance], target.points), false, 'outward ray clears own facade');
  }
  assert.equal(data.previousWindow.bearing, 78);
});
