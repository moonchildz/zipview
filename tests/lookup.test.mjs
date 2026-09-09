import test from 'node:test';
import assert from 'node:assert/strict';
import { lookup, units, plans } from '../src/data.js';

test('supported unit resolves to the source plan, with unknown spatial metadata', () => {
  const result = lookup('서울특별시 서대문구 북아현로1길 50', '204동', '802호');
  assert.equal(result.type, '84E');
  assert.equal(result.floor, 8);
  assert.equal(result.orientation, null);
  assert.equal(result.mirrored, null);
  assert.equal(lookup('신촌푸르지오 2단지', '201', '1404').type, '84A');
});

test('unregistered units and unsupported addresses never get a fallback plan', () => {
  for (const args of [
    ['북아현로1길 50', '204', '9999'], ['북아현로1길 50', '204', '801'],
    ['북아현로1길 500', '204', '802'], ['부산 신촌푸르지오', '204', '802'],
    ['북아현로1길 50', '101', '802'], ['북아현로1길 50', '204', '802abc'],
  ]) {
    const result = lookup(...args);
    assert.ok(result.error);
    assert.equal(result.type, undefined);
  }
});

test('registry has unique unit keys and only references available plans', () => {
  assert.equal(new Set(units.map(u => `${u.building}-${u.unit}`)).size, units.length);
  for (const unit of units) assert.ok(plans.some(p => p.id === unit.type));
});
