import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {reconcileRawNgi} from '../scripts/ngii-raw.mjs';
import {isoXml} from './ngii-fixture.mjs';

const sheet=()=>({number:'377051353',year:'2025',notice:'2026-0189',history:'0',
  status:'requested',payload:{mapScale:'1000'}});
const layer='$LAYER_NAME "building"\n<LAYER_START>\n$RECORD 1\n'+('field data\n'.repeat(15))+'<LAYER_END>\n';

async function withRawFiles(xml,action){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'zipview-ngi-test-'));
  const inbox=path.join(directory,'inbox'),output=path.join(directory,'output');
  await fs.mkdir(inbox);
  const stem='(B010)수치지도_377051353_2025_00001';
  const old=new Date(Date.now()-180000);
  try{
    for(const [ext,data] of [['ngi',layer],['nda',layer],['xml',xml]]){
      const filename=path.join(inbox,`${stem}.${ext}`);
      await fs.writeFile(filename,data);
      await fs.utimes(filename,old,old);
    }
    await action(inbox,output);
  }finally{
    if(path.dirname(directory)!==os.tmpdir())throw Error('Unexpected temporary test directory');
    await fs.rm(directory,{recursive:true,force:true});
  }
}

test('complete 1:1,000 NGI triplet is verified and preserved',async()=>{
  await withRawFiles(isoXml,async(inbox,output)=>{
    const sheets=[sheet()];
    assert.equal(await reconcileRawNgi(sheets,inbox,output),1);
    assert.equal(sheets[0].status,'verified');
    assert.equal(sheets[0].file.layers,1);
    assert.equal((await fs.readdir(output)).length,3);
  });
});

test('stable wrong metadata is recorded for review instead of hanging forever',async()=>{
  await withRawFiles(isoXml.replace('1/1,000','1/5,000'),async(inbox,output)=>{
    const sheets=[sheet()];
    assert.equal(await reconcileRawNgi(sheets,inbox,output),1);
    assert.equal(sheets[0].status,'review');
    assert.equal(sheets[0].review.reason,'raw-metadata-mismatch');
  });
});
