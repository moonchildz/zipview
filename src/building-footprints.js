import {localPoint,geographicPoint} from './outlook-math.js';

// Geometry is stored once in its source scene coordinates. Every regional view
// reprojects the same footprint, including neighbouring Xi's different origin.
export function applyBuildingFootprints(scene,document){
  if(!document||!scene.buildings.some(b=>b.siteSource===document.siteSource))return 0;
  const project=p=>{const g=geographicPoint(...p,document.center);return localPoint(g.lon,g.lat,scene.center);};
  let applied=0;
  for(const source of document.buildings){
    if(source.siteSource!==document.siteSource)throw new Error('Footprint site mismatch');
    const row=structuredClone(source);
    row.points=row.points.map(project);
    row.parts=row.parts.map(p=>({...p,points:p.points.map(project),base:row.base,kind:row.kind,height:row.height,levels:row.levels,heightSource:row.heightSource}));
    const existing=scene.buildings.find(b=>b.id===row.id);
    if(existing&&existing.siteSource!==row.siteSource)throw new Error('Footprint identity collision');
    if(existing)Object.assign(existing,row);
    else scene.buildings.push(row);
    applied++;
  }
  return applied;
}
