// Coordinates are manually read source-image anchors, not surveyed positions.
// Front direction fixes rotation; the entrance/core relation resolves reflection.
export function inferPlanReflection({plan,placement}={}) {
  const unknown=reason=>({status:'unknown',mirrored:null,verified:false,reason,candidates:[]});
  const point=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
  if(!plan?.source||!placement?.source||!placement.lineSource||!point(plan.entrance)||!point(plan.center)||
    !point(placement.center)||!point(placement.core)||!point(placement.front))return unknown('missing-source-anchors');
  if(!Number.isFinite(plan.tolerance)||plan.tolerance<0||!Number.isFinite(placement.tolerance)||placement.tolerance<0)return unknown('missing-reading-tolerance');
  const length=Math.hypot(...placement.front);
  if(length<1e-8)return unknown('missing-front-direction');
  const front=placement.front.map(n=>n/length),right=[front[1],-front[0]];
  const delta=placement.core.map((n,i)=>n-placement.center[i]);
  const coreAcross=delta.reduce((s,n,i)=>s+n*right[i],0);
  const coreForward=delta.reduce((s,n,i)=>s+n*front[i],0);
  const entranceAcross=plan.entrance[0]-plan.center[0];
  const entranceForward=plan.entrance[1]-plan.center[1];
  if(Math.abs(entranceAcross)<=plan.tolerance||Math.abs(coreAcross)<=placement.tolerance)return unknown('ambiguous-lateral-anchor');
  if(entranceForward>=-plan.tolerance||coreForward>=-placement.tolerance)return unknown('front-rear-conflict');
  const candidates=[false,true].map(mirrored=>({mirrored,
    entranceTowardCore:Math.sign(entranceAcross)*(mirrored?-1:1)===Math.sign(coreAcross)}));
  return {status:'inferred',mirrored:candidates.find(c=>c.entranceTowardCore).mirrored,verified:false,
    reason:'entrance-core-topology',candidates,measurements:{entranceAcross,coreAcross,entranceForward,coreForward},
    sources:[plan.source,placement.source,placement.lineSource]};
}
