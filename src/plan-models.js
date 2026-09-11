import {sinchonTraces} from './plan-traces/sinchon.js';
import {models as legacyModels} from './models.js';

export const planTraces=sinchonTraces;
const finitePoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
export function pointInPlan(p,outline){
  let inside=false;
  for(let i=0,j=outline.length-1;i<outline.length;j=i++){
    const a=outline[i],b=outline[j];
    if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
export function wallSegments(model){
  return [...model.outline.map((a,i)=>[a,model.outline[(i+1)%model.outline.length]]),
    ...model.walls.flatMap(path=>path.slice(1).map((b,i)=>[path[i],b]))].filter(([a,b])=>distance(a,b)>.001);
}
export function openingOnWall(w,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],len2=dx*dx+dy*dy;
  if(len2<.001)return null;
  const t=p=>((p[0]-a[0])*dx+(p[1]-a[1])*dy)/len2;
  const on=p=>Math.abs((p[0]-a[0])*dy-(p[1]-a[1])*dx)/Math.sqrt(len2)<.01&&t(p)>=-1e-7&&t(p)<=1+1e-7;
  return on(w.a)&&on(w.b)?{...w,t1:Math.min(t(w.a),t(w.b)),t2:Math.max(t(w.a),t(w.b))}:null;
}
export function validatePlanTrace(trace){
  const errors=[];
  if(!trace?.id||!trace.complexId||!trace.source?.file||!/^\w{64}$/.test(trace.source?.sha256??''))errors.push('missing-source-identity');
  const size=trace?.source?.imageSize;
  if(!finitePoint(size)||size.some(n=>n<=0))return [...errors,'invalid-image-size'];
  const valid=p=>finitePoint(p)&&p.every((n,i)=>n>=0&&n<=size[i]);
  if(!Array.isArray(trace.outline)||trace.outline.length<3||trace.outline.some(p=>!valid(p)))return [...errors,'invalid-outline'];
  if(!Array.isArray(trace.walls)||trace.walls.some(path=>!Array.isArray(path)||path.length<2||path.some(p=>!valid(p))))return [...errors,'invalid-walls'];
  if(!Array.isArray(trace.windows)||!trace.windows.length)return [...errors,'missing-openings'];
  const ids=new Set(),segments=wallSegments(trace);
  for(const w of trace.windows){
    if(!w.id||ids.has(w.id))errors.push(`duplicate-opening:${w.id}`);ids.add(w.id);
    if(!valid(w.a)||!valid(w.b)||!valid(w.inside)||distance(w.a,w.b)<1){errors.push(`invalid-opening:${w.id}`);continue;}
    if(!pointInPlan(w.inside,trace.outline))errors.push(`outside-room-anchor:${w.id}`);
    const matches=segments.filter(([a,b])=>openingOnWall(w,a,b));
    if(matches.length!==1)errors.push(`opening-wall-count:${w.id}:${matches.length}`);
    const cross=(w.b[0]-w.a[0])*(w.inside[1]-w.a[1])-(w.b[1]-w.a[1])*(w.inside[0]-w.a[0]);
    if(Math.abs(cross)/distance(w.a,w.b)<2)errors.push(`ambiguous-room-side:${w.id}`);
  }
  for(const [a,b] of segments){
    const windows=trace.windows.map(w=>openingOnWall(w,a,b)).filter(Boolean).sort((x,y)=>x.t1-y.t1);
    if(windows.some((w,i)=>i&&w.t1<windows[i-1].t2-1e-7))errors.push('overlapping-openings');
  }
  if(trace.rooms?.some(r=>!valid(r.point)||!pointInPlan(r.point,trace.outline)||!finitePoint(r.look)))errors.push('invalid-room');
  if(trace.dimension&&(!trace.dimension.pixels?.every(valid)||!Number.isFinite(trace.dimension.meters)||trace.dimension.meters<=0||distance(...trace.dimension.pixels)<1))errors.push('invalid-dimension');
  return errors;
}
export function traceModel(trace){
  const xs=trace.outline.map(p=>p[0]),ys=trace.outline.map(p=>p[1]);
  const width=Math.max(...xs)-Math.min(...xs),depth=Math.max(...ys)-Math.min(...ys);
  return {...trace,center:[(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2],
    scale:trace.dimension?trace.dimension.meters/distance(...trace.dimension.pixels):10/Math.max(width,depth),
    scaleSource:trace.dimension?'printed-dimension-raster-estimate':'display-normalization-only',
    height:2.4,vertical:{sill:.4,head:2.1,verified:false},type:trace.type};
}
// Catalog metadata is attached only after byte-hash and geometry validation.
// No display-type fallback: an 84A from another site/variant is a different model.
export function modelForPlan(plan){
  const trace=planTraces.find(t=>t.id===plan?.trace?.id&&t.complexId===plan.complexId&&t.source.file===(plan.file??plan.imageFile)&&t.source.sha256===plan.trace.sourceSha256);
  if(trace)return traceModel(trace);
  if(plan?.complexId==='sinchon-prugio'){
    const type=Object.keys(legacyModels).find(id=>(plan.file??plan.imageFile)===`research/sinchon-prugio/images/${id}.jpg`);
    if(type)return {...legacyModels[type],id:`sinchon-prugio/legacy-${type}`,type,scaleSource:'legacy-provisional',windows:legacyModels[type].windows.map((w,i)=>({...w,id:`legacy-${i+1}`}))};
  }
  return null;
}
export function windowPose(model,id,{insetMeters=.35,eyeHeight=1.5}={}){
  if(!Number.isFinite(insetMeters)||insetMeters<=0||!Number.isFinite(eyeHeight)||eyeHeight<=0)throw new RangeError('Invalid observer dimensions');
  const w=model.windows.find(w=>w.id===id);
  if(!w)throw new RangeError('Unknown opening');
  const mid=w.a.map((v,i)=>(v+w.b[i])/2),length=distance(w.a,w.b);
  let normal=[-(w.b[1]-w.a[1])/length,(w.b[0]-w.a[0])/length];
  const inside=w.inside??mid.map((v,i)=>v+normal[i]*2);
  if(w.inside?normal.reduce((n,v,i)=>n+v*(inside[i]-mid[i]),0)<0:!pointInPlan(inside,model.outline))normal=normal.map(n=>-n);
  const point=mid.map((v,i)=>v+normal[i]*insetMeters/model.scale);
  if(!pointInPlan(point,model.outline))throw new Error('Window observer falls outside the traced home');
  const local=p=>p.map((v,i)=>(v-model.center[i])*model.scale);
  return {id,point,position:[local(point)[0],eyeHeight,local(point)[1]],
    outward:normal.map(n=>-n),widthMeters:length*model.scale,insetMeters,eyeHeight,
    scaleSource:model.scaleSource,geographicPlacementVerified:false};
}
