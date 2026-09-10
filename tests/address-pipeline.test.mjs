import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {extractPublicComplex,parseSearch,parseDongList,parseHoList} from '../scripts/kb-public-source.mjs';
import {chooseCandidate,splitAddressInput,createAddressPipeline} from '../scripts/address-pipeline.mjs';
const envelope=data=>({dataHeader:{resultCode:'10000'},dataBody:{resultCode:11000,data}});
const source={detail:{'단지기본일련번호':123,'단지명':'테스트단지','신주소':'부산 테스트길 10','구주소':'부산 테스트동 10','총세대수':2,'총동수':1,'wgs84경도':'129','wgs84위도':'35','호실정보존재여부':'1'},typeList:[{'단지기본일련번호':123,'면적일련번호':42,'전용면적':'84.91','공급면적':'111.5','주택형타입내용':'B','세대수':2,'방수':3,'욕실수':2}]};
const html=data=>`<script>self.__next_f.push(${JSON.stringify([1,'5:'+JSON.stringify({data})+'\n'])})</script>`;
test('public HTML is parsed without eval, preserving provider area IDs and image absence',()=>{
  const d=extractPublicComplex(html(source),123);assert.equal(d.plans[0].areaId,'42');assert.equal(d.plans[0].displayType,'84B');assert.deepEqual(d.plans[0].variants,[]);
  assert.throws(()=>extractPublicComplex(html(source),999),/identity mismatch/);
  assert.throws(()=>extractPublicComplex('<script>throw new Error("executed")</script>',123),/schema changed/);
});
test('dong/ho links require provider area identity, not a guessed matching area',()=>{
  const [dong]=parseDongList(envelope([{'동명':'209동','동일련번호':10}]));
  const rows=parseHoList(envelope([{'호명':'1201호','면적일련번호':42},{'호명':'1202호','면적일련번호':43}]),dong,new Set(['42']));
  assert.equal(rows[0].areaId,'42');assert.equal(rows[1].areaId,null);
  assert.deepEqual(parseDongList({dataHeader:{resultCode:'10000'},dataBody:{resultCode:33210}}),[]);
  assert.throws(()=>parseDongList({dataHeader:{resultCode:'403'}}),/refused/);
});
test('full input splits dong/ho, ambiguity never selects the first search hit',()=>{
  assert.deepEqual(splitAddressInput('서울 송월길 99 209동 1201호'),{address:'서울 송월길 99',building:'209',unit:'1201'});
  assert.deepEqual(splitAddressInput('서울 송월길 99'),{address:'서울 송월길 99'});
  assert.equal(chooseCandidate('자이',{total:2,candidates:[{name:'자이',providerId:'1'},{name:'자이',providerId:'2'}]}),null);
  assert.equal(chooseCandidate('자이',{total:25,candidates:[{name:'자이',providerId:'1'}]}),null);
  assert.equal(parseSearch(envelope({data:{HSCM:{totcnt:'0',data:[]}}})).total,0);
});
test('end-to-end code searches, extracts all units, saves, and reruns without network',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'zipview-address-'));let calls=0;
  const fetchImpl=async raw=>{
    calls++;const u=new URL(raw);let body;
    if(u.pathname.endsWith('/intgraSerch'))body=JSON.stringify(envelope({data:{HSCM:{totcnt:'1',data:[{COMPLEX_NO:'123',HSCM_NM:'테스트단지',NEWADDRESS:'부산 테스트길 10'}]}}}));
    else if(u.pathname==='/se/c/123')body=html(source);
    else if(u.pathname.endsWith('/dongList'))body=JSON.stringify(envelope([{'동명':'209동','동일련번호':10}]));
    else if(u.pathname.endsWith('/dongHoList'))body=JSON.stringify(envelope([{'호명':'1201호','면적일련번호':42},{'호명':'1202호','면적일련번호':42}]));
    else throw new Error('unexpected URL');
    return new Response(body);
  };
  try{
    const options={fetchImpl,cacheRoot:join(dir,'cache'),providerRoot:join(dir,'providers')};
    const first=await createAddressPipeline(options).run('부산 테스트길 10');assert.equal(first.complex.units.length,2);assert.equal(first.requests,4);
    assert.equal(JSON.parse(await readFile(join(dir,'providers/123.json'),'utf8')).plans[0].areaId,'42');
    const second=await createAddressPipeline(options).run('부산 테스트길 10');assert.equal(calls,4);assert.equal(second.requests,0);assert.equal(second.cacheHits,4);
  }finally{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));await rm(dir,{recursive:true,force:true});}
});
