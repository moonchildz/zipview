// Pure, shared address/unit index. Identities are scoped by complex, never by dong alone.
import {normalizeAddress,addressKeys,splitAddressInput} from './address-input.js';
export {normalizeAddress} from './address-input.js';
const number = (value,suffix) => String(value ?? '').normalize('NFKC').trim().replace(new RegExp(`${suffix}$`),'').trim().replace(/^0+(?=\d)/,'');
export const unitKey = (complexId,building,unit) => JSON.stringify([complexId,number(building,'동'),number(unit,'호')]);
export const planImageCount = plans => new Set(plans.filter(p=>p.available).map(p=>p.file??`${p.complexId}/${p.id}`)).size;

export function providerComplexTarget(complexes,provider){
  const known=complexes.find(c=>c.kbId===provider.providerId||c.id===`kb:${provider.providerId}`);
  if(known)return known;
  const matches=complexes.filter(c=>provider.address&&normalizeAddress(c.address)===normalizeAddress(provider.address));
  return matches.length===1&&!matches[0].kbId?matches[0]:null;
}

export function compileLinkage({complexes,buildings=[],plans=[],units=[],lineAssociations=[],assets=[],inputs=[]}) {
  const unique = (rows,key,label) => {const m=new Map();for(const r of rows){const k=key(r);if(m.has(k))throw new Error(`Duplicate ${label}: ${k}`);m.set(k,r);}return m;};
  const cs=unique(complexes,c=>c.id,'complex');
  const bs=unique(buildings,b=>unitKey(b.complexId,b.building,''),'building');
  const ps=unique(plans,p=>`${p.complexId}/${p.id}`,'plan');
  for(const r of [...buildings,...plans])if(!cs.has(r.complexId))throw new Error(`Unknown complex: ${r.complexId}`);
  const buckets=new Map();
  for(const row of units){
    if(!cs.has(row.complexId)||!row.source)throw new Error('Unit requires known complex and source');
    const building=number(row.building,'동'),unit=number(row.unit,'호');
    if(!/^\d+$/.test(building)||!/^\d{3,5}$/.test(unit)||Number(unit)%100===0)throw new Error('Invalid unit identity');
    const key=unitKey(row.complexId,building,unit),r={...row,building,unit};
    if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(r);
  }
  const linked=[];
  for(const [key,records] of buckets){
    // Keep contradictory evidence; never let import order choose a plan/reflection.
    const signatures=new Set(records.map(r=>JSON.stringify([r.planId,r.exactVariant??null,r.scenario??false,r.placement??null])));
    const r=records[0],conflict=signatures.size>1;
    const b=bs.get(unitKey(r.complexId,r.building,''));
    const plan=ps.get(`${r.complexId}/${r.planId}`);
    const gaps=[];
    if(conflict)gaps.push('conflicting-unit-evidence');
    if(r.scenario)gaps.push('scenario-not-unit-evidence');
    if(!plan)gaps.push('plan-not-registered');
    else if(!plan.available)gaps.push('plan-file-missing');
    if(!b?.geometry)gaps.push('building-geometry-unlinked');
    if(!r.placement)gaps.push('orientation-unlinked');
    else if(!r.placement.automaticPlacement)gaps.push('orientation-unverified');
    gaps.push('floor-elevation-unverified','as-built-unverified');
    linked.push({...r,key,planId:conflict?null:r.planId,placement:conflict?null:r.placement??null,
      evidence:records,plan:conflict?null:plan??null,geometry:b?.geometry??null,gaps,
      sourceStatus:r.status??null,status:conflict?'conflict':r.scenario?'scenario-only':'linked',verified:false,viewReady:false,
      preview:conflict||!plan?.available?null:r.preview??null});
  }
  linked.sort((a,b)=>a.key.localeCompare(b.key));
  const issues=[...inputs.filter(i=>i.status==='missing').map(i=>({kind:'input-missing',source:i.path})),
    ...complexes.filter(c=>!linked.some(u=>u.complexId===c.id)).map(c=>({kind:'unit-chart-missing',complexId:c.id})),
    ...assets.filter(a=>!a.complexId).map(a=>({kind:'asset-unassigned',source:a.path})),
    ...linked.filter(u=>u.gaps.length).map(u=>({kind:'unit-gaps',key:u.key,gaps:u.gaps}))];
  for(const r of lineAssociations)if(!cs.has(r.complexId)||!r.source||!Number.isInteger(r.line)||r.line<1||r.line>99||!ps.has(`${r.complexId}/${r.planId}`))throw new Error('Invalid image line association');
  return {version:1,complexes,buildings,plans,units:linked,lineAssociations,assets,inputs,issues,
    coverage:{complexes:complexes.length,buildings:buildings.length,plans:plans.length,planImages:planImageCount(plans),assets:assets.length,
      complexesWithPlanImages:new Set(plans.filter(p=>p.available).map(p=>p.complexId)).size,
      complexesWithUnitLinks:new Set(linked.filter(u=>!u.scenario&&u.status!=='conflict').map(u=>u.complexId)).size,
      unitAssociations:linked.filter(u=>!u.scenario&&u.status!=='conflict').length,
      imageLineCandidates:lineAssociations.length,
      scenarios:linked.filter(u=>u.scenario).length,conflicts:linked.filter(u=>u.status==='conflict').length,
      previews:linked.filter(u=>u.preview&&!u.scenario).length,verifiedViews:0,
      missingInputs:inputs.filter(i=>i.status==='missing').length}};
}

