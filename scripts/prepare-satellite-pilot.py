"""Read complete CAS RGB PS sets and export display stretches and native-pixel crops.

No georeferencing is inferred when the TIFF has no CRS. Pixel offsets are retained.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window
from PIL import Image, ImageDraw

import importlib.util
spec = importlib.util.spec_from_file_location('cas_verify', Path(__file__).with_name('verify-cas-files.py'))
cas = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cas)


def stretch(rgb, limits):
    valid = np.all(rgb > 0, axis=2)
    result = np.zeros(rgb.shape, dtype=np.uint8)
    for i, (lo, hi) in enumerate(limits):
        result[:, :, i] = (np.clip((rgb[:, :, i].astype(np.float32) - lo) / max(hi-lo, 1), 0, 1) ** (1/1.2) * 255).astype(np.uint8)
    result[~valid] = 0
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inbox', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('verification/satellite-facilities'))
    parser.add_argument('--regions', type=Path, help='JSON list: scene, id, x, y, size (native pixels)')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    regions = json.loads(args.regions.read_text(encoding='utf-8')) if args.regions else []
    manifest = {'scenes': [], 'regions': [], 'georeferencing': 'TIFF CRS unavailable; source pixel coordinates only; no inferred map positions',
                'display': 'RGB PS, per-scene valid-pixel p2-p98 stretch, gamma 1.2; no super-resolution'}
    for xml in sorted(args.inbox.glob('*_L2G_Aux.xml')):
        scene = xml.name.removesuffix('_L2G_Aux.xml')
        check = cas.verify(args.inbox, scene)
        if check['status'] != 'downloaded-header-checked':
            continue
        datasets = [rasterio.open(next(f['path'] for f in check['files'] if f['band'] == b+'_PS')) for b in 'RGB']
        try:
            d = datasets[0]
            if any((s.width, s.height) != (d.width, d.height) for s in datasets):
                raise ValueError('RGB dimensions do not match')
            shape = (round(d.height*1600/d.width), 1600)
            rgb = np.stack([s.read(1, out_shape=shape) for s in datasets], axis=2)
            valid = np.all(rgb > 0, axis=2)
            limits = [np.percentile(rgb[:, :, i][valid], [2, 98]).tolist() for i in range(3)]
            overview = Image.fromarray(stretch(rgb, limits))
            overview.save(args.output / (scene+'-overview.jpg'), quality=92)
            info = {'id': scene, 'width': d.width, 'height': d.height, 'crs': str(d.crs),
                    'bands': check['files'], 'xmlSha256': hashlib.sha256(xml.read_bytes()).hexdigest(),
                    'limits': limits, 'overview': scene+'-overview.jpg'}
            manifest['scenes'].append(info)
            draw = ImageDraw.Draw(overview)
            for region in (r for r in regions if r['scene'] == scene):
                x, y, size = (int(region[k]) for k in ('x', 'y', 'size'))
                if x < 0 or y < 0 or x+size > d.width or y+size > d.height:
                    raise ValueError('Region outside scene: '+region['id'])
                crop = np.stack([s.read(1, window=Window(x,y,size,size)) for s in datasets], axis=2)
                valid_fraction = float(np.all(crop > 0, axis=2).mean())
                folder = args.output / region['id']
                folder.mkdir(exist_ok=True)
                path = folder / 'source.png'
                Image.fromarray(stretch(crop, limits)).save(path)
                entry = {**region, 'validFraction': valid_fraction, 'image': str(path.resolve()),
                         'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'limits': limits}
                manifest['regions'].append(entry)
                scale = 1600 / d.width
                draw.rectangle((x*scale,y*scale,(x+size)*scale,(y+size)*scale), outline='yellow', width=2)
                draw.text((x*scale,y*scale),region['id'],fill='yellow')
                print(region['id'],valid_fraction,flush=True)
            overview.save(args.output / (scene+'-regions.jpg'), quality=92)
            print(scene, d.shape, limits, flush=True)
        finally:
            for d in datasets: d.close()
    (args.output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')


if __name__ == '__main__':
    main()
