import {checkInventory} from './ngii-files.mjs';

// Every leaf must match the provider count; a saturated parent is never called complete.
export async function completeMapInventory(initial,query,{maxDepth=8}={}){
 try{checkInventory(initial.counts,initial.items);return {...initial,inventoryMethod:'district-count-checked'};}catch{}
 const a=initial.area;if(!a)throw Error('Cannot subdivide without district boundary');
 const leaves=[];
 async function visit(bounds,depth){const result=await query(bounds);
  try{checkInventory(result.counts,result.items);leaves.push({bounds,count:result.items.length});return result.items;}catch(error){
   if(depth>=maxDepth||Math.min(bounds[2]-bounds[0],bounds[3]-bounds[1])<100)throw Error('Unresolved inventory gap: '+error.message);
   const [x0,y0,x1,y1]=bounds,mx=(x0+x1)/2,my=(y0+y1)/2;let rows=[];
   for(const b of [[x0,y0,mx,my],[mx,y0,x1,my],[x0,my,mx,y1],[mx,my,x1,y1]])rows.push(...await visit(b,depth+1));return rows;
  }
 }
 const rows=await visit([a.minx,a.miny,a.maxx,a.maxy],0);
 const items=[...new Map(rows.map(x=>[`${x.scale}:${x.num}:${x.makeYer}:${x.gosiYer}:${x.historyNo}`,x])).values()];
 return {area:a,items,originalCounts:initial.counts,inventoryMethod:'count-checked-bounding-box-subdivision',leaves,note:'Bounding-box inventory can include neighbouring sheets; exact district polygon is retained for imagery targets.'};
}
