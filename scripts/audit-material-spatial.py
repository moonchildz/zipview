"""Offline raw-data overlap check, not terrain/model production or semantic validation."""
import json,zipfile,struct,xml.etree.ElementTree as ET
from pathlib import Path
from pyproj import CRS,Transformer
from shapely.geometry import Point,Polygon,box
from shapely.ops import transform,unary_union
from shapely.strtree import STRtree

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'research/linkage/generated/material-readiness'
providers=json.loads((OUT/'providers.json').read_text(encoding='utf8'))
to_local=Transformer.from_crs(4326,5179,always_xy=True).transform
tiles=[];issues=[];transforms={}
for index,p in enumerate((ROOT/'mapinfo').glob('*.zip')):
    xml=p.with_suffix('.xml')
    try:
        if not xml.exists():
            issues.append({'file':str(p.relative_to(ROOT)),'reason':'metadata-missing'});continue
        meta=ET.parse(xml).getroot()
        scale=meta.findtext('축척코드','').replace(',','').replace(' ','')
        if scale not in ('1:1000','1000'):
            issues.append({'file':str(p.relative_to(ROOT)),'reason':'not-1000'});continue
        with zipfile.ZipFile(p) as z:
            names=z.namelist();layers={}
            for kind,code in [('buildings','N1A_B0010000'),('contours','N1L_F0010000'),('elevationPoints','N1P_F0020000')]:
                shp=next((n for n in names if n.endswith(code+'.shp')),None)
                if not shp or z.getinfo(shp).file_size<=100:continue
                prj=shp[:-4]+'.prj'
                if prj not in names:continue
                wkt=z.read(prj).decode('utf-8-sig')
                if wkt not in transforms:transforms[wkt]=Transformer.from_crs(CRS.from_wkt(wkt),5179,always_xy=True)
                with z.open(shp) as h:header=h.read(100)
                if len(header)!=100 or struct.unpack('>i',header[:4])[0]!=9994:continue
                bounds=struct.unpack('<4d',header[36:68])
                if bounds[0]>=bounds[2] or bounds[1]>=bounds[3]:continue
                b=transforms[wkt].transform_bounds(*bounds,densify_pts=9)
                if all(abs(v)<1e8 for v in b):layers[kind]=list(b)
            if layers:tiles.append({'file':str(p.relative_to(ROOT)),'scale':1000,'bounds':layers})
            else:issues.append({'file':str(p.relative_to(ROOT)),'reason':'no-indexable-target-layer'})
    except Exception as e:issues.append({'file':str(p.relative_to(ROOT)),'reason':str(e)[:180]})
    if index%1000==0:print(json.dumps({'mapArchivesScanned':index,'indexed':len(tiles)}),flush=True)

indexes={}
for kind in ['buildings','contours','elevationPoints']:
    records=[t for t in tiles if kind in t['bounds']]
    indexes[kind]=(STRtree([box(*t['bounds'][kind]) for t in records]),records)
plan=json.loads((ROOT/'.tools/cas-imagery/plan.json').read_text(encoding='utf8'))
transfers=json.loads((ROOT/'.tools/cas-imagery/transfers.json').read_text(encoding='utf8'))
scenes=[]
for s in plan['selected']:
    r=transfers.get('scenes',{}).get(s['id'],{})
    bands=[f for f in r.get('files',[]) if f.get('band') in ['R_PS','G_PS','B_PS']]
    if len({f['band'] for f in bands})!=3:continue
    if not all(Path(f['path']).exists() and Path(f['path']).stat().st_size==f['bytes'] for f in bands):continue
    scenes.append((s['id'],transform(to_local,Polygon(s['ring']))))
footprint=unary_union([p for _,p in scenes])
rows=[]
for p in providers:
    result={'providerId':p['providerId'],'radiusMeters':400}
    point=p.get('point')
    if not point or len(point)!=2 or not (124<float(point[0])<132 and 33<float(point[1])<39.5):
        result['status']='coordinate-unavailable';rows.append(result);continue
    center=Point(*to_local(*point));region=center.buffer(400)
    for kind,(tree,records) in indexes.items():
        ids=tree.query(region)
        candidates=[records[int(i)] for i in ids if box(*records[int(i)]['bounds'][kind]).intersects(region)]
        result[kind+'Archives']=[t['file'] for t in candidates]
        result[kind+'CenterExtentCovered']=any(box(*t['bounds'][kind]).covers(center) for t in candidates)
    result['satelliteSceneIds']=[sid for sid,shape in scenes if shape.intersects(region)]
    result['satellite400mCatalogFootprintCovered']=footprint.covers(region)
    result['status']='extent-candidates-only'
    rows.append(result)
summary={'mapArchivesIndexed':len(tiles),'mapIndexIssues':len(issues),'downloadedRgbScenes':len(scenes),'providerRows':len(rows),'withBuildingExtent':sum(bool(r.get('buildingsArchives')) for r in rows),'withTerrainExtent':sum(bool(r.get('contoursArchives') or r.get('elevationPointsArchives')) for r in rows),'with400mSatelliteCatalogCoverage':sum(bool(r.get('satellite400mCatalogFootprintCovered')) for r in rows),'limitations':['SHP feature bounding boxes are overlap hints, not a proof of full map tile coverage or building height attributes.','Satellite catalogue footprint is not a valid-pixel or shadow mask.','400 m is a screening radius, not a complete horizon requirement.','No model generation and no new satellite catalogue requests.']}
for name,data in [('spatial.json',rows),('map-index.json',{'tiles':tiles,'issues':issues}),('spatial-summary.json',summary)]:
    (OUT/name).write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(summary,ensure_ascii=False),flush=True)
