import {xiOpeningCandidates} from './xi-unit-layout.js';

export const XI_COMPLEX_SITE='https://www.openstreetmap.org/way/359124892';
export const XI_COMPLEX_PALETTE=Object.freeze({glass:'#48616b',frame:'#e2e7e5',recess:'#6c797c',plinth:'#74777a'});

// Brochure-inspired fallback only. These widths and bay counts are not type plans.
export function referenceFacadeOpenings(building) {
  const p=building.points,area=p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length];return sum+a[0]*b[1]-b[0]*a[1];},0);
  const sign=area>=0?1:-1,openings=[];
  const edges=[];
  for(let i=1;i<p.length;i++) {
    const a=p[i-1],b=p[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(length<.01)continue;
    const previous=edges.at(-1);
    if(previous) {
      const u=previous[1].map((v,j)=>v-previous[0][j]),v=b.map((n,j)=>n-a[j]);
      if((u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*length)>.999) {previous[1]=b;continue;}
    }
    edges.push([a,b]);
  }
  for(const [a,b] of edges) {
    const length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(length<6)continue;
    const tangent=b.map((v,i)=>(v-a[i])/length),normal=[tangent[1]*sign,-tangent[0]*sign];
    const bearing=(Math.atan2(normal[0],-normal[1])*180/Math.PI+360)%360;
    const front=normal[1]>.15,units=Math.max(1,Math.round(length/12)),span=length/units;
    const bays=front?[[.2,2.1],[.5,3.4],[.8,1.7]]:[[.27,1.4],[.7,.95]];
    for(let unit=0;unit<units;unit++)for(const [fraction,nominalWidth] of bays) {
      const center=span*(unit+fraction),width=Math.min(nominalWidth,span*.23);
      openings.push({endpoints:[center-width/2,center+width/2].map(t=>a.map((v,i)=>v+tangent[i]*t)),
        bearing,widthMeters:width,sillMeters:front?.55:.9,heightMeters:front?1.9:1.45,
        mullions:front&&fraction===.5?2:1,recess:true,verified:false,widthSource:'unsurveyed-complex-style'});
    }
  }
  return openings;
}

function prepare205(building,center) {
  const p=building.points;
  building.xiLayout={front:[5,6],rear:[9,7]};
  const other={...building,points:[...p.slice(0,6),p[9],p[10],p[0]],layoutRole:'other-lines'};
  const wing={...building,points:[p[5],p[6],p[7],p[8],p[9],p[5]],layoutRole:'59A-lines-1-2',
    facadeOpenings:[1,2].flatMap(line=>xiOpeningCandidates(building,center,{line})),
    facadeFloorHeight:building.height/building.levels};
  building.parts=[other,wing];
}

export function applyXiComplexFacades(data) {
  const buildings=data.buildings.filter(b=>b.siteSource===XI_COMPLEX_SITE&&b.kind==='apartments'&&/^2(0[1-9]|1[0-4])$/.test(b.name));
  for(const b of buildings) {
    if(b.id===608374571)prepare205(b,data.center);
    const partialPlan=b.id===data.targetBuildingId||b.id===608374571;
    b.facadeEvidence={status:partialPlan?'partial-plan':'reference-pattern',verified:false,
      description:partialPlan?`1·2라인: ${b.xiPlanId??'59A'} 도면 비례 후보 · 나머지: 조감도 참고 추정`:'조감도 참고 입면 · 타입별 창 치수 미확보',
      reference:'research/gyeonghuigung-xi/images/site-r1472-043.jpg'};
    for(const volume of b.parts??[b]) {
      volume.facadePalette=XI_COMPLEX_PALETTE;
      if(volume.facadeOpenings===undefined)volume.facadeOpenings=referenceFacadeOpenings(volume);
    }
  }
  data.facadeCoverage={buildings:buildings.length,partialPlan:buildings.filter(b=>b.facadeEvidence.status==='partial-plan').length,
    referencePattern:buildings.filter(b=>b.facadeEvidence.status==='reference-pattern').length,verified:0};
  return data.facadeCoverage;
}
