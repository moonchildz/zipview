import test from 'node:test';
import assert from 'node:assert/strict';
import {regionFor,partitionTargets,taskState,mapStageReady} from '../scripts/national-collection.mjs';
import {completeMapInventory} from '../scripts/national-inventory.mjs';
import {normalizeSheet,metadataMatches} from '../scripts/ngii-files.mjs';
import {rawSheet,xml} from './ngii-fixture.mjs';

test('route current and historical provider codes without dropping combined districts',()=>{
 assert.equal(regionFor('26110'),'busan');assert.equal(regionFor('12210'),'gwangju');assert.equal(regionFor('12110'),'jeonnam');assert.equal(regionFor('51110'),'gangwon');assert.equal(regionFor('42110'),'gangwon');assert.equal(regionFor('99999'),undefined);
});
test('bounded target jobs preserve all IDs, including last short batch',()=>{
 const points=Array.from({length:131},(_,id)=>({id})),chunks=partitionTargets(points);
 assert.deepEqual(chunks.map(x=>x.length),[64,64,3]);assert.deepEqual(chunks.flat(),points);assert.throws(()=>partitionTargets(points,0));
});
test('download success is not coverage success',()=>{
 const j={dataset:'satellite'},selected=[{id:'a'}],transfers={scenes:{a:{status:'downloaded-header-checked'}}};
 assert.equal(taskState(j,{plan:{selected,inventoryComplete:true,uncoveredCellIds:[]},transfers}),'files-verified');
 assert.equal(taskState(j,{plan:{selected,inventoryComplete:true,uncoveredCellIds:['gap']},transfers}),'coverage-gap');
 assert.equal(taskState(j,{plan:{selected,inventoryComplete:false,uncoveredCellIds:[]},transfers}),'coverage-gap');
 assert.notEqual(taskState({dataset:'maps'},{sheets:[]}),'files-verified');
});
test('reject other scales even when explicitly requested',()=>{
 assert.throws(()=>normalizeSheet({...rawSheet,num:'35913051',scale:'5000'},'sample',5000));
 const s=normalizeSheet(rawSheet,'sample');assert.ok(metadataMatches(xml,s));
 assert.equal(metadataMatches(xml.replace('1:1,000','1:5,000'),{...s,payload:{...s.payload,mapScale:'5000'}}),false);
});
test('all national maps precede satellite acquisition',()=>{
 const catalog=[{code:'a',status:'catalogued'},{code:'b',status:'pending'}];
 const jobs=[{id:'a',district:'a',dataset:'maps',scale:1000,availability:'available'}];
 assert.equal(mapStageReady([],[],{}),false);
 assert.equal(mapStageReady(catalog,jobs,{a:'files-verified'}),false);
 catalog[1].status='catalogued';assert.equal(mapStageReady(catalog,jobs,{a:'files-verified'}),false);
 jobs.push({id:'b',district:'b',dataset:'maps',scale:1000,availability:'not-provided'});
 assert.equal(mapStageReady(catalog,jobs,{a:'needs-review'}),false);
 assert.equal(mapStageReady(catalog,jobs,{a:'files-verified'}),true);
 jobs[0].rejectedCount=1;assert.equal(mapStageReady(catalog,jobs,{a:'files-verified'}),false);
});
test('capped inventory subdivides and deduplicates, unresolved leaves fail',async()=>{
 const count=n=>({items:[{name:'수치지도 V2',cnt:n}]}),row={scale:5000,num:'35913051',makeYer:2025,gosiYer:'x',historyNo:0};
 const initial={counts:count(600),items:[],area:{minx:0,miny:0,maxx:2000,maxy:2000,wkt:'saved'}};
 let calls=0;const result=await completeMapInventory(initial,async()=>++calls===1?{counts:count(600),items:[]}:{counts:count(1),items:[row]});
 assert.equal(result.items.length,1);assert.equal(result.leaves.length,4);
 await assert.rejects(()=>completeMapInventory(initial,async()=>({counts:count(600),items:[]}),{maxDepth:1}),/gap/);
});
