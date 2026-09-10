import {buildFacades} from './facades.js';
import {xiOpeningCandidates} from './xi-unit-layout.js';
import {xiLineOrientations} from './xi-orientation-evidence.js';

export function xiFacadeSpec(target,center,{orientations=xiLineOrientations(target),floorHeight=2.9}={}) {
  return {...target.parts[1],facadeFloorHeight:floorHeight,
    facadeOpenings:[1,2].flatMap(line=>xiOpeningCandidates(target,center,{line,mirrored:orientations[line]}))};
}

export function mountXiWindowFacade(outlook) {
  let signature,group;
  return orientations=>{
    const next=JSON.stringify([orientations,outlook.state.floorHeight]);
    if(signature===next)return;
    signature=next;
    if(group) {
      outlook.scene.remove(group);
      outlook.facadeMeshes=outlook.facadeMeshes.filter(mesh=>mesh!==group);
      group.traverse(child=>{child.geometry?.dispose();child.material?.dispose();});
    }
    const spec=xiFacadeSpec(outlook.target,outlook.data.center,{orientations,floorHeight:outlook.state.floorHeight});
    group=buildFacades(spec);
    group.traverse(child=>child.layers.set(4));
    group.visible=document.querySelector('#facades-visible').checked;
    outlook.scene.add(group);outlook.facadeMeshes.push(group);
    outlook.host.dataset.windowFacade=JSON.stringify({openings:spec.facadeOpenings.length,floors:spec.levels,
      widths:spec.facadeOpenings.slice(0,5).map(w=>Number(w.widthMeters.toFixed(2))),
      orientations,floorHeight:spec.facadeFloorHeight,verticalVerified:false});
  };
}
