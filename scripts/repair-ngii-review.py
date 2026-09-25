"""Offline, evidence-gated repair into separate ZIPs. Never edit downloaded originals."""
import argparse, copy, hashlib, io, json, math, struct, zipfile
from pathlib import Path
import xml.etree.ElementTree as ET
from pyproj import CRS, Transformer
import shapefile
from functools import lru_cache

@lru_cache(maxsize=128)
def read_crs(wkt):
    return CRS.from_wkt(wkt)

@lru_cache(maxsize=128)
def epsg(wkt):
    return read_crs(wkt).to_epsg()

def same_crs(left,right):
    return left==right or read_crs(left).equals(read_crs(right))

def digest(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def make_shx(raw):
    if len(raw)<100 or struct.unpack_from('>i',raw)[0]!=9994 or struct.unpack_from('>i',raw,24)[0]*2!=len(raw):
        raise ValueError('Invalid SHP length/header')
    entries=[]; offset=100
    while offset<len(raw):
        if offset+8>len(raw): raise ValueError('Truncated record header')
        number,size=struct.unpack_from('>2i',raw,offset)
        if number!=len(entries)+1 or size<2 or offset+8+size*2>len(raw): raise ValueError('Invalid record')
        entries.append(struct.pack('>2i',offset//2,size)); offset+=8+size*2
    header=bytearray(raw[:100]);struct.pack_into('>i',header,24,50+4*len(entries))
    return bytes(header)+b''.join(entries)

def geometry_bounds(z,crs):
    boxes=[];t=Transformer.from_crs(crs,5179,always_xy=True)
    for name in z.namelist():
        if not name.lower().endswith('.shp'):continue
        raw=z.read(name)
        if len(raw)<=100:continue
        b=struct.unpack_from('<4d',raw,36)
        if not all(map(math.isfinite,b)):raise ValueError('Invalid bounds')
        # Null-only layers use zero bounds; inspect records before including them.
        r=shapefile.Reader(shp=io.BytesIO(raw))
        if not any(s.shapeType for s in r.iterShapes()):continue
        boxes.append(t.transform_bounds(*b))
    if not boxes:raise ValueError('No geometry')
    return [min(b[0] for b in boxes),min(b[1] for b in boxes),max(b[2] for b in boxes),max(b[3] for b in boxes)]

def repair(rows,output,apply=False):
    projects={ET.parse(s['review']['xml']).getroot().findtext('사업번호') for s in rows if s['review']['reason']=='incomplete-layers'}
    donors={p:[] for p in projects}
    donor_cache=Path('.tools/national/review-donors.json')
    if apply and donor_cache.exists():donors=json.loads(donor_cache.read_text(encoding='utf-8'))
    for index,xml in enumerate([] if apply and donor_cache.exists() else Path('mapinfo').glob('*.xml'),1):
        if index%1000==0:print(json.dumps({'cataloguesChecked':index}),flush=True)
        try:root=ET.parse(xml).getroot()
        except ET.ParseError:continue  # Unusable metadata cannot serve as a donor.
        project=root.findtext('사업번호')
        if project not in projects:continue
        zp=xml.with_suffix('.zip')
        with zipfile.ZipFile(zp) as z:
            prjs=[n for n in z.namelist() if n.lower().endswith('.prj')]
            if not prjs:continue
            donor_wkt=z.read(prjs[0]).decode('utf-8-sig')
            if not all(same_crs(z.read(n).decode('utf-8-sig'),donor_wkt) for n in prjs):raise ValueError('Mixed donor CRS')
            donors[project].append({'zip':str(zp),'sha256':digest(zp),'wkt':donor_wkt,'epsg':epsg(donor_wkt)})
    donor_cache.write_text(json.dumps(donors,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'donors':{p:len(ds) for p,ds in donors.items()},'crsCandidates':{p:list({d['epsg'] for d in ds}) for p,ds in donors.items()}}),flush=True)
    report=[]
    for s in rows:
        src=Path(s['review']['zip']);entry={'number':s['number'],'source':str(src),'sourceSha256':digest(src)}
        with zipfile.ZipFile(src) as z:
            if z.testzip():raise ValueError('Source CRC error')
            names={n.lower():n for n in z.namelist()};prjs=[n for n in z.namelist() if n.lower().endswith('.prj')]
            if s['review']['reason']=='incomplete-layers':
                project=ET.parse(s['review']['xml']).getroot().findtext('사업번호');ds=donors[project]
                if len(ds)<2:raise ValueError('Need two same-project donor archives')
                groups={}
                for d in ds:groups.setdefault(d['epsg'] or d['wkt'],[]).append(d)
                candidates=[]
                for group in groups.values():
                    if len(group)<2:continue
                    c=read_crs(group[0]['wkt']);b=geometry_bounds(z,c)
                    err=max(abs(a-b) for a,b in zip(b,s['bounds5179']))
                    candidates.append((err,group,c))
                matches=[v for v in candidates if v[0]<=2]
                if len(matches)!=1:raise ValueError('No unique CRS matching catalogue: '+s['number'])
                _,ds,crs=matches[0];wkt=ds[0]['wkt']
                for d in ds[:2]:
                    if digest(d['zip'])!=d['sha256']:raise ValueError('Donor changed')
                entry.update(project=project,donorCount=len(ds),donors=ds[:2],candidateErrors=[{'epsg':c.to_epsg(),'maxErrorMeters':err} for err,_,c in candidates])
            else:
                wkt=z.read(prjs[0]).decode('utf-8-sig');crs=read_crs(wkt)
                if not all(read_crs(z.read(n).decode('utf-8-sig')).equals(crs) for n in prjs):raise ValueError('Mixed archive CRS')
            actual=geometry_bounds(z,crs);error=max(abs(a-b) for a,b in zip(actual,s['bounds5179']))
            entry.update(epsg=crs.to_epsg(),bounds5179=actual,catalogueBounds5179=s['bounds5179'],maxErrorMeters=error)
            additions={}
            for name in z.namelist():
                if not name.lower().endswith('.shp'):continue
                stem=name[:-4]
                if stem.lower()+'.dbf' not in names:raise ValueError('Missing DBF cannot be synthesized')
                if stem.lower()+'.prj' not in names:additions[stem+'.prj']=wkt.encode('utf-8')
                if stem.lower()+'.shx' not in names:additions[stem+'.shx']=make_shx(z.read(name))
            entry['additions']=list(additions)
            if error>2:
                entry['status']='blocked-bounds';report.append(entry);continue
            entry['status']='repair-ready' if additions else 'metadata-only'
            if apply and additions:
                output.mkdir(parents=True,exist_ok=True);target=output/src.name
                if not target.exists():
                    with zipfile.ZipFile(target,'x',compression=zipfile.ZIP_DEFLATED) as dest:
                        for info in z.infolist():dest.writestr(copy.copy(info),z.read(info.filename))
                        for name,data in additions.items():dest.writestr(name,data)
                with zipfile.ZipFile(target) as fixed:
                    assert fixed.testzip() is None
                    assert set(fixed.namelist())==set(z.namelist())|set(additions)
                    for name,data in additions.items():assert fixed.read(name)==data
                    for name in z.namelist():assert z.read(name)==fixed.read(name)
                    for name in z.namelist():
                        if not name.lower().endswith('.shp'):continue
                        stem=name[:-4];reader=shapefile.Reader(shp=io.BytesIO(fixed.read(name)),shx=io.BytesIO(fixed.read(stem+'.shx')),dbf=io.BytesIO(fixed.read(stem+'.dbf')),encoding='cp949')
                        assert len(list(reader.iterShapes()))==reader.numRecords
                entry.update(output=str(target),outputSha256=digest(target),status='repaired')
            assert digest(src)==entry['sourceSha256']
            report.append(entry)
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');a=p.parse_args()
    rows=json.loads(Path('.tools/national/review-audit.json').read_text(encoding='utf-8'))
    report=repair(rows,Path('verification/ngii-review-repair/files'),a.apply)
    dest=Path('verification/ngii-review-repair');dest.mkdir(parents=True,exist_ok=True)
    (dest/('repair-report.json' if a.apply else 'preflight.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    from collections import Counter
    print(json.dumps({'status':dict(Counter(r['status'] for r in report)),'maxErrorMeters':max(r['maxErrorMeters'] for r in report),'epsg':dict(Counter(r['epsg'] for r in report))}))