export function createUnitIndex(catalog){
  const aliases=new Map(),units=new Map(catalog.units.map(u=>[u.key,u]));
  for(const c of catalog.complexes)for(const alias of [c.id,c.providerId,c.name,c.address,c.landAddress,...(c.aliases??[])])for(const key of addressKeys(alias)){
    if(!aliases.has(key))aliases.set(key,new Set());aliases.get(key).add(c.id);
  }
  const cs=new Map(catalog.complexes.map(c=>[c.id,c]));
  return {search(text){const q=normalizeAddress(text);return catalog.complexes.filter(c=>[c.id,c.name,c.address,c.landAddress,...(c.aliases??[])].some(s=>normalizeAddress(s).includes(q)));},
    resolve(address,building,unit){
      let request;try{request=splitAddressInput(address);}catch{return {status:'invalid-address',viewReady:false};}
      if((request.building&&building&&number(request.building,'동')!==number(building,'동'))||(request.unit&&unit&&number(request.unit,'호')!==number(unit,'호')))return {status:'invalid-input',viewReady:false};
      address=request.address;building=request.building??building;unit=request.unit??unit;
      const exact=aliases.get(normalizeAddress(address));
      const ids=[...(exact??new Set(addressKeys(address).flatMap(key=>[...(aliases.get(key)??[])])))];
      if(ids.length!==1)return {status:ids.length?'ambiguous-address':'address-not-registered',candidates:ids.map(id=>cs.get(id)),viewReady:false};
      const complex=cs.get(ids[0]),b=number(building,'동'),u=number(unit,'호');
      const availablePlans=catalog.plans.filter(p=>p.complexId===complex.id);
      if(!b&&!u)return {status:'complex-found',complex,availablePlans,viewReady:false};
      const phase=String(address).match(/([1-9])\s*단지/);
      if(phase&&complex.phaseBuildings?.[phase[1]]&&!complex.phaseBuildings[phase[1]].includes(b))return {status:'building-unlinked',complex,building:b,unit:u,availablePlans,viewReady:false,gaps:['phase-building-mismatch']};
      if(!/^\d+$/.test(b)||!/^\d{3,5}$/.test(u)||Number(u)%100===0)return {status:'invalid-input',complex,availablePlans,viewReady:false};
      const match=units.get(unitKey(complex.id,b,u));
      if(match)return {...match,complex,availablePlans};
      if(complex.officialInventory?.complete)return {status:'unit-not-found',complex,building:b,unit:u,availablePlans,viewReady:false,gaps:['unit-absent-from-complete-inventory']};
      const known=catalog.buildings.find(r=>r.complexId===complex.id&&r.building===b);
      if(known?.geometry?.levels&&Math.floor(Number(u)/100)>known.geometry.levels)return {status:'unit-unlinked',complex,building:b,unit:u,availablePlans,viewReady:false,gaps:['floor-above-building-levels']};
      const lines=(catalog.lineAssociations??[]).filter(r=>r.complexId===complex.id&&r.building===b&&r.line===Number(u)%100);
      if(lines.length){
        const conflict=new Set(lines.map(r=>r.planId)).size>1;
        const r=lines[0],plan=catalog.plans.find(p=>p.complexId===complex.id&&p.id===r.planId);
        return {complex,building:b,unit:u,line:r.line,availablePlans,status:conflict?'conflict':'image-line-candidate',
          planId:conflict?null:r.planId,plan:conflict?null:plan,source:r.source,evidence:lines,
          verified:false,viewReady:false,preview:null,placement:null,
          gaps:conflict?['conflicting-unit-evidence']:['floor-exceptions-unverified','orientation-unlinked','floor-elevation-unverified','as-built-unverified']};
      }
      return {status:known?'unit-unlinked':'building-unlinked',complex,building:b,unit:u,availablePlans,viewReady:false,
        gaps:known?['unit-chart-missing-or-exception']:['building-crosswalk-missing'],
        environment:catalog.assets.filter(a=>a.complexId===complex.id&&a.role==='environment').map(a=>a.path)};
    }};
}
