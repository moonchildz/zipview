import {createHash} from 'node:crypto';
import {canonicalRoadAddress} from './address-pipeline.mjs';

const classes=new Set(['아파트','주상복합','도시형 생활주택(아파트)','도시형 생활주택(주상복합)']);
export function apartmentInventory(raw,previous=[]) {
  if(!Array.isArray(raw.DATA)||!raw.DESCRIPTION?.APT_CD)throw new Error('서울시 단지 목록 형식 불일치');
  const prior=new Map(previous.map(r=>[r.id,r])),seen=new Set(),targets=[],excluded=[];
  for(const row of raw.DATA) {
    const id=String(row.apt_cd??'');
    if(!id||seen.has(id))throw new Error('서울시 단지 ID 누락/중복: '+id);
    seen.add(id);
    const base={id,name:row.apt_nm,address:row.apt_rdn_addr,district:row.sgg_addr,category:row.cmpx_clsf,
      expectedHouseholds:Number(row.tnohsh)||null,expectedBuildings:Number(row.whol_dong_cnt)||null};
    if(!classes.has(row.cmpx_clsf)) {excluded.push({...base,reason:row.cmpx_clsf?'outside-apartment-scope':'classification-missing'});continue;}
    const identity=createHash('sha256').update(JSON.stringify(base)).digest('hex');
    const old=prior.get(id);
    const record=old?.identity===identity?{...old,...base}:{...base,identity,status:'pending',attempts:0};
    if(record.status==='running')record.status='pending';
    if(!/^서울(?:특별시|시)?\s/.test(base.address??'')) {record.status='review';record.reason='서울 도로명주소 미확인';}
    targets.push(record);
  }
  targets.sort((a,b)=>a.district.localeCompare(b.district,'ko')||a.id.localeCompare(b.id));
  return {targets,excluded};
}

export function collectionResult(result,target) {
  const c=result.complex;
  if(!c)return {status:result.status==='address-not-found'?'not-found':'review',reason:result.status,candidates:result.candidates??[]};
  if(canonicalRoadAddress(c.address)!==canonicalRoadAddress(target.address))return {status:'review',reason:'상세 주소 불일치'};
  const withImages=new Set(c.plans.filter(p=>p.variants.some(v=>v.file&&v.sha256)).map(p=>p.areaId));
  const images=new Set(c.plans.flatMap(p=>p.variants).filter(v=>v.file&&v.sha256).map(v=>v.sha256));
  const unitIds=new Set(c.units.map(u=>u.building+':'+u.unit));
  const linked=new Set(c.units.filter(u=>u.areaId&&withImages.has(u.areaId)).map(u=>u.building+':'+u.unit));
  const complete=c.plans.length>0&&withImages.size===c.plans.length&&c.errors.length===0
    &&unitIds.size===c.units.length&&c.households>0&&linked.size===c.households
    &&(!target.expectedHouseholds||linked.size===target.expectedHouseholds);
  return {status:complete?'collected':images.size?'partial':'no-plans',providerId:c.providerId,source:c.source,
    types:c.plans.length,typesWithImages:withImages.size,images:images.size,imageHashes:[...images],
    units:unitIds.size,unitsWithPlans:linked.size,providerHouseholds:c.households,
    supplementalSources:c.plans.flatMap(p=>(p.references??[]).map(r=>({areaId:p.areaId,...r}))),
    sourceErrors:c.errors,geographicPlacement:'not-verified',collectedAt:c.collectedAt};
}

export function apartmentSummary(state) {
  const targets=state.targets??[],byStatus={};
  for(const r of targets)byStatus[r.status]=(byStatus[r.status]??0)+1;
  const uniqueProviders=new Map(targets.filter(r=>r.providerId).map(r=>[r.providerId,r]));
  return {runStatus:state.runStatus,total:targets.length,processed:targets.filter(r=>!['pending','running'].includes(r.status)).length,
    attemptedTargets:targets.filter(r=>r.attempts>0).length,
    byStatus,uniqueProviders:uniqueProviders.size,withPlans:[...uniqueProviders.values()].filter(r=>r.images>0).length,
    uniqueImages:new Set([...uniqueProviders.values()].flatMap(r=>r.imageHashes??[])).size,
    unitsWithPlans:[...uniqueProviders.values()].reduce((n,r)=>n+(r.unitsWithPlans??0),0),
    excluded:state.excluded?.length??0,requests:state.network?.requests??0,cacheHits:state.network?.cacheHits??0,
    current:state.current??null,updatedAt:state.updatedAt,stopReason:state.stopReason??null};
}
