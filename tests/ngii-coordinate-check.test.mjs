import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {compareBounds} from '../scripts/ngii-coordinate-check.mjs';
import {normalizeSheet,metadataMatches,reconcileFiles,nextBatch,mergeSheets} from '../scripts/ngii-files.mjs';
import {importNgiiInbox} from '../scripts/ngii-inbox.mjs';
import {rawSheet,xml,zipFixture} from './ngii-fixture.mjs';

test('coordinate fallback requires the entire extent, not merely overlap or centre',()=>{
  const expected=[956270,1949076,956715,1949634];
  assert.equal(compareBounds(expected.map(v=>v+.07),expected).matches,true);
  assert.equal(compareBounds(expected.map(v=>v+3),expected).matches,false);
  assert.equal(compareBounds([956370,1949176,956615,1949534],expected).matches,false);
  assert.equal(compareBounds([NaN,1,2,3],expected).matches,false);
  assert.equal(compareBounds([0,0,0,0],expected).matches,false);
  const sheet=normalizeSheet(rawSheet,'test');
  assert.equal(metadataMatches(xml.replace('서울2226','wrong'),sheet,{ignoreName:true}),true);
  assert.equal(metadataMatches(xml.replace('2025-3996','2025-9999'),sheet,{ignoreName:true}),false);
});

test('stable unverified downloads are preserved for review and do not block the next batch',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'zipview-ngii-review-'));
  t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await fs.rm(root,{recursive:true,force:true});});
  const source=path.join(root,'down_260913_01'),output=path.join(root,'mapinfo');
  await fs.mkdir(source);await fs.mkdir(output);
  const stem='(B010)수치지도_376082071_2025_fixture';
  const zip=path.join(source,stem+'.zip'),metadata=path.join(source,stem+'.xml');
  await fs.writeFile(zip,zipFixture());await fs.writeFile(metadata,xml.replace('2025-3996','2025-9999'));
  const old=new Date(Date.now()-30000);await fs.utimes(zip,old,old);await fs.utimes(metadata,old,old);
  const sheet={...normalizeSheet(rawSheet,'test'),status:'requested'};
  const result=await importNgiiInbox({sheets:[sheet],inbox:root,output});
  assert.equal(result.imported.length,0);assert.equal(sheet.status,'review');
  assert.equal(sheet.review.reason,'metadata-mismatch');assert.ok(sheet.review.sha256);
  assert.deepEqual(await fs.readdir(output),[]);assert.equal((await fs.readdir(source)).length,2);
  const next={...sheet,key:'next',number:'376082072',status:'pending'};
  assert.deepEqual(nextBatch([sheet,next]),[next]);
  assert.equal(mergeSheets([[normalizeSheet(rawSheet,'test')]],[sheet])[0].review.reason,'metadata-mismatch');
  // Corrected XML is picked up on the next reconciliation without falsifying completion.
  await fs.writeFile(metadata,xml);
  await importNgiiInbox({sheets:[sheet],inbox:root,output});
  await reconcileFiles([sheet],output);
  assert.equal(sheet.status,'verified');assert.equal(sheet.review,undefined);
  // A name-only mismatch with unreadable geometry must stay unverified.
  await fs.writeFile(metadata,xml.replace('서울2226','wrong'));
  await fs.utimes(metadata,old,old);
  const unknown={...normalizeSheet(rawSheet,'test'),status:'requested',bounds5179:[956270,1949076,956715,1949634]};
  await reconcileFiles([unknown],source);
  assert.equal(unknown.status,'review');assert.equal(unknown.review.reason,'name-mismatch');
  assert.ok(unknown.review.coordinateError);assert.equal(unknown.file,undefined);
});
