export const sourceBacked = u => !!u.officialUnit || !!u.providerEvidence || u.sourceStatus === 'source-chart-transcription' || u.sourceStatus?.startsWith('provider-');

export function unitCoverage(catalog){
  return catalog.complexes.map(c=>{
    const rows=catalog.units.filter(u=>u.complexId===c.id),known=rows.filter(sourceBacked);
    const lines=(catalog.lineAssociations??[]).filter(l=>l.complexId===c.id);
    const expected=c.officialInventory?.count??c.unitInventory?.count??c.providerHouseholds??c.households;
    const expectedUnits=Number.isInteger(expected)&&expected>0?expected:null;
    const linked=known.filter(u=>u.status!=='conflict'&&u.planId);
    const images=linked.filter(u=>u.plan?.available);
    const missing=known.filter(u=>u.status==='conflict'||!u.planId||!u.plan?.available);
    const countMismatch=expectedUnits!==null&&known.length!==expectedUnits;
    return {complexId:c.id,name:c.name,expectedUnits,inventorySource:c.unitInventory?.source??c.planSource??c.source??null,
      knownUnits:known.length,typeLinkedUnits:linked.length,unitsWithPlanImages:images.length,
      missingExpectedUnits:expectedUnits===null?null:Math.max(0,expectedUnits-known.length),countMismatch,
      unitCandidates:rows.length-known.length,lineCandidates:lines.length,
      completePlanLookup:expectedUnits!==null&&!countMismatch&&images.length===expectedUnits,
      missingUnits:missing.map(u=>({building:u.building,unit:u.unit,planId:u.planId,status:u.status,gaps:u.gaps})),
      buildings:[...new Set([...catalog.buildings.filter(b=>b.complexId===c.id).map(b=>b.building),...rows.map(u=>u.building),...lines.map(l=>l.building)])].sort((a,b)=>Number(a)-Number(b)).map(building=>({
        building,knownUnits:known.filter(u=>u.building===building).length,
        typeLinkedUnits:linked.filter(u=>u.building===building).length,
        unitsWithPlanImages:images.filter(u=>u.building===building).length,
        candidateLines:lines.filter(l=>l.building===building).map(l=>({line:l.line,planId:l.planId,source:l.source}))
      }))};
  });
}
