import {geographicPoint} from './outlook-math.js';

// User-requested map-right placement, one metre short of the east corner.
export function xiRightEndWindow(building, facade, center) {
  const a=building.points[facade.edge],b=building.points[facade.edge+1];
  const length=Math.hypot(b[0]-a[0],b[1]-a[1]);
  const inset=Math.min(1,length/2);
  const fraction=b[0]>a[0]?1-inset/length:inset/length;
  const yaw=facade.bearing*Math.PI/180;
  const point=[a[0]+(b[0]-a[0])*fraction+Math.sin(yaw)*.2,
    a[1]+(b[1]-a[1])*fraction-Math.cos(yaw)*.2];
  return {id:'right-end',point,...geographicPoint(...point,center),bearing:facade.bearing,
    fraction,cornerInsetMeters:inset,verified:false};
}

// Conditional fit: two adjacent 59A fronts on the SE wall. Neither unit order
// nor the expanded plan is verified. Preserve both possible living-room positions.
export function xiWindowCandidates(building, facade, center) {
  const a=building.points[facade.edge], b=building.points[facade.edge+1];
  const dx=b[0]-a[0], dz=b[1]-a[1];
  const length=Math.hypot(dx,dz), yaw=facade.bearing*Math.PI/180;
  const normal=[Math.sin(yaw),-Math.cos(yaw)];
  const planWidth=3.510+3.800+3.215;
  const livingCenter=(3.510+3.800/2)/planWidth;
  return [livingCenter/2,1-livingCenter/2].map((fraction,index)=>{
    const point=[a[0]+dx*fraction+normal[0]*.2,a[1]+dz*fraction+normal[1]*.2];
    return {id:index===0?'southwest':'northeast',fraction,point,...geographicPoint(...point,center),
      bearing:facade.bearing,alongWallMeters:length*fraction,clearanceMeters:.2,
      mirroredPlanShiftMeters:length/2*Math.abs(1-2*livingCenter),verified:false};
  });
}
