import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {SOURCES} from './collect-seoul.mjs';

const root='research/seoul',readJSON=async p=>JSON.parse(await readFile(p,'utf8'));
const report=await readJSON(`${root}/generated/coverage.json`);
for(const item of report.imports){
  const bytes=await readFile(`${root}/raw/${SOURCES[item.key].file}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256,`raw hash: ${item.key}`);
}
const manifest=await readJSON(`${root}/raw/terrain/manifest.json`);
for(const tile of manifest.tiles){
  const bytes=await readFile(`${root}/raw/terrain/${tile.file}`),png=PNG.sync.read(bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),tile.sha256);
  assert.equal(png.width,256);assert.equal(png.height,256);
}
const db=new DatabaseSync(`${root}/generated/seoul.sqlite`,{readOnly:true});
try {
  assert.deepEqual(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.equal(db.prepare('SELECT count(*) AS n FROM complexes').get().n,report.complexes);
  assert.equal(db.prepare('SELECT count(DISTINCT district) AS n FROM complexes').get().n,25);
  assert.equal(db.prepare('SELECT count(*) AS n FROM units').get().n,report.units.total);
  const features=db.prepare('SELECT category,count(*) AS n FROM environment GROUP BY category').all();
  for(const f of features)assert.equal(f.n,report.environment.counts[f.category]);
  assert.ok(report.environment.counts.building>0&&report.environment.counts.road>0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM environment_bounds').get().n,features.reduce((n,r)=>n+r.n,0));
  assert.equal(db.prepare("SELECT count(*) AS n FROM environment WHERE category='building' AND json_extract(data,'$.height') IS NULL").get().n,report.environment.heightCounts.missing);
  assert.equal(db.prepare("SELECT count(*) AS n FROM environment WHERE category='road' AND json_extract(data,'$.width') IS NULL").get().n,report.environment.widthCounts.missing);
  assert.equal(db.prepare("SELECT count(*) AS n FROM bundles WHERE json_extract(data,'$.releaseReady')=1").get().n,0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM units WHERE json_extract(data,'$.mirrored') IS NOT NULL").get().n,0);
  const osm=report.imports.find(i=>i.key==='osm');assert.equal(report.environment.queryComplete,osm.queryComplete);
  const complexes=db.prepare("SELECT id,name FROM complexes WHERE id IN ('seoul:A10027851','seoul:A10027118')").all();assert.equal(complexes.length,2);
  const result={verifiedAt:new Date().toISOString(),rawHashes:report.imports.length,terrainPNGs:manifest.tiles.length,
    complexes:report.complexes,environment:report.environment.counts,units:report.units.total,sourceQueryComplete:report.environment.queryComplete,
    checks:'storage integrity, hashes, counts and uncertainty flags only; not real-world geometry accuracy'};
  console.log(JSON.stringify(result,null,2));
}finally{db.close();}
