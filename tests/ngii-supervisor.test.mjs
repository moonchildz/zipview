import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run=promisify(execFile);
test('supervisor obeys a stop marker without launching a portal browser',async()=>{
  const state=await fs.mkdtemp(path.join(os.tmpdir(),'zipview-supervisor-test-'));
  try{
    await fs.writeFile(path.join(state,'manifest.json'),JSON.stringify({scale:1000,sheets:[{sourceFormat:'ngi',status:'pending'}]}));
    await fs.writeFile(path.join(state,'STOP'),'');
    await run(process.execPath,['scripts/supervise-ngii.mjs','--state',state,'--inbox',state,'--output',state],
      {cwd:path.resolve('.'),timeout:10000});
    const status=JSON.parse(await fs.readFile(path.join(state,'supervisor.json'),'utf8'));
    assert.equal(status.phase,'stopped-by-user');
    assert.equal(status.restarts,0);
    assert.equal((await fs.readdir(state)).some(name=>name.startsWith('run-')),false);
  }finally{
    if(path.dirname(state)!==os.tmpdir())throw Error('Unexpected temporary test directory');
    await fs.rm(state,{recursive:true,force:true});
  }
});
