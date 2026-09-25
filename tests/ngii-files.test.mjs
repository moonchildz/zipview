import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {normalizeSheet,checkInventory,mergeSheets,nextBatch,safeFilename,metadataMatches,verifyZip,reconcileFiles,writeJson} from '../scripts/ngii-files.mjs';
import {rawSheet,xml,isoXml,zipFixture} from './ngii-fixture.mjs';

test('NGII district boundary dedupe, edition refresh, and requested resume',()=> {
  const a=normalizeSheet(rawSheet,'서대문구'), b=normalizeSheet(rawSheet,'종로구');
  const prior={...a,status:'requested'};
  const merged=mergeSheets([[a],[b]],[prior]);
  assert.equal(merged.length,1);assert.equal(merged[0].status,'requested');
  assert.deepEqual(merged[0].districts,['서대문구','종로구']);
  assert.equal(nextBatch(merged).length,0);
  const updated=normalizeSheet({...rawSheet,makeYer:'2026',gosiYer:'2026-1'},'종로구');
  assert.equal(mergeSheets([[updated]],[prior])[0].status,'pending');
  assert.throws(()=>mergeSheets([[a],[updated]]),/불일치/);
});

test('NGII counts detect missing and capped results before allowing download',()=> {
  const count=n=>({items:[{name:'수치지도 V2',cnt:n}]});
  checkInventory(count(2),[{},{}]);
  assert.throws(()=>checkInventory(count(3),[{},{}]),/누락/);
  assert.throws(()=>checkInventory(count(500),Array(500).fill({})),/누락/);
  assert.throws(()=>checkInventory({},[]),/누락/);
  const items=Array.from({length:205},()=>({status:'pending'}));
  assert.equal(nextBatch(items).length,100);
  for(const n of [0,101,1.5,NaN])assert.throws(()=>nextBatch(items,n));
});

test('NGII XML identifies edition without confusing spatial OBJECTID with metadata ID',()=> {
  const sheet=normalizeSheet(rawSheet,'서대문구');
  assert.equal(metadataMatches(xml,sheet),true);
  for(const replacement of [['수치지도2.0','수치지도1.0'],['1:1,000','1:5,000'],['2025-3996','2025-9999'],['서울2226','서울2227'],['376082071','376082072']]) {
    assert.equal(metadataMatches(xml.replace(...replacement),sheet),false);
  }
});

test('NGII downloaded file names cannot escape the output folder',()=> {
  assert.equal(safeFilename('(B010)수치지도_376082071_2025_123.zip'),'(B010)수치지도_376082071_2025_123.zip');
  for(const name of ['../x.zip','..\\x.zip','C:\\x.zip','x.zip:stream','CON.zip','a.exe','x.zip.'])assert.throws(()=>safeFilename(name));
  assert.throws(()=>safeFilename('map.ngi'));
  assert.equal(safeFilename('map.ngi',{allowNgi:true}),'map.ngi');
  assert.equal(safeFilename('map.nda',{allowNgi:true}),'map.nda');
  assert.throws(()=>safeFilename('../map.ngi',{allowNgi:true}));
});

test('NGII ISO export validates source citation and V2 catalogue without legacy fields',()=> {
  const sheet=normalizeSheet({...rawSheet,num:'377051353',name:'성동1353',gosiYer:'2026-0189'},'중랑구');
  assert.equal(metadataMatches(isoXml,sheet),true);
  const compactTitle=isoXml.replace(/수치지형도[^<]*?(?=\s*-\s*도엽번호)/,'수치지형도(시험지역)');
  assert.equal(metadataMatches(compactTitle,sheet),true,'Parenthesized region needs no separating space');
  assert.equal(metadataMatches(compactTitle.replace('377051353','377051354'),sheet),false);
  assert.equal(metadataMatches(compactTitle.replace('1/1,000','1/5,000'),sheet),false);
  for(const change of [['377051353','377051354'],['1/1,000','1/5,000'],['제작년도 : 2025','제작년도 : 2024'],
    ['2026-0189','2025-3996'],['수치지도 2.0','수치지도 1.0'],['제작년도 : 2025','촬영년도 : 2025']]) {
    assert.equal(metadataMatches(isoXml.replace(...change),sheet),false,change.join(' => '));
  }
  assert.equal(metadataMatches(isoXml,{...sheet,history:'1'}),false);
  const duplicated=isoXml.replace('</cit:CI_Citation>','<cit:otherCitationDetails><gco:CharacterString>제작년도 : 2025</gco:CharacterString></cit:otherCitationDetails></cit:CI_Citation>');
  assert.equal(metadataMatches(duplicated,sheet),false,'Conflicting/duplicate edition fields cannot be accepted');
});

test('NGII verifies ZIP CRC, sidecars, and resets missing or corrupted completed files',async t=> {
  const output=await fs.mkdtemp(path.join(os.tmpdir(),'zipview-ngii-test-'));
  t.after(()=>fs.rm(output,{recursive:true,force:true}));
  const stem='(B010)수치지도_376082071_2025_123', zip=path.join(output,`${stem}.zip`);
  const sheet=normalizeSheet(rawSheet,'서대문구');
  await fs.writeFile(zip,zipFixture());
  assert.match(await verifyZip(zip),/^[a-f0-9]{64}$/);
  await reconcileFiles([sheet],output);assert.equal(sheet.status,'pending');
  await fs.writeFile(path.join(output,`${stem}.xml`),xml);
  await reconcileFiles([sheet],output);assert.equal(sheet.status,'verified');
  const corrupt=zipFixture();corrupt[60]^=1;await fs.writeFile(zip,corrupt);
  await assert.rejects(verifyZip(zip));
  await reconcileFiles([sheet],output);assert.equal(sheet.status,'pending');
  await fs.writeFile(zip,zipFixture(['shp','dbf']));await assert.rejects(verifyZip(zip),/레이어/);
  await fs.writeFile(zip,zipFixture().subarray(0,70));await assert.rejects(verifyZip(zip));
});

test('manifest save retries transient Windows sharing conflicts without deleting the prior state',async t=> {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'zipview-ngii-write-'));
  t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await fs.rm(root,{recursive:true,force:true});});
  const filename=path.join(root,'manifest.json');
  await fs.writeFile(filename,'{"version":1}');
  const rename=fs.rename;let attempts=0;
  fs.rename=async(from,to)=> {
    attempts++;
    if(attempts<=2) {
      assert.equal(await fs.readFile(filename,'utf8'),'{"version":1}');
      assert.deepEqual(JSON.parse(await fs.readFile(from,'utf8')),{version:2});
      throw Object.assign(new Error('Windows file sharing'),{code:'EPERM'});
    }
    return rename(from,to);
  };
  try {await writeJson(filename,{version:2});}finally{fs.rename=rename;}
  assert.equal(attempts,3);assert.deepEqual(JSON.parse(await fs.readFile(filename,'utf8')),{version:2});
});
