export function correctionQueries(target){
  return [...new Set([
    `${target.district} ${target.name}`,
    target.name,
    String(target.address??'').replace(/^서울(?:특별시|시)?\s+\S+구\s+/,''),
  ].filter(Boolean))];
}

export function collectionGaps(target){
  const gaps=[];
  if(!target.providerId)gaps.push(target.reason||'provider-not-linked');
  else{
    if(!target.types)gaps.push('no-plan-types');
    if((target.typesWithImages??0)<(target.types??0))gaps.push('missing-plan-images');
    if(!target.units)gaps.push('missing-unit-chart');
    else if((target.unitsWithPlans??0)<target.units)gaps.push('units-without-plan-image');
    if(target.providerHouseholds&&target.units!==target.providerHouseholds)gaps.push('provider-household-count-mismatch');
    if(target.expectedHouseholds&&target.units!==target.expectedHouseholds)gaps.push('inventory-household-count-mismatch');
    if(target.sourceErrors?.length)gaps.push('provider-source-errors');
  }
  return gaps;
}

export function correctedTarget(previous,next){
  // A worse provider response must not erase images or unit links already obtained.
  const regression=(previous.images??0)>(next.images??0)||(previous.unitsWithPlans??0)>(next.unitsWithPlans??0);
  const result=regression?{...previous}:{...previous,...next};
  if(!regression){delete result.reason;delete result.candidates;if(next.reason)result.reason=next.reason;if(next.candidates)result.candidates=next.candidates;}
  result.correction={at:new Date().toISOString(),previousStatus:previous.status,resultStatus:next.status,
    preservedPrevious:regression,reason:next.reason??null,previousImages:previous.images??0,
    previousUnitsWithPlans:previous.unitsWithPlans??0};
  result.gaps=collectionGaps(result);
  return result;
}
