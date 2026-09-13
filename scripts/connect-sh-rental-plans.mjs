import {sinchonShTraces} from '../src/plan-traces/sinchon-sh.js';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// SH guide labels 34B explicitly for 203-dong. The official site blueprint
// labels 203's rental wing 49A / 34A / 34B; the sale chart and provider rows
// identify the respective lines. This override is confined to that wing.
const rules=[['29616','34A'],['75982','34B'],['179187','49A']];
export async function connectShRentalPlans(plans,units){
  const report=[];
  for(const [areaId,type] of rules){
    const trace=sinchonShTraces.find(t=>t.type===type),base=plans.find(p=>p.complexId===trace.complexId&&p.providerAreaId===areaId);
    if(!base)continue;
    const bytes=await readFile(trace.source.file).catch(()=>null);
    const available=!!bytes&&createHash('sha256').update(bytes).digest('hex')===trace.source.sha256;
    const id=`sh-rental-${type}`;
    plans.push({id,complexId:trace.complexId,displayType:type,variant:trace.variant,kind:'SH 임대형',
      area:base.area,supply:base.supply,file:trace.source.file,source:trace.source.url,available,model:false,
      scope:{buildings:['203'],providerAreaId:areaId},crop:trace.outline.reduce((r,p)=>({left:Math.min(r.left,p[0]),top:Math.min(r.top,p[1]),right:Math.max(r.right,p[0]),bottom:Math.max(r.bottom,p[1])}),{left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity})});
    let count=0;
    for(const unit of units){
      if(unit.complexId!==trace.complexId||unit.building!=='203')continue;
      const previous=plans.find(p=>p.complexId===unit.complexId&&p.id===unit.planId);
      if(previous?.providerAreaId!==areaId)continue;
      unit.planMappingEvidence={previousPlanId:unit.planId,providerAreaId:areaId,source:trace.source.url,sourceSha256:trace.source.sha256,
        layoutSource:'research/linkage/downloads/hub/sinchon-prugio.jpg',unitChart:'research/sinchon-prugio/images/site-and-units.jpg',
        reason:'203 rental wing has a different layout from the provider terrace-plan image'};
      // Missing/changed SH source withholds the corrected plan instead of falling
      // back to a known-wrong terrace model for this rental wing.
      unit.planId=id;count++;
    }
    report.push({building:'203',type,providerAreaId:areaId,source:trace.source.file,available,units:count});
  }
  return report;
}
