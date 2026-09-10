import {DatabaseSync} from 'node:sqlite';

const db=new DatabaseSync('research/seoul/generated/seoul.sqlite',{readOnly:true});
const [command='coverage',...args]=process.argv.slice(2);
try{
  let result;
  if(command==='coverage')result=JSON.parse(db.prepare("SELECT data FROM metadata WHERE id='coverage'").get().data);
  else if(command==='search'){
    const q='%'+(args[0]??'')+'%';
    result=db.prepare('SELECT data FROM complexes WHERE name LIKE ? OR address LIKE ? ORDER BY district,name LIMIT 100').all(q,q).map(r=>JSON.parse(r.data));
  }else if(command==='packages')result=db.prepare('SELECT data FROM bundles').all().map(r=>JSON.parse(r.data));
  else if(command==='unit'){
    if(args.length!==3)throw new Error('unit <bundle-id> <building> <unit>');
    const row=db.prepare(`SELECT u.data,b.data AS bundle_data FROM units u JOIN bundles b ON b.id=u.bundle_id
      WHERE u.bundle_id=? AND u.building=? AND u.unit=?`).get(...args);
    result=row?{...JSON.parse(row.data),lifecycle:JSON.parse(row.bundle_data).lifecycle,
      viewReady:false,reason:'Spatial placement, floor elevation and/or variant not verified'}:{status:'not-registered',viewReady:false};
  }else if(command==='nearby'){
    const row=db.prepare('SELECT data FROM complexes WHERE id=?').get(args[0]);
    if(!row)throw new Error('Unknown complex');const c=JSON.parse(row.data),r=Number(args[1]??500);
    if(!c.point||!Number.isFinite(r)||r<1||r>5000)throw new Error('Need plausible coordinates and radius 1..5000 metres');
    const [x,y]=c.point,dy=r/111195,dx=dy/Math.cos(y*Math.PI/180);
    const features=db.prepare(`SELECT e.data FROM environment_bounds b JOIN environment e ON e.seq=b.seq
      WHERE b.west<=? AND b.east>=? AND b.south<=? AND b.north>=? AND e.category<>'boundary' LIMIT 5000`).all(x+dx,x-dx,y+dy,y-dy).map(r=>JSON.parse(r.data));
    const coverage=JSON.parse(db.prepare("SELECT data FROM metadata WHERE id='coverage'").get().data);
    result={complex:c.name,selection:'bounding-box candidates, not exact radial intersection or dong matching',
      sourceQueryComplete:coverage.environment.queryComplete,sourceWarning:coverage.environment.providerRemark,
      limit:5000,possiblyTruncated:features.length===5000,count:features.length,features};
  }else throw new Error('Choose coverage, search <text>, packages, unit <bundle> <dong> <ho>, nearby <complex-id> [metres]');
  console.log(JSON.stringify(result,null,2));
}catch(e){console.error(e.message);process.exitCode=1;}finally{db.close();}
