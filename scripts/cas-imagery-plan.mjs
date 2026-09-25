// Pure planning: no imagery downloads, browser state, credentials or model calls.
const rad=Math.PI/180, earth=6378137;
export const CAS_BANDS=['R_PS','G_PS','B_PS'];
export function mercator(lon,lat){return [earth*lon*rad,earth*Math.log(Math.tan(Math.PI/4+lat*rad/2))];}
export function lonlat(x,y){return [x/earth/rad,(2*Math.atan(Math.exp(y/earth))-Math.PI/2)/rad];}
export function contains(point,ring){
  let inside=false;const [x,y]=point;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [a,b]=ring[i],[c,d]=ring[j];
    if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)inside=!inside;
  }return inside;
}
export function normalizeTargets(raw){
  const source=raw.DATA??raw.features??raw.targets??raw;
  if(!Array.isArray(source))throw new Error('Targets must be an array, GeoJSON points, or Seoul DATA inventory');
  const targets=[],rejected=[],seen=new Set();
  for(const item of source){
    const r=item.properties??item;
    if(raw.DATA&&!['아파트','주상복합','도시형 생활주택(아파트)','도시형 생활주택(주상복합)'].includes(r.cmpx_clsf))continue;
    const id=String(r.id??r.apt_cd??r.kaptCode??'');
    const point=item.geometry?.type==='Point'?item.geometry.coordinates:r.point??[r.lon??r.longitude??r.xcrd,r.lat??r.latitude??r.ycrd];
    const [lon,lat]=point.map(Number);
    if(!id||seen.has(id)||!Number.isFinite(lon)||!Number.isFinite(lat)||lon<124||lon>132||lat<33||lat>39.5){rejected.push({id,reason:'missing-duplicate-id-or-invalid-korea-coordinate'});continue;}
    seen.add(id);targets.push({id,name:r.name??r.apt_nm??r.kaptName??id,point:[lon,lat]});
  }return {targets,rejected,scope:raw.DATA?'provided-seoul-inventory':'provided-coordinate-inventory'};
}
export function targetCells(targets,{radiusMeters=300,cellMeters=250}={}){
  if(!(radiusMeters>0&&radiusMeters<=3000&&cellMeters>=50&&cellMeters<=1000))throw new Error('Invalid target buffer/grid size');
  const cells=new Map();
  for(const t of targets){
    const [x,y]=mercator(...t.point),r=radiusMeters/Math.cos(t.point[1]*rad);
    for(let ix=Math.floor((x-r)/cellMeters);ix<=Math.floor((x+r)/cellMeters);ix++)for(let iy=Math.floor((y-r)/cellMeters);iy<=Math.floor((y+r)/cellMeters);iy++){
      const id=`${ix}:${iy}`;
      if(!cells.has(id))cells.set(id,{id,center:lonlat((ix+.5)*cellMeters,(iy+.5)*cellMeters),
        corners:[[ix,iy],[ix+1,iy],[ix+1,iy+1],[ix,iy+1]].map(([a,b])=>lonlat(a*cellMeters,b*cellMeters)),targetIds:[]});
      cells.get(id).targetIds.push(t.id);
    }
  }return [...cells.values()];
}
// Approximate geometric solar altitude (no refraction). Catalog ID time is UTC;
// IMAGINGTIME in the search response is date-only and must not be used as noon.
export function solarElevation(date,lon,lat){
  const d=(Date.parse(date)-Date.UTC(2000,0,1,12))/86400000;
  const g=(357.529+.98560028*d)*rad,q=(280.459+.98564736*d)*rad;
  const l=q+1.915*rad*Math.sin(g)+.020*rad*Math.sin(2*g),e=(23.439-.00000036*d)*rad;
  const ra=Math.atan2(Math.cos(e)*Math.sin(l),Math.cos(l)),dec=Math.asin(Math.sin(e)*Math.sin(l));
  const h=(280.16+360.9856235*d+lon)*rad-ra;
  return Math.asin(Math.sin(lat*rad)*Math.sin(dec)+Math.cos(lat*rad)*Math.cos(dec)*Math.cos(h))/rad;
}
export function sceneFromRow(row){
  if(row.CATALOGTYPE!=='L2G')return null;
  const id=row.CATALOGID;if(!/^C1_\d{14}_\d+_\d+$/.test(id??''))return null;
  const ring=['UL','BL','BR','UR'].map(k=>[Number(row[k+'_LOT']),Number(row[k+'_LAT'])]);
  if(ring.some(p=>!p.every(Number.isFinite)||p[0]<124||p[0]>132||p[1]<33||p[1]>39.5))return null;
  const t=id.split('_')[1],time=`${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}T${t.slice(8,10)}:${t.slice(10,12)}:${t.slice(12,14)}Z`;
  const center=[0,1].map(i=>ring.reduce((n,p)=>n+p[i],0)/ring.length);
  const number=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
  return {id,ring,capturedAt:time,sunElevation:solarElevation(time,...center),sunBasis:'estimated-from-catalog-id-UTC',
    cloud:number(row.AVRG_AMTCLD_CNT),roll:number(row.ROLL_TILT_VL),pitch:number(row.PITCH_TILT_VL),
    estimatedBytes:6_000_000_000,bytesBasis:'conservative-estimate-RGB-PS-plus-XML',footprintBasis:'catalog-corners-not-valid-pixel-mask',
    payload:row};
}
export function planScenes(cells,scenes,{maxGB=1000,maxScenes=166,minSun=40,maxCloud=0,maxTilt=20,qualityTolerance=.2,existingIds=[],previewScores=null}={}){
  if(![maxGB,maxScenes,minSun,maxCloud,maxTilt,qualityTolerance].every(Number.isFinite)||maxGB<=0||maxScenes<1||minSun<=0||minSun>=90||maxCloud<0||maxTilt<0||qualityTolerance<0||qualityTolerance>1)throw new Error('Invalid planning limits');
  const existing=new Set(existingIds),eligible=[],excluded=[];
  for(const scene of scenes){
    const reason=scene.cloud===null?'unknown-cloud':scene.cloud>maxCloud?'cloud':scene.roll===null||scene.pitch===null?'unknown-tilt':Math.max(Math.abs(scene.roll),Math.abs(scene.pitch))>maxTilt?'tilt':scene.sunElevation<minSun?'low-sun':null;
    if(reason){excluded.push({id:scene.id,reason});continue;}
    let cover=cells.filter(c=>c.corners.every(p=>contains(p,scene.ring))).map(c=>c.id);
    const quality=Math.sin(scene.sunElevation*rad)/(1+(Math.abs(scene.roll)+Math.abs(scene.pitch))/90);
    const cellQuality={};
    if(previewScores){
      const preview=previewScores[scene.id];
      cover=cover.filter(id=>Number.isFinite(preview?.scores?.[id]?.score));
      for(const id of cover)cellQuality[id]=preview.scores[id].score;
    }else for(const id of cover)cellQuality[id]=quality;
    eligible.push({...scene,cover,quality,cellQuality,qualityBasis:previewScores?'RGB-preview-local-luminance':'estimated-sun-and-tilt'});
  }
  const best=new Map();for(const s of eligible)for(const id of s.cover)best.set(id,Math.max(best.get(id)??0,s.cellQuality[id]));
  for(const s of eligible)s.cover=s.cover.filter(id=>s.cellQuality[id]>=best.get(id)*(1-qualityTolerance));
  const pending=new Set(cells.map(c=>c.id)),selected=[];let bytes=0;
  while(pending.size&&selected.length<maxScenes){
    let winner=null,score=0;
    for(const s of eligible){
      if(selected.some(x=>x.id===s.id))continue;
      const cost=existing.has(s.id)?0:s.estimatedBytes;if(bytes+cost>maxGB*1e9)continue;
      const gain=s.cover.filter(id=>pending.has(id));const value=gain.reduce((sum,id)=>sum+s.cellQuality[id],0)/(existing.has(s.id)?.01:s.estimatedBytes/1e9);
      if(value>score){score=value;winner={...s,newCells:gain,downloadBytes:cost,alreadyPresent:existing.has(s.id)};}
    }
    if(!winner)break;
    selected.push(winner);bytes+=winner.downloadBytes;for(const id of winner.newCells)pending.delete(id);
  }
  const incompleteTargets=new Set(cells.filter(c=>pending.has(c.id)).flatMap(c=>c.targetIds));
  return {schemaVersion:1,createdAt:new Date().toISOString(),policy:{maxGB,maxScenes,minSun,maxCloud,maxTilt,qualityTolerance,qualityBasis:previewScores?'RGB-preview-local-luminance':'estimated-sun-and-tilt'},
    requiredBands:CAS_BANDS,metadataRequired:true,estimatedDownloadGB:bytes/1e9,totalCells:cells.length,
    plannedCoveredCells:cells.length-pending.size,uncoveredCellIds:[...pending],incompleteTargetIds:[...incompleteTargets],
    coverageStatus:'planned-only-valid-pixels-and-local-shadows-unverified',selected,excluded};
}
