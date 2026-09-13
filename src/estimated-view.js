import {geographicPoint,insideFootprint,eyeElevation} from './outlook-math.js';

// A terrain-derived base is usable before the finished first-floor datum is
// surveyed. Keep that distinction in data, rather than gating rendering on it.
export function estimateElevation(geometry,floor,{floorHeight=2.9,eyeHeight=1.5,offset=0}={}){
  if(!geometry||!Number.isFinite(geometry.base)||!Number.isInteger(floor)||floor<1)throw new Error('Invalid elevation inputs');
  if(geometry.levels&&floor>geometry.levels)throw new Error('Floor exceeds building levels');
  if(!Number.isFinite(floorHeight)||floorHeight<=0||!Number.isFinite(eyeHeight)||!Number.isFinite(offset))throw new Error('Invalid observer heights');
  return {ground:geometry.base,firstFloor:geometry.base+offset,floor,floorHeight,eyeHeight,offset,
    floorElevation:eyeElevation(geometry.base,floor,floorHeight,offset,0),
    eyeElevation:eyeElevation(geometry.base,floor,floorHeight,offset,eyeHeight),
    buildingHeight:geometry.height,roofElevation:geometry.base+geometry.height,
    groundSource:geometry.baseSource??(geometry.scene?.includes('sinchon-prugio')?'ngii-contour-interpolation':'mapzen-terrarium-dem'),
    floorHeightSource:floorHeight===2.9?'assumed-2.9m-like-xi-204':'user-adjusted-assumption',firstFloorSource:'terrain-base-plus-offset',verified:false};
}

export function facadeCandidates(geometry){
  const polygons=(geometry.parts??[geometry]).map(p=>p.points),result=[];
  for(const [part,points] of polygons.entries()){
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
      if(length<2)continue;
      const mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];let normal=[-dz/length,dx/length];
      if(insideFootprint([mid[0]+normal[0]*.1,mid[1]+normal[1]*.1],points))normal=normal.map(v=>-v);
      const point=[mid[0]+normal[0]*.8,mid[1]+normal[1]*.8];
      if(polygons.some(p=>insideFootprint(point,p)))continue;
      result.push({id:`${part}:${i}`,part,edge:i,a,b,length,normal,point,
        bearing:(Math.atan2(normal[0],-normal[1])*180/Math.PI+360)%360});
    }
  }
  return result;
}

export function estimateFacade(geometry,{bearing,unit,lines=[]}={}){
  let candidates=facadeCandidates(geometry);
  if(!candidates.length)throw new Error('No exterior facade');
  // A narrow end wall of a slab block is rarely the apartment frontage. For
  // the fallback only, choose among the broad faces before ranking direction.
  if(!Number.isFinite(bearing)){
    const longest=Math.max(...candidates.map(c=>c.length));
    candidates=candidates.filter(c=>c.length>=longest*.5);
  }
  const angle=Number.isFinite(bearing)?bearing:180;
  // Prefer broad external faces. South is only a fallback hypothesis, never a
  // claim about a household's living-room orientation.
  const score=c=>c.length*(.15+Math.max(0,Math.cos((c.bearing-angle)*Math.PI/180)));
  candidates.sort((a,b)=>score(b)-score(a)||a.id.localeCompare(b.id));
  const chosen=candidates[0],line=Number(unit)%100;
  const index=lines.indexOf(line),fraction=index>=0?(index+.5)/lines.length:.5;
  const point=chosen.a.map((v,i)=>v+(chosen.b[i]-v)*fraction+chosen.normal[i]*.8);
  const outside=!(geometry.parts??[geometry]).some(p=>insideFootprint(point,p.points));
  const selected=outside?point:chosen.point;
  return {...geographicPoint(...selected,geometry.center),point:selected,bearing:chosen.bearing,edge:chosen.id,
    method:Number.isFinite(bearing)?'source-bearing-exterior-edge-estimate':'broad-south-facing-edge-estimate',
    linePlacement:index>=0?'equal-spacing-hypothesis':'facade-midpoint',verified:false};
}

export function attachEstimatedViews(catalog){
  const reports=[];
  for(const building of catalog.buildings){
    const geometry=building.geometry;if(!geometry?.points||!geometry.scene||!Number.isFinite(geometry.base))continue;
    const units=catalog.units.filter(u=>u.complexId===building.complexId&&u.building===building.building&&!u.scenario&&u.status!=='conflict');
    const lines=[...new Set(units.map(u=>Number(u.unit)%100))].sort((a,b)=>a-b);
    const report={complexId:building.complexId,building:building.building,ground:geometry.base,height:geometry.height,levels:geometry.levels,sourceUnits:units.length,estimatedUnits:0,errors:[]};
    for(const u of units){
      try{
        u.elevation=estimateElevation(geometry,Math.floor(Number(u.unit)/100));
        u.estimatedWindow=estimateFacade(geometry,{bearing:u.placement?.bearing,unit:u.unit,lines});
        u.estimatedViewReady=true;
        u.estimatedPreview=`/?${new URLSearchParams({site:'outlook',address:u.complexId,building:u.building,unit:u.unit})}`;
        report.estimatedUnits++;
      }catch(e){report.errors.push({unit:u.unit,reason:e.message});}
    }
    reports.push(report);
  }
  catalog.estimatedViewReport=reports;
  catalog.coverage.estimatedViews=reports.reduce((n,r)=>n+r.estimatedUnits,0);
  return reports;
}
