import {inferPlanReflection} from './plan-reflection.js';
import {inferPlanRegistration} from './plan-registration.js';

// Original raster coordinates, X right / Y down. Tolerances are conservative
// reading margins, not statistical confidence or cadastral accuracy.
export const XI_PLAN_ENTRANCE=Object.freeze({
  source:'research/gyeonghuigung-xi/images/reference-0.png',
  center:[1131.5,353],entrance:[1259,243],tolerance:12,
});
// Reference-only originals are not redistributed with the application.
const source='https://s3.ap-northeast-2.amazonaws.com/zippoom-blueprint/1c0611ad-1ccd-488b-aa26-70017fdeee9a%EA%B2%BD%ED%9D%AC%EA%B6%81%EC%9E%90%EC%9D%B4.webp';
const lineSource='https://www.r1472.co.kr/_file/Group/21506081506430596_042.jpg';
export const XI_ORIENTATION_ANCHORS={
  608374570:{
    1:{source,lineSource,center:[1511,2084],core:[1454,2133],front:[1,0],tolerance:24},
    2:{source,lineSource,center:[1511,2191],core:[1454,2133],front:[1,0],tolerance:24},
  },
  608374571:{
    1:{source,lineSource,center:[960,2083],core:[899,2141],front:[1,0],tolerance:24},
    2:{source,lineSource,center:[960,2190],core:[899,2141],front:[1,0],tolerance:24},
  },
};

export function xiOrientationDecision(building,line) {
  const candidate=inferPlanReflection({plan:XI_PLAN_ENTRANCE,placement:XI_ORIENTATION_ANCHORS[building.id]?.[line]});
  // The existing topology is an exploratory candidate, not independent registration.
  const registration=inferPlanRegistration();
  return {...candidate,automaticPlacement:registration.automaticPlacement,registration};
}

export function xiLineOrientations(building) {
  return Object.fromEntries([1,2].map(line=>{
    const decision=xiOrientationDecision(building,line);
    if(decision.mirrored===null)throw new Error('세대 좌우를 판정할 도면 근거가 부족합니다.');
    return [line,decision.mirrored];
  }));
}
