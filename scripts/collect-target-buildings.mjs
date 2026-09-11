import {mkdir,writeFile} from 'node:fs/promises';
import {hubPublicSession} from './hub-public-client.mjs';
import {load} from 'cheerio';
import {normalizeAddress} from '../src/address-input.js';

const page='/portal/gis/bld/idx-bld-list.do',session=await hubPublicSession(page);
const targets=[{id:'gyeonghuigung-xi',keyword:'송월길 99',address:'서울특별시 종로구 송월길 99',name:'경희궁자이'},
  {id:'sinchon-prugio',keyword:'북아현로1길 50',address:'서울특별시 서대문구 북아현로1길 50',name:'신촌푸르지오'}],results=[];
for(const target of targets){
  const rows=[];let expected=null;
  try{
    for(let pageIndex=1;pageIndex<=10;pageIndex++){
      const data=await session.post('/portal/gis/bld/select-bld-list.do',{srchType:'0',keyword:target.keyword,sidoCd:'all',sigunguCd:'',mainPrposCd:'all',strctCd:'all',pageIndex},{json:true});
      if(!Array.isArray(data.bldList))throw new Error('Building search schema changed');
      expected=data.paginationInfo?.totalRecordCount??null;
      rows.push(...data.bldList);
      if(!data.bldList.length||(expected!==null&&rows.length>=expected))break;
    }
    const fields=['bldrgstSeqno','bldNm','dongNm','addr','rdnmadr','lat','lng','sigunguCd','bjdongCd','mainPrposCdNm','strctCdNm','hhldCnt','grndFlrcnt','heig','totarea','pnu'];
    const buildings=rows.filter(row=>normalizeAddress(row.rdnmadr)===normalizeAddress(target.address)&&row.bldNm?.startsWith(target.name)&&/\(\d+동\)$/.test(row.bldNm)).map(row=>Object.fromEntries(fields.filter(k=>row[k]!==undefined).map(k=>[k,row[k]])));
    for(const building of buildings){
      const html=await session.post('/portal/gis/bld/idx-bld-detail.do',{bldrgstSeqno:building.bldrgstSeqno},{json:true,html:true}),dom=load(html);
      const tables=dom('table');
      const read=table=>dom(table).find('tr').map((i,row)=>[dom(row).children('th,td').map((i,c)=>dom(c).text().trim().replace(/\s+/g,' ')).get()]).get();
      const basic=read(tables[0]),floors=read(tables[1]);
      if(!basic.some(row=>row.includes(building.bldNm)))throw new Error('Official building detail identity mismatch');
      building.basic=basic;building.floors=floors;building.building=building.bldNm.match(/\((\d+)동\)$/)[1];
      const value=label=>{for(const row of basic){const i=row.indexOf(label);if(i>=0)return row[i+1];}return null;};
      building.heightMeters=Number(value('높이')?.replace(/[, m]/g,''))||null;
      building.households=Number(value('호수/가구수/세대수')?.match(/(\d+)세대/)?.[1])||null;
      building.levels=Number(value('층수')?.match(/지상 (\d+)층/)?.[1])||null;
      building.detailSource='https://www.hub.go.kr/portal/gis/bld/idx-bld-detail.do';
      console.log(`${target.id} ${building.building}: ${building.households} households, ${building.levels} floors, ${building.heightMeters}m`);
    }
    results.push({...target,status:expected!==null&&rows.length===expected?'complete-search':'partial-search',expected,buildings});
  }catch(e){results.push({...target,status:'failed',reason:e.message});}
}
await mkdir('research/linkage/downloads/hub',{recursive:true});
await writeFile('research/linkage/downloads/hub/target-buildings.json',JSON.stringify({source:'https://www.hub.go.kr'+page,checkedAt:new Date().toISOString(),targets:results},null,2)+'\n');
console.log(JSON.stringify(results.map(({buildings,...target})=>({...target,buildings:buildings?.length})),null,2));
