import * as THREE from 'three';
import {xiFacadeEdges,xiOpeningCandidates,XI_PLAN_SCALE} from './xi-unit-layout.js';
import {getXiPlan} from './xi-plans.js';

export const PLAN_BOUNDS={left:898,right:1365,top:134,bottom:572};
// Schematic partitions read from the expanded reference plan. Door gaps are
// explicit; wet rooms and facade setbacks remain approximate.
export const PARTITIONS=[
  [1052,180,1052,250],[1052,295,1052,315],
  [898,315,1010,315],[898,380,1052,380],
  [1052,380,1052,465],[1052,515,1052,572],
  [1225,365,1225,390],[1225,435,1225,572],
  [1225,245,1365,245],[1225,245,1225,315],
  [1225,365,1250,365],[1300,365,1365,365],
];
export function planToWorld(building,line,mirrored,[px,py]) {
  const {front,rear}=xiFacadeEdges(building);
  const plan=getXiPlan(building),scale=plan.scale,bounds=plan.bounds;
  const u=(px-scale.left)/(scale.right-scale.left);
  const f=(line===1?.5:0)+(mirrored?1-u:u)*.5;
  const t=(py-bounds.top)/(bounds.bottom-bounds.top);
  return [0,1].map(i=>(rear[0][i]+(rear[1][i]-rear[0][i])*f)*(1-t)+(front[0][i]+(front[1][i]-front[0][i])*f)*t);
}
export function validPlanPoint([x,y],building) {
  const plan=getXiPlan(building),b=plan.bounds;
  if(x<b.left+12||x>b.right-12||y<b.top+12||y>b.bottom-12)return false;
  return plan.partitions.every(([ax,ay,bx,by])=>{
    const t=Math.max(0,Math.min(1,((x-ax)*(bx-ax)+(y-ay)*(by-ay))/((bx-ax)**2+(by-ay)**2)));
    return Math.hypot(x-ax-t*(bx-ax),y-ay-t*(by-ay))>10;
  });
}
export function canMovePlan(a,b,building) {
  const n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/4));
  for(let i=1;i<=n;i++)if(!validPlanPoint(a.map((v,k)=>v+(b[k]-v)*i/n),building))return false;
  return true;
}
function boxBetween(group,a,b,bottom,height,thickness,material) {
  if(height<=0)return;
  const dx=b[0]-a[0],dz=b[1]-a[1];
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(dx,dz),height,thickness),material);
  mesh.position.set((a[0]+b[0])/2,bottom+height/2,(a[1]+b[1])/2);
  mesh.rotation.y=-Math.atan2(dz,dx);group.add(mesh);return mesh;
}
function slab(group,points,y,depth,material) {
  if(depth<=0||points.length<3)return;
  const shape=new THREE.Shape(points.map(([x,z])=>new THREE.Vector2(x,-z)));
  const geometry=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false});geometry.rotateX(-Math.PI/2);geometry.translate(0,y,0);
  group.add(new THREE.Mesh(geometry,material));
}
export function buildXiInterior(target,center,{line,mirrored,floor,floorHeight,offset}) {
  const group=new THREE.Group();
  const wallMat=new THREE.MeshStandardMaterial({color:'#ede9df',roughness:.9,side:THREE.DoubleSide});
  const floorMat=new THREE.MeshStandardMaterial({color:'#c5aa86',roughness:.85});
  const frameMat=new THREE.MeshStandardMaterial({color:'#454c4b',roughness:.55});
  const shellMat=new THREE.MeshStandardMaterial({color:'#bbd5d3',roughness:.9,side:THREE.DoubleSide});
  const map=p=>planToWorld(target,line,mirrored,p);
  const plan=getXiPlan(target),{left:l,right:r,top:t,bottom:b}=plan.bounds;
  const polygon=[[l,t],[r,t],[r,b],[l,b]].map(map);
  const base=target.base+offset+(floor-1)*floorHeight;
  const ceiling=Math.min(2.55,floorHeight-.15);
  slab(group,polygon,base-.15,.15,floorMat);
  slab(group,polygon,base+ceiling,.15,wallMat);
  // Keep the rest of the host building solid, including the neighbouring line.
  for(const part of target.parts.filter(p=>p.layoutRole==='other-lines'))slab(group,part.points,target.base,part.height,shellMat);
  const otherLine=line===1?2:1;
  slab(group,[[l,t],[r,t],[r,b],[l,b]].map(p=>planToWorld(target,otherLine,mirrored,p)),target.base,target.parts[1].height,shellMat);
  slab(group,polygon,target.base,Math.max(0,base-target.base-.15),shellMat);
  const roof=target.base+target.parts[1].height;
  slab(group,polygon,base+ceiling+.15,Math.max(0,roof-base-ceiling-.15),shellMat);
  for(const [ax,ay,bx,by] of plan.partitions)boxBetween(group,map([ax,ay]),map([bx,by]),base,ceiling,.12,wallMat);
  for(const x of [l,r])boxBetween(group,map([x,t]),map([x,b]),base,ceiling,.18,wallMat);
  const openings=xiOpeningCandidates(target,center,{line,mirrored});
  // The facade is assembled around apertures, not a transparent solid wall.
  for(const side of ['front','rear']) {
    const y=side==='front'?b:t,a=map([l,y]),end=map([r,y]);
    const length=Math.hypot(end[0]-a[0],end[1]-a[1]);
    const at=d=>a.map((v,i)=>v+(end[i]-v)*d/length);
    const spans=openings.filter(w=>w.side===side).map(w=>{
      const d=((w.wall[0]-a[0])*(end[0]-a[0])+(w.wall[1]-a[1])*(end[1]-a[1]))/length;
      return {lo:Math.max(0,d-w.widthMeters/2),hi:Math.min(length,d+w.widthMeters/2),w};
    }).sort((a,b)=>a.lo-b.lo);
    let cursor=0;
    for(const {lo,hi,w} of spans){
      boxBetween(group,at(cursor),at(lo),base,ceiling,.18,wallMat);
      const top=Math.min(ceiling-.1,w.sillMeters+w.heightMeters);
      boxBetween(group,at(lo),at(hi),base,w.sillMeters,.18,wallMat);
      boxBetween(group,at(lo),at(hi),base+top,ceiling-top,.18,wallMat);
      for(const d of [lo,(lo+hi)/2,hi])boxBetween(group,at(d-.025),at(d+.025),base+w.sillMeters,top-w.sillMeters,.12,frameMat);
      for(const h of [w.sillMeters,top])boxBetween(group,at(lo),at(hi),base+h-.025,.05,.12,frameMat);
      cursor=hi;
    }
    boxBetween(group,at(cursor),end,base,ceiling,.18,wallMat);
  }
  group.userData={base,ceiling,openings:openings.length,polygon};
  return group;
}
