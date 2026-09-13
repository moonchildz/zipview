import {createUnitIndex} from './unit-linkage.js';

export function resolveHomeSelection(catalog,address,building,unit){
  return homeSelection(createUnitIndex(catalog).resolve(address,building,unit));
}

export function homeSelection(result){
  if(!result.plan?.available||result.status==='conflict')return {error:'입력한 동·호에 연결된 평면도를 확인하지 못했습니다.',status:result.status,gaps:result.gaps};
  if(result.status==='image-line-candidate')return {error:'층별 호수 연결 근거가 없는 라인 후보입니다.',status:result.status};
  const type=result.plan.displayType??result.planId;
  return {building:result.building,unit:result.unit,type,floor:Math.floor(Number(result.unit)/100),line:Number(result.unit)%100,
    scenario:result.scenario??false,comparison:!!(result.comparisonPreset||result.scenario),status:result.status,sourceStatus:result.sourceStatus,source:result.source,
    plan:{...result.plan,id:type,imageFile:result.plan.file},placement:result.placement,estimatedPreview:result.estimatedPreview,elevation:result.elevation,
    orientation:result.placement?.bearing??null,mirrored:result.placement?.mirrored??null,viewReady:result.viewReady};
}
