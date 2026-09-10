import {xiFrontBearing} from './xi-unit-layout.js';

export const XI_PLAN_CROP=Object.freeze({x:850,y:90,width:560,height:545});

export function transformPlanPoint(matrix,[x,y]) {
  const [a,b,c,d,e,f]=matrix;
  return [a*x+c*y+e,b*x+d*y+f];
}

export function xiPlanOrientation(building,mirrored=false) {
  const bearing=xiFrontBearing(building),rotation=bearing-180;
  const angle=rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),sign=mirrored?-1:1;
  const {x,y,width,height}=XI_PLAN_CROP;
  const scale=656/Math.max(Math.abs(c)*width+Math.abs(s)*height,Math.abs(s)*width+Math.abs(c)*height);
  const a=c*sign*scale,b=s*sign*scale,cc=-s*scale,d=c*scale;
  const matrix=[a,b,cc,d,400-a*(x+width/2)-cc*(y+height/2),400-b*(x+width/2)-d*(y+height/2)];
  return {matrix,bearing,rotation,mirrored};
}
