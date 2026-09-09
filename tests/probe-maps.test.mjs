import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRequest, summarize, probe} from '../scripts/probe-maps.mjs';

test('map probe validates provider and credentials before making requests', async () => {
  let calls = 0;
  await assert.rejects(probe('google', 'test address', '', () => {calls++;}), /Missing GOOGLE/);
  assert.equal(calls, 0);
  assert.throws(() => buildRequest('unknown', 'address', 'test'), /Provider/);
  assert.throws(() => buildRequest('google', ' ', 'test'), /empty/);
});

test('provider requests keep credentials in headers and use documented endpoints', () => {
  const google = buildRequest('google', 'test address', 'secret');
  assert.equal(google.options.headers['X-Goog-Api-Key'], 'secret');
  assert.equal(JSON.parse(google.options.body).addressQuery.addressQuery, 'test address');
  assert.equal(google.url.includes('secret'), false);
  const kakao = buildRequest('kakao', 'test & query', 'secret');
  assert.equal(new URL(kakao.url).searchParams.get('query'), 'test & query');
  assert.equal(kakao.options.headers.Authorization, 'KakaoAK secret');
});

test('Google outlines do not imply verified dong identity or elevation', () => {
  const result = summarize('google', {destinations: [{primary: {
    structureType: 'GROUNDS', displayPolygon: {type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]]},
  }, containingPlaces: [{structureType: 'BUILDING'}]}]});
  assert.equal(result.candidates[0].hasDisplayPolygon, true);
  assert.equal(result.candidates[0].identityVerified, false);
  assert.equal(result.candidates[1].hasDisplayPolygon, false);
  assert.equal(result.groundElevationStatus, 'not_verified');
  assert.equal(summarize('google', {}).destinationCount, 0);
  assert.throws(() => summarize('google', {destinations: {}}), /shape/);
});

test('Kakao coordinates are not mistaken for geometry or elevation', () => {
  const result = summarize('kakao', {documents: [{x: '126.95', y: '37.56'}, {x: '', y: ''}]});
  assert.equal(result.candidates[0].hasCoordinates, true);
  assert.equal(result.candidates[1].hasCoordinates, false);
  assert.equal(result.footprintStatus, 'not_provided_by_keyword_endpoint');
  assert.throws(() => summarize('kakao', {}), /shape/);
});

test('HTTP failure makes one request, does not echo response, and does not retry', async () => {
  let calls = 0;
  await assert.rejects(probe('google', 'test', 'secret', async () => {
    calls++;
    return {ok: false, status: 403, text: () => 'secret'};
  }), error => /403/.test(error.message) && !error.message.includes('secret'));
  assert.equal(calls, 1);
});

test('successful probe parses a synthetic response without changing scene data', async () => {
  const result = await probe('kakao', 'test', 'secret', async (url, options) => {
    assert.ok(options.signal);
    return {ok: true, json: async () => ({documents: [], meta: {total_count: 0}})};
  });
  assert.equal(result.totalCount, 0);
});
