import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { centerPoint, nearestOnRoad, mapLinks } from '../src/map-review.js';

test('map review uses exact locations and official map URL parameters', () => {
  const links = mapLinks(126.95,37.56,123);
  const street = new URL(links.street), satellite = new URL(links.satellite);
  assert.equal(street.searchParams.get('viewpoint'),'37.5600000,126.9500000');
  assert.equal(street.searchParams.get('heading'),'123');
  assert.equal(satellite.searchParams.get('basemap'),'satellite');
  assert.equal(new URL(links.earth).hostname,'earth.google.com');
});

test('road review selects nearest segment, not an arbitrary endpoint', () => {
  assert.deepEqual(nearestOnRoad([[0,0],[10,0]],[5,3]),{point:[5,0],distance:3});
  assert.deepEqual(centerPoint([[0,0],[10,0],[10,10],[0,10],[0,0]]),[5,5]);
});

test('building labels preserve unknowns and distinguish site inference from height evidence', () => {
  const data = JSON.parse(readFileSync('research/sinchon-prugio/outlook/scene.json','utf8'));
  assert.ok(data.buildings.every(b => b.label && b.source === `https://www.openstreetmap.org/way/${b.id}`));
  const target = data.buildings.find(b => b.id === data.targetBuildingId);
  assert.equal(target.label,'신촌푸르지오아파트 206동');
  assert.equal(target.nameSource,'osm-name-and-site-containment');
  const unknown = data.buildings.find(b => !b.name);
  assert.ok(unknown.label.includes('이름 미확인'));
  for (const id of [902872238,902872241,902872243]) {
    const b = data.buildings.find(b => b.id === id);
    assert.equal(b.heightSource,'assumed');
    assert.equal(b.height,15);
  }
});
