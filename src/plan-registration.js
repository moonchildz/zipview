const validPoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
const mean=points=>points.reduce((a,p)=>a.map((v,i)=>v+p[i]/points.length),[0,0]);
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const canonical=(p,axis)=>[p[0],axis==='x-right-y-down'?-p[1]:p[1]];
export function applyRegistration(matrix,[x,y]) {
  return [matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]];
}
function spread(points){
  let diameter=0,area=0;
  for(let a=0;a<points.length;a++)for(let b=a+1;b<points.length;b++){
    diameter=Math.max(diameter,distance(points[a],points[b]));
    for(let c=b+1;c<points.length;c++)area=Math.max(area,Math.abs((points[b][0]-points[a][0])*(points[c][1]-points[a][1])-(points[b][1]-points[a][1])*(points[c][0]-points[a][0])));
  }
  return diameter>0?area/(diameter*diameter):0;
}
// Solve two similarity fits (rotation + uniform scale + translation), with and
// without reflection. Named holdout landmarks do not participate in either fit.
export function inferPlanRegistration(input={}) {
  const unknown=(reason,candidates=[])=>({status:'unknown',mirrored:null,verified:false,automaticPlacement:false,reason,candidates});
  const {pairs,sourceAxis,targetAxis,tolerance,sourceDocument,targetDocument,unitLinkStatus}=input;
  if(typeof sourceDocument!=='string'||!sourceDocument.trim()||typeof targetDocument!=='string'||!targetDocument.trim()||sourceDocument===targetDocument||unitLinkStatus!=='source-matched')return unknown('missing-independent-layout-or-unit-link');
  if(!['x-right-y-down','east-north'].includes(sourceAxis)||!['x-right-y-down','east-north'].includes(targetAxis))return unknown('unknown-coordinate-axes');
  if(!Number.isFinite(tolerance)||tolerance<=0)return unknown('missing-reading-error-budget');
  if(!Array.isArray(pairs)||pairs.length<4||pairs.length>32||pairs.some(p=>!p||typeof p.id!=='string'||!p.id.trim()||typeof p.kind!=='string'||!p.kind.trim()||!validPoint(p.source)||!validPoint(p.target)))return unknown('need-four-named-correspondences');
  if(new Set(pairs.map(p=>p.id)).size!==pairs.length||new Set(pairs.map(p=>JSON.stringify(p.source))).size!==pairs.length||new Set(pairs.map(p=>JSON.stringify(p.target))).size!==pairs.length)return unknown('duplicate-correspondences');
  if(new Set(pairs.map(p=>p.kind)).size<2)return unknown('need-distinct-feature-types');
  const rows=pairs.map(p=>({...p,a:canonical(p.source,sourceAxis),b:canonical(p.target,targetAxis)}));
  const fit=rows.filter(p=>p.role==='fit'),check=rows.filter(p=>p.role==='check');
  if(fit.length<3||check.length<1||fit.length+check.length!==rows.length)return unknown('need-fit-and-holdout');
  if(spread(fit.map(p=>p.a))<.02||spread(fit.map(p=>p.b))<.02)return unknown('collinear-or-unstable-anchors');
  const candidates=[false,true].map(mirrored=>{
    const sign=mirrored?-1:1,a=mean(fit.map(p=>[sign*p.a[0],p.a[1]])),b=mean(fit.map(p=>p.b));
    let dot=0,cross=0,norm=0;
    for(const p of fit){const x=sign*p.a[0]-a[0],y=p.a[1]-a[1],u=p.b[0]-b[0],v=p.b[1]-b[1];dot+=x*u+y*v;cross+=x*v-y*u;norm+=x*x+y*y;}
    const c=dot/norm,s=cross/norm,tx=b[0]-c*a[0]+s*a[1],ty=b[1]-s*a[0]-c*a[1];
    const sy=sourceAxis==='x-right-y-down'?-1:1,tySign=targetAxis==='x-right-y-down'?-1:1;
    const matrix=[c*sign,tySign*s*sign,-s*sy,tySign*c*sy,tx,tySign*ty];
    const residuals=rows.map(p=>({id:p.id,role:p.role,error:distance(applyRegistration(matrix,p.source),p.target)}));
    const errors=residuals.filter(p=>p.role==='fit').map(p=>p.error);
    return {mirrored,matrix,scale:Math.hypot(c,s),fitRms:Math.sqrt(errors.reduce((a,n)=>a+n*n,0)/errors.length),
      holdoutMax:Math.max(...residuals.filter(p=>p.role==='check').map(p=>p.error)),maxError:Math.max(...residuals.map(p=>p.error)),residuals};
  }).sort((a,b)=>a.fitRms-b.fitRms);
  const [best,other]=candidates;
  if(!best.matrix.every(Number.isFinite)||best.scale<=0||best.maxError>tolerance)return unknown('inconsistent-landmarks',candidates);
  if(other.fitRms-best.fitRms<=2*tolerance)return unknown('reflection-margin-too-small',candidates);
  return {status:'inferred',mirrored:best.mirrored,matrix:best.matrix,verified:false,automaticPlacement:true,
    reason:'paired-landmarks-with-holdout',tolerance,candidates,sources:[sourceDocument,targetDocument]};
}
