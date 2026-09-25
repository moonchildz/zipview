"""Preserve exact 1:1,000 NGI map requests excluded by the ZIP verifier."""
import csv
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NATIONAL = ROOT / '.tools/national'
OUT = NATIONAL / 'raw-ngi'


def main():
    jobs = json.loads((NATIONAL / 'jobs.json').read_text(encoding='utf-8'))
    OUT.mkdir(parents=True, exist_ok=True)
    queue = []
    counts = Counter()
    for job in jobs:
        if job['dataset'] != 'maps' or job['scale'] != 1000:
            continue
        review = ROOT / job['state'] / 'source-review.json'
        if not review.exists():
            continue
        for entry in json.loads(review.read_text(encoding='utf-8')):
            item = entry['item']
            if item.get('fileExt') != 'ngi':
                continue
            queue.append({'district': job['district'], 'region': job['region'], 'scale': 1000,
                          'number': item.get('num'), 'objectId': item.get('objectid'),
                          'name': item.get('name'), 'makeYear': item.get('makeYer'),
                          'notice': item.get('gosiYer'), 'history': item.get('historyNo'),
                          'bounds5179': [item.get(k) for k in ('minx', 'miny', 'maxx', 'maxy')],
                          'sourceFormat': 'ngi', 'status': 'source-format-needs-download-and-verification'})
            counts[job['region']] += 1
    with (OUT / 'requests.csv').open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=list(queue[0]) if queue else [])
        if queue:
            writer.writeheader()
            writer.writerows(queue)
    report = {'preparedAt': datetime.now(timezone.utc).isoformat(), 'scale': 1000,
              'format': 'ngi', 'requests': len(queue), 'byRegion': dict(counts),
              'note': 'These are public catalogue records only, not downloaded files. The existing ZIP/XML verifier cannot mark NGI raw files verified. Portal login is required for a transfer probe.'}
    (OUT / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
