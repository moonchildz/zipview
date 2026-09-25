import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {contains} from './cas-imagery-plan.mjs';

export function luminanceStats(values,expectedCount=values.length){
  if(!values.length)return {validFraction:0,score:null};
  values.sort((a,b)=>a-b);
  const at=q=>values[Math.floor((values.length-1)*q)];
  const median=at(.5),p10=at(.1),darkFraction=values.filter(x=>x<45).length/values.length,
    clippedFraction=values.filter(x=>x>245).length/values.length;
  return {median,p10,darkFraction,clippedFraction,validFraction:values.length/expectedCount,
    score:Math.max(.001,(.7*median+.3*p10)/255*(1-.5*darkFraction)*(1-clippedFraction))};
}
export async function measureRgbPreview(page,scene,cells,folder){
  await fs.mkdir(folder,{recursive:true});
  const file=path.join(folder,scene.id+'.png');let bytes=await fs.readFile(file).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  let downloadedBytes=0;
  if(!bytes){
    const response=await page.request.get('https://map.ngii.go.kr/ms/map/nlipCASImgView.do?'+new URLSearchParams({id:scene.id,type:'L2G'}),{timeout:45000});
    if(!response.ok())throw new Error(`Preview HTTP ${response.status()}`);
    bytes=await response.body();downloadedBytes=bytes.length;
    if(!bytes.length)throw new Error('RGB preview unavailable (empty response)');
    if(bytes.length>8_000_000)throw new Error('Preview exceeds 8 MB limit');
    const m=await sharp(bytes,{limitInputPixels:8_000_000}).metadata();
    if(!['png','jpeg','webp'].includes(m.format)||m.channels<3)throw new Error('Not an RGB preview');
    await fs.writeFile(file,bytes);
  }
  const covered=cells.filter(c=>c.corners.every(p=>contains(p,scene.ring)));
  // The provider displays this preview in the EPSG:5179 bounding rectangle.
  // Use the site's registered CRS transform, not longitude/latitude linear interpolation.
  const projected=await page.evaluate(({ring,cells})=>{
    const transform=p=>ol.proj.transform(p,'EPSG:4326','EPSG:5179');
    return {ring:ring.map(transform),cells:cells.map(c=>({id:c.id,corners:c.corners.map(transform)}))};
  },{ring:scene.ring,cells:covered.map(c=>({id:c.id,corners:c.corners}))});
  if(projected.ring.some(p=>p.some(v=>!Number.isFinite(v))))throw new Error('Preview projection failed');
  const xs=projected.ring.map(p=>p[0]),ys=projected.ring.map(p=>p[1]);
  const west=Math.min(...xs),east=Math.max(...xs),north=Math.max(...ys),south=Math.min(...ys);
  const {data,info}=await sharp(bytes,{limitInputPixels:8_000_000}).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const scores={};
  for(const cell of projected.cells){
    const px=cell.corners.map(p=>(p[0]-west)/(east-west)*info.width),py=cell.corners.map(p=>(north-p[1])/(north-south)*info.height);
    const x0=Math.max(0,Math.floor(Math.min(...px))),x1=Math.min(info.width,Math.ceil(Math.max(...px))),
      y0=Math.max(0,Math.floor(Math.min(...py))),y1=Math.min(info.height,Math.ceil(Math.max(...py)));
    const values=[];for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
      const i=(y*info.width+x)*4,r=data[i],g=data[i+1],b=data[i+2];
      if(data[i+3]<250||r===0&&g===0&&b===0)continue;
      values.push(.2126*r+.7152*g+.0722*b);
    }
    const stats=luminanceStats(values,(x1-x0)*(y1-y0));
    // Unknown/empty edge cells never become covered just because the preview is bright elsewhere.
    if(values.length>=4&&stats.validFraction>=.98)scores[cell.id]=stats;
  }
  return {sceneId:scene.id,file:path.resolve(file),width:info.width,height:info.height,downloadedBytes,
    basis:'provider-rendered-RGB-preview-in-EPSG5179',limitations:'not-raw-PS; exposure, haze, water and snow may affect ranking; dark pixels are not classified shadows',scores};
}
