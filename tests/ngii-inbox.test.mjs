import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {importNgiiInbox} from '../scripts/ngii-inbox.mjs';
import {normalizeSheet,reconcileFiles} from '../scripts/ngii-files.mjs';
import {rawSheet,xml,zipFixture} from './ngii-fixture.mjs';

test('native down folders import verified pairs without rewriting live state or original files',async t=> {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'zipview-ngii-inbox-'));
  t.after(async()=> {
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('zipview-ngii-inbox-'));
    await fs.rm(root,{recursive:true,force:true});
  });
  const inbox=path.join(root,'Downloads'),output=path.join(root,'mapinfo'),folder=path.join(inbox,'down_260913_01');
  await fs.mkdir(folder,{recursive:true});await fs.mkdir(output);
  const stem='(B010)수치지도_376082071_2025_fixture';
  const sheet={...normalizeSheet(rawSheet,'서대문구'),status:'requested'};
  await fs.writeFile(path.join(folder,stem+'.zip'),zipFixture());
  const args={sheets:[sheet],inbox,output};
  assert.equal((await importNgiiInbox(args)).imported.length,0,'ZIP alone must not be imported');
  await fs.writeFile(path.join(folder,stem+'.xml'),xml.replace('수치지도2.0','수치지도1.0'));
  assert.equal((await importNgiiInbox(args)).imported.length,0,'Wrong product must not be imported');
  await fs.writeFile(path.join(folder,stem+'.xml'),xml);
  assert.equal((await importNgiiInbox(args)).imported.length,1);
  assert.equal(sheet.status,'requested','Only the active collector writes completion');
  assert.equal((await fs.readdir(folder)).length,2,'Original download must be retained');
  assert.equal((await importNgiiInbox(args)).imported.length,0,'Existing output must not be overwritten');
  await reconcileFiles([sheet],output);assert.equal(sheet.status,'verified');
  assert.equal((await importNgiiInbox(args)).imported.length,0);
});
