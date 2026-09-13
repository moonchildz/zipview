"""Keep NGII 209's sheet parts; separate the documented eastern 210 wing.

209 uses photo-survey geometry. 210 retains the OSM eastern wing, with NGII
209 removed. The wing assignment is a site-plan reading, not a surveyed 210
outline. Raw source geometries are never overwritten.
"""
import hashlib
import json
from pathlib import Path
import numpy as np
from pyproj import Transformer
from shapely.geometry import Polygon
from shapely.ops import unary_union

root = Path('research/sinchon-prugio')
review_path = root/'mapinfo-review/source-review.json'
scene = json.loads((root/'outlook/scene.json').read_text(encoding='utf-8'))
review = json.loads(review_path.read_text(encoding='utf-8'))
terrain = json.loads((root/'outlook/mapinfo-correction.json').read_text(encoding='utf-8'))['terrain']
site = 'https://www.openstreetmap.org/way/463988053'
transform = Transformer.from_crs(5186, 4326, always_xy=True)
origin = np.asarray(review['origin'])
lon0, lat0 = scene['center']
mx = 111195*np.cos(np.radians(lat0))

def local(points):
    xy = np.asarray(points)+origin
    lon, lat = transform.transform(xy[:,0], xy[:,1])
    return np.column_stack(((lon-lon0)*mx, -(lat-lat0)*111195)).tolist()

def base(polygon):
    # Match the renderer's triangular terrain interpolation, without claiming FFL.
    x,z = polygon.centroid.coords[0]
    n,e,h = terrain['size'],terrain['extent'],terrain['heights']
    gx,gz = [(v+e)/(2*e)*(n-1) for v in (x,z)]
    c,r = int(gx),int(gz)
    if not (0<=c<n-1 and 0<=r<n-1):
        raise ValueError('Footprint outside local terrain')
    u,v,i = gx-c,gz-r,r*n+c
    value = h[i]+(h[i+1]-h[i])*u+(h[i+n]-h[i])*v if u+v<=1 else h[i+n+1]+(h[i+n]-h[i+n+1])*(1-u)+(h[i+1]-h[i+n+1])*(1-v)
    return round(value,3)

features = [f for f in review['features'] if f['layer']=='N1A_B0010000'
            and f['properties'].get('주기')=='209동'
            and f['properties'].get('도로명')=='북아현로1길'
            and f['properties'].get('건물본번')==50]
if len(features)!=3 or len({f['properties']['UFID'] for f in features})!=3:
    raise ValueError('209 source inventory changed; review required')
polygons = [Polygon(local(f['points'])) for f in features]
if not all(p.is_valid for p in polygons):
    raise ValueError('Invalid NGII source polygon')
ngii209 = unary_union(polygons)
parts209 = sorted(ngii209.geoms if ngii209.geom_type=='MultiPolygon' else [ngii209],key=lambda p:-p.area)
if len(parts209)!=2:
    raise ValueError('Expected merged sheet-boundary wing and separate 209 core')
old210 = next(b for b in scene['buildings'] if b['id']==902872238 and b['siteSource']==site)
registry = json.loads(Path('research/linkage/downloads/hub/target-buildings.json').read_text(encoding='utf-8'))
facts = next(t for t in registry['targets'] if t['id']=='sinchon-prugio')['buildings']
# Site blueprint: 209 is the west terrace block, 210 the long east wing.
# Preserve the six existing eastern-wing vertices instead of stretching 209 to
# fill the merged OSM outline. Their source indices are retained in the report.
indices = [2,3,4,5,6,7]
east210 = Polygon([old210['points'][i] for i in indices]).difference(ngii209)
if east210.geom_type!='Polygon' or not east210.is_valid or east210.area<100 or east210.interiors:
    raise ValueError('Unexpected eastern wing topology')
if ngii209.intersection(east210).area>1e-7:
    raise ValueError('209/210 overlap remains')

