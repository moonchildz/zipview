export const TARGET_SITES=[
  {id:'sinchon-prugio',name:'신촌푸르지오 2단지',address:'서울특별시 서대문구 북아현로1길 50',siteSource:'https://www.openstreetmap.org/way/463988053',buildings:Array.from({length:10},(_,i)=>String(201+i))},
  {id:'gyeonghuigung-xi',name:'경희궁자이 2단지',address:'서울특별시 종로구 송월길 99',siteSource:'https://www.openstreetmap.org/way/359124892',buildings:Array.from({length:14},(_,i)=>String(201+i))},
];

// Accept the explicit Korean dong suffix, but never extract arbitrary digits
// from labels such as a road address or a commercial annex.
export function buildingNumber(name){
  return String(name??'').trim().match(/^(\d+)\s*동?$/)?.[1]??null;
}

export function compileOfficialSites(snapshot){
  return TARGET_SITES.map(site=>{
    const input=snapshot?.targets.find(t=>t.id===site.id&&t.address===site.address),facts=[];
    for(const row of input?.buildings??[]){
      if(!site.buildings.includes(row.building))continue;
      if(facts.some(f=>f.building===row.building))throw new Error('Duplicate official building identity');
      if(!row.bldrgstSeqno||row.rdnmadr!==site.address||!row.detailSource||!Number.isInteger(row.households)||row.households<1||!Number.isInteger(row.levels)||row.levels<1||!Number.isFinite(row.heightMeters)||row.heightMeters<=0)throw new Error('Invalid official building record');
      facts.push({building:row.building,registryId:row.bldrgstSeqno,households:row.households,levels:row.levels,height:row.heightMeters,source:row.detailSource,checkedAt:snapshot.checkedAt});
    }
    return {...site,facts,inventoryComplete:input?.status==='complete-search'&&facts.length===site.buildings.length,
      expectedUnits:facts.length===site.buildings.length?facts.reduce((n,b)=>n+b.households,0):null};
  });
}

export function applyOfficialBuildingFacts(scene,sites){
  let applied=0;
  for(const site of sites)for(const fact of site.facts){
    const matches=scene.buildings.filter(b=>b.siteSource===site.siteSource&&buildingNumber(b.name)===fact.building);
    if(matches.length>1)throw new Error(`Ambiguous scene building ${site.id}/${fact.building}`);
    const b=matches[0];if(!b)continue;
    b.previousBuildingHeight??={height:b.height,levels:b.levels,source:b.heightSource};
    b.height=fact.height;b.levels=fact.levels;b.heightSource='official-building-register';b.officialBuilding=fact;applied++;
    for(const part of b.parts??[])if(part.inheritBuildingHeight)Object.assign(part,{height:fact.height,levels:fact.levels,heightSource:b.heightSource});
  }
  return applied;
}
