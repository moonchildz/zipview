import {geographicPoint} from './outlook-math.js';
import {xiOrientationDecision} from './xi-orientation-evidence.js';

// Image coordinates refer to the expanded drawing in reference-0.png.
// Only legible exterior glazed openings are included, not inferred bathroom vents.
export const XI_OPENINGS = [
  {id:'living',name:'거실',side:'front',pixel:[1142,572],segment:[1078,572,1206,572]},
  {id:'bedroom-front',name:'침실 · 전면',side:'front',pixel:[996,540],segment:[957,540,1035,540]},
  {id:'balcony',name:'침실 앞 발코니',side:'front',pixel:[1270,572],segment:[1240,572,1300,572]},
  {id:'bedroom-rear',name:'침실 · 후면',side:'rear',pixel:[983.5,180],segment:[938,180,1029,180]},
  {id:'kitchen',name:'주방',side:'rear',pixel:[1127,134],segment:[1103,134,1151,134]},
];

// Dimension chain printed under the expanded plan: 3510 + 3800 + 3215 mm.
export const XI_PLAN_SCALE = Object.freeze({left:898,right:1365,widthMeters:10.525});
export const XI_WINDOW_VERTICAL = Object.freeze({sillMeters:.6,heightMeters:1.8,verified:false});

const lerp=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const normal=(bearing)=>[Math.sin(bearing*Math.PI/180),-Math.cos(bearing*Math.PI/180)];

export function xiFacadeEdges(building) {
  const {front=[6,7],rear=[10,8]}=building.xiLayout??{};
  return {front:front.map(i=>building.points[i]),rear:rear.map(i=>building.points[i])};
}

export function xiFrontBearing(building) {
  const {front:[a,b]}=xiFacadeEdges(building);
  return (Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI+540)%360;
}

export function xiUnitPolygon(building,line=1) {
  if(![1,2].includes(line)) throw new RangeError('Unsupported Xi line');
  const {front,rear}=xiFacadeEdges(building),lo=line===1?.5:0,hi=lo+.5;
  return [lerp(...front,lo),lerp(...front,hi),lerp(...rear,hi),lerp(...rear,lo)];
}

export function xiOpeningCandidates(building,center,{line=1,mirrored}={}) {
  xiUnitPolygon(building,line);
  const decision=xiOrientationDecision(building,line);
  if(mirrored===undefined)mirrored=decision.mirrored;
  if(typeof mirrored!=='boolean')throw new Error('세대 좌우를 판정할 도면 근거가 부족합니다.');
  const edges=xiFacadeEdges(building),bearing=xiFrontBearing(building);
  return XI_OPENINGS.map(opening=>{
    const imageFraction=(opening.pixel[0]-XI_PLAN_SCALE.left)/(XI_PLAN_SCALE.right-XI_PLAN_SCALE.left);
    const fraction=(line===1?.5:0)+(mirrored?1-imageFraction:imageFraction)*.5;
    const edge=edges[opening.side],wall=lerp(...edge,fraction);
    const outward=opening.side==='front'?bearing:(bearing+180)%360;
    const n=normal(outward),point=wall.map((v,i)=>v+n[i]*.2);
    const length=Math.hypot(...edge[1].map((v,i)=>v-edge[0][i]));
    const tangent=edge[1].map((v,i)=>(v-edge[0][i])/length);
    const widthMeters=Math.abs(opening.segment[2]-opening.segment[0])*XI_PLAN_SCALE.widthMeters/(XI_PLAN_SCALE.right-XI_PLAN_SCALE.left);
    const endpoints=[-1,1].map(sign=>wall.map((v,i)=>v+sign*tangent[i]*widthMeters/2));
    return {...opening,line,fraction,wall,point,bearing:outward,...geographicPoint(...point,center),
      widthMeters,endpoints,...XI_WINDOW_VERTICAL,widthSource:'dimension-scaled-raster-estimate',
      orientationStatus:mirrored===decision.mirrored?decision.status:'manual-candidate',
      verified:false,placement:'plan-projected-to-osm-shell',clearanceMeters:.2};
  });
}

export function applyXiLayoutHypothesis(data) {
  const target=data.buildings.find(b=>b.id===data.targetBuildingId);
  const p=target.points;
  // Preserve the source footprint. Split its two adjoining volumes for rendering only.
  target.parts=[
    {...target,points:[...p.slice(0,7),p[10],p[11],p[0]],layoutRole:'other-lines'},
    {...target,points:[p[6],p[7],p[8],p[9],p[10],p[6]],height:target.height*18/21,levels:18,
      heightSource:'layout-18f-hypothesis',layoutRole:'59A-lines-1-2',facadeOpenings:[]},
  ];
  return target;
}
