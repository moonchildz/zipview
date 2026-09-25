import test from 'node:test';
import assert from 'node:assert/strict';
import {selectRequestedHistoryRows} from '../scripts/ngii-history.mjs';

test('history recovery selects only ready free requested 1:1000 V2 rows and deduplicates',()=>{
 const fixture=(number,{scale='1:1,000',product='수치지도V 2.0',ready=true,price=0}={})=>{
  const box={checked:true,disabled:false,dataset:{complate:String(ready)}};
  return {box,querySelectorAll:()=>['','',product,scale,'name',number].map(textContent=>({textContent})),
   querySelector:s=>s.startsWith('input')?box:{getAttribute:()=>`fn_pd_download('download.do',true,'request', '${price}');`}};
 };
 const rows=[fixture('111111111'),fixture('111111111'),fixture('222222222',{scale:'1:5,000'}),
  fixture('333333333',{ready:false}),fixture('444444444',{price:10}),fixture('555555555'),fixture('666666666',{product:'수치지도V1.0'})];
 const previous=globalThis.document;
 globalThis.document={querySelectorAll:s=>s==='tbody tr'?rows:rows.map(r=>r.box)};
 try{
  assert.deepEqual(selectRequestedHistoryRows({numbers:['111111111','222222222','333333333','444444444','666666666']}),{selected:1,numbers:['111111111']});
  assert.deepEqual(rows.map(r=>r.box.checked),[true,false,false,false,false,false,false]);
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
