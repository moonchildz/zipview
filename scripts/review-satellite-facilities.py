"""Build a standalone local review page and per-class evidence contact sheets."""
import argparse
from collections import Counter
import json
import importlib.util
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

spec=importlib.util.spec_from_file_location('satellite_detector',Path(__file__).with_name('detect-satellite-facilities.py'))
detector=importlib.util.module_from_spec(spec)
spec.loader.exec_module(detector)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('verification/satellite-facilities'))
    args = parser.parse_args()
    root = args.root
    manifest = json.loads((root/'manifest.json').read_text(encoding='utf-8'))
    data, summary, images = [], {}, {}
    sheets = root/'classes'
    sheets.mkdir(exist_ok=True)
    for mode in ['obb','open']:
        docs = []
        for region in manifest['regions']:
            path = root/region['id']/(mode+'.json')
            if path.exists():
                doc = json.loads(path.read_text(encoding='utf-8'))
                docs.append(doc)
                data.append({'region':region['id'],'mode':mode,'source':region,
                             'model':doc['model'],'objects':doc['objects']})
        if not docs: continue
        labels = list(docs[0]['model']['classes'].values())
        scene_objects=[]
        for scene in manifest['scenes']:
            candidates=[{**o,'quad':o['sceneQuad']} for d in docs if d['source']['scene']==scene['id'] for o in d['objects']]
            scene_objects.extend(detector.merge_candidates(candidates,scene['width'],scene['height']))
        counts = {str(t): {label: sum(o['score'] >= t and o['label']==label for o in scene_objects)
                           for label in labels} for t in [0.15,0.25,0.5]}
        summary[mode] = {'regions':len(docs),'classes':labels,'counts':counts,'sheets':{},'seconds':sum(d['seconds'] for d in docs),
                         'aggregateBasis':'Same-scene polygon NMS IoU 0.35 across regions; different dates/scenes remain separate; partial-box duplicates can remain.'}
        for label in labels:
            candidates = sorted([(d['source']['id'],o) for d in docs for o in d['objects'] if o['label']==label],key=lambda pair:-pair[1]['score'])
            if not candidates: continue
            chosen, per_region = [], Counter()
            for region,obj in candidates:
                if per_region[region] >= 2: continue
                chosen.append((region,obj)); per_region[region]+=1
                if len(chosen)==6: break
            sheet = Image.new('RGB',(1200,850),'#15212c')
            draw = ImageDraw.Draw(sheet)
            draw.text((15,12),f'{mode} / {label} | top scores, max 2 per region | UNVERIFIED',fill='white')
            for i,(region,obj) in enumerate(chosen):
                if region not in images: images[region]=Image.open(root/region/'source.png').convert('RGB')
                source=images[region]
                x1,y1,x2,y2=obj['box']
                side=max(160,(x2-x1)*1.6,(y2-y1)*1.6)
                cx,cy=(x1+x2)/2,(y1+y2)/2
                bounds=(int(cx-side/2),int(cy-side/2),int(cx+side/2),int(cy+side/2))
                crop=source.crop(bounds)
                cd=ImageDraw.Draw(crop)
                points=[(x-bounds[0],y-bounds[1]) for x,y in obj['quad']]
                cd.line(points+points[:1],fill='#ffde00',width=max(2,round(side/190)))
                crop=ImageOps.contain(crop,(390,350))
                ox,oy=(i%3)*400,(i//3)*400+45
                sheet.paste(crop,(ox+(400-crop.width)//2,oy))
                draw.text((ox+8,oy+355),f'{region} / #{obj["id"]} / {obj["score"]:.3f}',fill='white')
                draw.text((ox+8,oy+373),f'box {x2-x1:.0f} x {y2-y1:.0f} px',fill='#9caebb')
            filename=mode+'-'+label.replace(' ','-').replace('/','-')+'.jpg'
            sheet.save(sheets/filename,quality=93)
            summary[mode]['sheets'][label]='classes/'+filename
    (root/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    template=Path(__file__).with_name('satellite-review-template.html').read_text(encoding='utf-8')
    payload=json.dumps({'data':data,'summary':summary,'manifest':manifest},ensure_ascii=False).replace('</','<\\/')
    (root/'review.html').write_text(template.replace('__PAYLOAD__',payload),encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
