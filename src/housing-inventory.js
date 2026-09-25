import {unitKey} from './unit-linkage.js';

// A displayed area is not a unit identity. Require the official inventory,
// complete building totals, unique provider type, and the provider's type total.
export function connectHousingInventory({snapshot,sites,plans,units,lineAssociations=[]}) {
  let output=units.map(u=>({...u}));
  const reports=[];
  for(const target of snapshot?.targets??[]){
    const site=sites.find(s=>s.id===target.id);
    if(!site?.inventoryComplete)continue;
    const rows=target.units.filter(u=>site.buildings.includes(u.building));
    const keys=new Set(rows.map(u=>unitKey(target.id,u.building,u.unit)));
    if(keys.size!==rows.length)throw new Error(`Duplicate official housing identity: ${target.id}`);
    const byUnit=new Map(),removed=new Set();
    for(const u of output)if(u.complexId===target.id){
      const key=unitKey(u.complexId,u.building,u.unit);
      if(!byUnit.has(key))byUnit.set(key,[]);
      byUnit.get(key).push(u);
    }
    const complete=site.facts.every(b=>rows.filter(u=>u.building===b.building).length===b.households);
    const report={complexId:target.id,officialUnits:rows.length,completeInventory:complete,corroborated:0,areaLinked:0,unresolved:[],conflicts:[]};
    const candidates=plans.filter(p=>p.complexId===target.id&&p.providerAreaId);
    const displayedArea=area=>Math.floor(area*100+1e-7);
    const officialCounts=new Map();
    for(const row of rows){const area=displayedArea(row.exclusiveArea);officialCounts.set(area,(officialCounts.get(area)??0)+1);}
    for(const row of rows){
      const key=unitKey(target.id,row.building,row.unit);
      const previous=byUnit.get(key)??[];
      const evidence={...row,source:snapshot.source,sourceFile:snapshot.sourceFile,sha256:snapshot.sha256};
      const areaMatches=candidates.filter(p=>Math.round(p.area*100)===displayedArea(row.exclusiveArea));
      const identities=new Set(areaMatches.map(p=>p.providerAreaId));
      const unique=identities.size===1;
      const plan=unique?(areaMatches.find(p=>p.variant==='basic'&&p.available)??areaMatches.find(p=>p.available)??areaMatches.find(p=>p.variant==='basic')??areaMatches[0]):null;
      const countAgrees=complete&&plan&&Number.isInteger(plan.providerHouseholds)&&plan.providerHouseholds===officialCounts.get(displayedArea(row.exclusiveArea));
      const linePlans=lineAssociations.filter(l=>l.complexId===target.id&&l.building===row.building&&l.line===Number(row.unit)%100)
        .map(l=>plans.find(p=>p.complexId===target.id&&p.id===l.planId));
      const lineAgrees=linePlans.every(p=>p?.providerAreaId===plan?.providerAreaId);
      const sourced=previous.filter(u=>u.providerEvidence||u.status?.startsWith('provider-')||u.status==='source-chart-transcription');
      if(sourced.length){
        for(const old of sourced){
          const existingPlan=plans.find(p=>p.complexId===target.id&&p.id===old.planId);
          // Provider per-unit evidence remains valid when price data omits other homes.
          const providerPlan=candidates.find(p=>p.providerAreaId===(old.providerEvidence?.areaId??existingPlan?.providerAreaId));
          old.officialUnit=evidence;
          if(providerPlan&&Math.round(providerPlan.area*100)!==displayedArea(row.exclusiveArea)){
            report.conflicts.push({building:row.building,unit:row.unit,reason:'official-provider-area-conflict'});
            output.push({...old,planId:null,status:'official-area-conflict',source:snapshot.source,officialUnit:evidence});
          }else report.corroborated++;
        }
        continue;
      }
      const matched=countAgrees&&lineAgrees;
      const old=previous.length===1?previous[0]:null;
      const oldPlan=old&&plans.find(p=>p.complexId===target.id&&p.id===old.planId);
      const corroboratesOld=matched&&oldPlan&&(oldPlan.displayType??oldPlan.id)===plan.displayType&&!old.scenario;
      const next={...(corroboratesOld?old:{}),complexId:target.id,building:row.building,unit:row.unit,
        floor:Math.floor(Number(row.unit)/100),line:Number(row.unit)%100,
        planId:matched?(corroboratesOld?old.planId:plan.id):null,
        source:snapshot.source,status:matched?'official-inventory-area-linked':'official-inventory-type-unresolved',
        officialUnit:evidence,supersededCandidates:previous.length&&!corroboratesOld?previous:undefined,typeEvidence:matched?{method:'official-inventory-unique-displayed-area-and-type-total',
          area:row.exclusiveArea,providerAreaId:plan.providerAreaId,providerArea:plan.area,
          providerHouseholds:plan.providerHouseholds,source:plan.source,lineSources:linePlans.length?lineAssociations.filter(l=>l.complexId===target.id&&l.building===row.building&&l.line===Number(row.unit)%100).map(l=>l.source):[]}:null};
      // Reconcile only historical candidates. Contradictory independently sourced
      // unit links above are retained as conflicts, never overwritten.
      for(const old of previous)removed.add(old);
      output.push(next);
      if(matched)report.areaLinked++;
      else report.unresolved.push({building:row.building,unit:row.unit,area:row.exclusiveArea,
        reason:!unique?'ambiguous-provider-area':!countAgrees?'type-total-unverified':'line-type-conflict',candidateTypes:[...new Set(areaMatches.map(p=>p.displayType))]});
    }
    output=output.filter(u=>!removed.has(u));
    reports.push(report);
  }
  return {units:output,reports};
}