def row(number,identifier,polygon,parts,method):
    fact = next(f for f in facts if f['building']==str(number))
    return {'id':identifier,'name':str(number),'kind':'apartments','label':f'신촌푸르지오아파트 {number}동',
            'height':fact['heightMeters'],'levels':fact['levels'],'heightSource':'official-building-register','heightEvidence':fact['detailSource'],
            'siteSource':site,'source':str(review_path) if number==209 else old210['source'],
            'points':list(polygon.exterior.coords),'parts':[{'points':list(p.exterior.coords),'inheritBuildingHeight':True} for p in parts],
            'base':base(polygon),'baseSource':'NGII contour interpolation at footprint centroid; first-floor datum unverified',
            'geometrySource':method,'geometryStatus':'source-reviewed-estimate','geometryVerified':False}

rows = [row(209,'ngii:sinchon-prugio:209',parts209[0],parts209,'NGII sheet union; three address-and-dong-labelled source features'),
        row(210,902872238,east210,[east210],'OSM eastern wing; site-blueprint separation; NGII209 difference')]
output = {'version':1,'center':scene['center'],'siteSource':site,'buildings':rows,
          'evidence':{'ngii':{'file':str(review_path),'sha256':hashlib.sha256(review_path.read_bytes()).hexdigest(),
                              'ufids':[f['properties']['UFID'] for f in features]},
                      'siteBlueprint':{'file':'research/linkage/downloads/hub/sinchon-prugio.jpg','reading':'209 west terrace block; 210 east elongated wing'},
                      'terraceDrawing':'research/linkage/downloads/evidence/sh/70339-49-ef38aea4fba4.jpeg',
                      'osm210VertexIndices':indices},
          'checks':{'ngiiSourceParts':len(polygons),'merged209Parts':len(parts209),
                    'area209M2':ngii209.area,'area210M2':east210.area,'overlapM2':ngii209.intersection(east210).area},
          'limitations':['210 outer boundary remains OSM-based; no labelled NGII210 polygon found',
                         'Footprint geometry does not establish floor elevation or window registration']}
destination = root/'outlook/building-footprints.json'
destination.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def drawing(items):
    content = ''
    for label, rings, color in items:
        for ring in rings:
            points = ' '.join(f'{(x-5)*7+25:.2f},{(z+25)*7+35:.2f}' for x,z in ring)
            content += f'<polygon points="{points}" fill="{color}" fill-opacity=".45" stroke="{color}" stroke-width="2"/>'
        center = Polygon(rings[0]).centroid.coords[0]
        content += f'<text x="{(center[0]-5)*7+25:.2f}" y="{(center[1]+25)*7+35:.2f}" text-anchor="middle">{label}</text>'
    return f'<svg viewBox="0 0 430 420" role="img"><text x="15" y="22">N ↑ · 눈금 10m</text><path d="M20 390h70m-70 -4v8m70 -8v8" stroke="#333"/>{content}</svg>'
before=drawing([('210', [old210['points']], '#467ab5')])
after=drawing([(r['name'],[p['points'] for p in r['parts']],'#cf6335' if r['name']=='209' else '#467ab5') for r in rows])
gallery=Path('research/linkage/generated/footprint-review.html')
gallery.parent.mkdir(parents=True,exist_ok=True)
gallery.write_text(f'''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>209·210동 외곽 보정</title><style>body{{font:16px/1.6 system-ui;max-width:1000px;margin:32px auto;padding:20px;color:#233742}}.panels{{display:flex;flex-wrap:wrap;gap:24px}}section{{flex:1;min-width:280px;background:#f1f5f7;padding:16px}}svg{{width:100%}}text{{font-size:14px}}</style><h1>신촌 209·210동 외곽 보정</h1><div class="panels"><section><h2>기존 모델</h2>{before}</section><section><h2>보정 모델</h2>{after}</section></div><p>209동은 수치지도 3개 조각을 2개 부분으로 합쳤습니다. 210동은 배치도에서 확인한 동쪽 긴 부분을 기존 OSM 외곽선에서 분리했습니다. 두 동의 중복 면적은 0㎡입니다.</p><p>209동 외곽은 사진측량 자료, 210동 외곽은 OSM 기반 추정입니다. 1층 바닥 고도·층별 높이·세대의 방향 및 창 위치를 확정하는 보정은 아닙니다.</p><p><a href="/research/linkage/downloads/hub/sinchon-prugio.jpg">대조한 단지 배치도</a> · <a href="/research/linkage/generated/evidence-review.html">추가 도면</a></p></html>''',encoding='utf-8')
print(json.dumps(output['checks']))
