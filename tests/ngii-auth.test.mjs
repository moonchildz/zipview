import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureLogin} from '../scripts/ngii-browser.mjs';

test('expired automated session stops without opening another login window',async()=>{
  let calls=0;
  const page={isClosed:()=>false,evaluate:async()=>{calls++;return 'anonymous';}};
  await assert.rejects(ensureLogin(page,()=>false,{allowPrompt:false}),
    /collection paused without opening a login window/);
  assert.equal(calls,1);
});
