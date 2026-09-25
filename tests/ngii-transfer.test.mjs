import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startTransferPopup,watchBrowserDownloads} from '../scripts/ngii-browser.mjs';

test('completed popup is not restarted by a new batch; reused window accepts a new document',async()=>{
 let clicks=0,onNavigation;const mainFrame={};
 const page={isClosed:()=>false,bringToFront:async()=>{},url:()=> 'https://map.ngii.go.kr/pd/purchs/download.do',
  on:(event,handler)=>{assert.equal(event,'framenavigated');onNavigation=handler;},mainFrame:()=>mainFrame,
  locator:()=>({count:async()=>0}),getByRole:()=>({count:async()=>1,isVisible:async()=>true,isEnabled:async()=>true,click:async()=>clicks++})};
 const context={pages:()=>[page]};
 await startTransferPopup(context,new WeakSet());
 await startTransferPopup(context,new WeakSet());assert.equal(clicks,1);
 onNavigation({});await startTransferPopup(context,new WeakSet());assert.equal(clicks,1,'Subframe navigation must not reset the download');
 onNavigation(mainFrame);await startTransferPopup(context,new WeakSet());assert.equal(clicks,2);
});

test('popup closing during inspection does not stop other transfers',async()=>{
 let closed=false,clicks=0;
 const disappearing={isClosed:()=>closed,url:()=> 'https://map.ngii.go.kr/pd/purchs/download.do',
  locator:()=>({count:async()=>{closed=true;throw Error('Target page, context or browser has been closed');}})};
 const active={isClosed:()=>false,url:()=> 'https://map.ngii.go.kr/pd/purchs/download.do',
  locator:()=>({count:async()=>0}),bringToFront:async()=>{},
  getByRole:()=>({count:async()=>1,isVisible:async()=>true,isEnabled:async()=>true,click:async()=>clicks++})};
 await startTransferPopup({pages:()=>[disappearing,active]},new WeakSet());
 assert.equal(clicks,1);
});

test('both NGII transfer URLs click once; unrelated or lookalike URLs never click',async()=>{
 const urls=['https://map.ngii.go.kr/pd/purchs/download.do?request=x','https://nlippd.ngii.go.kr/nlippd/pd/innorix/innorixdownLoad.do?request=x','https://nlippd.ngii.go.kr.evil.test/nlippd/pd/innorix/innorixdownLoad.do','https://map.ngii.go.kr/pd/purchs/download.do-other'];
 const clicked=[];const pages=urls.map(url=>({isClosed:()=>false,bringToFront:async()=>{},url:()=>url,locator:()=>({count:async()=>0}),getByRole:()=>({count:async()=>1,isVisible:async()=>true,isEnabled:async()=>true,click:async()=>clicked.push(url)})}));
 const attempted=new WeakSet();await startTransferPopup({pages:()=>pages},attempted);await startTransferPopup({pages:()=>pages},attempted);
 assert.deepEqual(clicked,urls.slice(0,2));
});

test('an open transfer overlay is left alone; a click race can retry next poll',async()=>{
 let overlay=true,clicks=0;
 const page={isClosed:()=>false,bringToFront:async()=>{},url:()=> 'https://map.ngii.go.kr/pd/purchs/download.do',
  locator:()=>({count:async()=>Number(overlay)}),
  getByRole:()=>({count:async()=>1,isVisible:async()=>true,isEnabled:async()=>true,click:async()=>{if(++clicks===1){const e=Error('overlay appeared');e.name='TimeoutError';throw e;}}})};
 const context={pages:()=>[page]},attempted=new WeakSet();
 await startTransferPopup(context,attempted);assert.equal(clicks,0);
 assert.equal(attempted.has(page),true);
 // A fresh document may be started, while the old overlay must stay handled.
 attempted.delete(page);overlay=false;await startTransferPopup(context,attempted);assert.equal(attempted.has(page),false);
 await startTransferPopup(context,attempted);assert.equal(attempted.has(page),true);assert.equal(clicks,2);
});

test('native start requires the configured destination and runs only once',async()=>{
 globalThis.__zipviewNgiiTransferInbox='C:/Downloads/map_all_01';
 try{
  let starts=0;let destination='C:/Downloads/wrong';
  const page={isClosed:()=>false,bringToFront:async()=>{},url:()=> 'https://nlippd.ngii.go.kr/nlippd/pd/innorix/innorixdownLoad.do',
   getByText:()=>({count:async()=>1,isVisible:async()=>true,isEnabled:async()=>true,click:async()=>starts++}),
   locator:()=>({innerText:async()=>destination+' (B010)map_376122044_2022_0001.zip'}),
   getByRole:()=>{throw Error('Must not restart an open native dialog');}};
  const attempted=new WeakSet(),context={pages:()=>[page]};
  await startTransferPopup(context,attempted);assert.equal(starts,0);
  destination='C:/Downloads/map_all_01';await startTransferPopup(context,attempted);await startTransferPopup(context,attempted);assert.equal(starts,1);
 }finally{delete globalThis.__zipviewNgiiTransferInbox;}
});

test('native start recognizes a verified NGI destination only in raw mode',async()=>{
 globalThis.__zipviewNgiiTransferInbox='C:/Downloads/map_all_01';
 let starts=0;
 const page={isClosed:()=>false,bringToFront:async()=>{},url:()=> 'https://nlippd.ngii.go.kr/nlippd/pd/innorix/innorixdownLoad.do',
  getByText:()=>({count:async()=>1,isVisible:async()=>true,isEnabled:async()=>true,click:async()=>starts++}),
  locator:()=>({innerText:async()=> 'C:/Downloads/map_all_01 (B010)map_376122044_2022_0001.ngi'}),
  getByRole:()=>{throw Error('Must not use the old dialog button');}};
 try{
  const context={pages:()=>[page]};
  await startTransferPopup(context,new WeakSet());assert.equal(starts,0);
  globalThis.__zipviewNgiiTransferRawFormat='ngi';
  await startTransferPopup(context,new WeakSet());await startTransferPopup(context,new WeakSet());assert.equal(starts,1);
 }finally{delete globalThis.__zipviewNgiiTransferInbox;delete globalThis.__zipviewNgiiTransferRawFormat;}
});

test('identical browser re-download does not stop collection or overwrite the original',async()=>{
 const output=await fs.mkdtemp(path.join(os.tmpdir(),'zipview-transfer-test-'));
 const filename='(B010)수치지도_376121860_2015_123.ngi',data=Buffer.from('same original file');
 let handler;const errors=[];
 const page={on:(event,listener)=>{if(event==='download')handler=listener;},off:()=>{}};
 const context={pages:()=>[page],on:()=>{},off:()=>{}};
 try{
  await fs.writeFile(path.join(output,filename),data);
  const drain=watchBrowserDownloads(context,output,error=>errors.push(error),{allowNgi:true});
  handler({suggestedFilename:()=>filename,saveAs:async target=>fs.writeFile(target,data),failure:async()=>null});
  await drain();drain.dispose();
  assert.deepEqual(errors,[]);
  assert.deepEqual(await fs.readFile(path.join(output,filename)),data);
  assert.deepEqual(await fs.readdir(output),[filename]);
 }finally{
  if(path.dirname(output)!==os.tmpdir())throw Error('Unexpected temporary test directory');
  await fs.rm(output,{recursive:true,force:true});
 }
});
