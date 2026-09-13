// Regional source data is cached independently of the selected home. Consumers
// receive private working copies because existing facade adapters mutate geometry.
import {applyBuildingFootprints} from './building-footprints.js';
export function applyTerrainCorrection(environment,correction){
  if(!correction)return environment;
  environment.terrain.local=structuredClone(correction.terrain);
  const overrides=new Map(correction.buildings.map(b=>[b.id,b]));
  for(const building of environment.buildings)if(overrides.has(building.id))Object.assign(building,structuredClone(overrides.get(building.id)));
  return environment;
}

export function createNeighborhoodStore(fetchImpl=(...args)=>fetch(...args)) {
  const documents=new Map();
  function read(url){
    if(!documents.has(url)){
      const pending=(async()=>{
        const response=await fetchImpl(url);
        if(!response.ok)throw new Error(`Environment data unavailable: ${url}`);
        return response.json();
      })();
      documents.set(url,pending);
      pending.catch(()=>{if(documents.get(url)===pending)documents.delete(url);});
    }
    return documents.get(url);
  }
  return {
    async load({sceneUrl,correctionUrl=null,footprintsUrl=null}){
      const [snapshot,correction,footprints]=await Promise.all([read(sceneUrl),correctionUrl?read(correctionUrl):null,footprintsUrl?read(footprintsUrl):null]);
      const {targetBuildingId,window,...regional}=structuredClone(snapshot);
      if(!Array.isArray(regional.buildings)||!regional.terrain||!regional.center)throw new Error('Invalid regional scene');
      applyTerrainCorrection(regional,correction);
      applyBuildingFootprints(regional,footprints);
      return {environment:regional,defaultSelection:{targetBuildingId,window},
        source:{sceneUrl,correctionUrl},correctionStatus:correction?.status??null};
    },
    invalidate(url){documents.delete(url);},
  };
}
export const neighborhoods=createNeighborhoodStore();
