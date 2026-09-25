"""Download a pinned national extract, verify it, then build the offline road store.

Restarting resumes the partial file; successful downloads and builds are reused.
No Overpass queries or paid services are used.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

from osm_road_store import build, DEFAULT_DB, digest, now

URL = 'https://download.geofabrik.de/asia/south-korea-260915.osm.pbf'
EXPECTED_MD5 = 'a77f70c413bbd1031fee926fba165d25'
EXPECTED_BYTES = 287326352
RAW = Path('research/osm/raw/south-korea-260915.osm.pbf')
STATUS = Path('research/osm/generated/pipeline-status.json')


def status(phase, **extra):
    record = dict(phase=phase, updatedAt=now(), pid=os.getpid(), sourceUrl=URL,
                  expectedBytes=EXPECTED_BYTES, **extra)
    STATUS.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATUS.with_suffix('.tmp')
    tmp.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp.replace(STATUS)
    with STATUS.with_suffix('.log').open('a', encoding='utf-8') as log:
        log.write(json.dumps(record, ensure_ascii=False) + '\n')
    print(json.dumps(record), flush=True)


def download():
    RAW.parent.mkdir(parents=True, exist_ok=True)
    partial = RAW.with_suffix(RAW.suffix + '.partial')
    if RAW.exists():
        if RAW.stat().st_size == EXPECTED_BYTES and digest(RAW, 'md5') == EXPECTED_MD5:
            return
        raise ValueError('Existing final source failed validation; preserve it for inspection')
    for attempt in range(3):
        offset = partial.stat().st_size if partial.exists() else 0
        if offset == EXPECTED_BYTES:
            break
        if offset > EXPECTED_BYTES:
            raise ValueError('Partial source is larger than expected')
        headers = {'User-Agent': 'Zipview-OSM-Offline/0.1'}
        if offset:
            headers['Range'] = f'bytes={offset}-'
        status('downloading', downloadedBytes=offset, attempt=attempt + 1)
        try:
            with urllib.request.urlopen(urllib.request.Request(URL, headers=headers), timeout=60) as response:
                if offset and (response.status != 206 or not response.headers.get('Content-Range', '').startswith(f'bytes {offset}-')):
                    raise ValueError('Server did not honor resume; refusing to append')
                last = time.monotonic()
                with partial.open('ab' if offset else 'wb') as out:
                    while chunk := response.read(256 * 1024):
                        out.write(chunk)
                        offset += len(chunk)
                        if offset > EXPECTED_BYTES:
                            raise ValueError('Download exceeds pinned source size')
                        if time.monotonic() - last >= 15:
                            out.flush()
                            status('downloading', downloadedBytes=offset,
                                   percent=round(offset / EXPECTED_BYTES * 100, 2))
                            last = time.monotonic()
            break
        except (OSError, TimeoutError) as error:
            if attempt == 2:
                raise
            status('retry-wait', downloadedBytes=partial.stat().st_size if partial.exists() else 0, error=str(error))
            time.sleep(30 * (attempt + 1))
    status('verifying', downloadedBytes=partial.stat().st_size)
    if partial.stat().st_size != EXPECTED_BYTES or digest(partial, 'md5') != EXPECTED_MD5:
        raise ValueError('Source size/MD5 mismatch; partial file retained, not imported')
    partial.replace(RAW)
    RAW.with_suffix('.source.json').write_text(json.dumps(dict(url=URL, downloadedAt=now(),
        bytes=EXPECTED_BYTES, md5=EXPECTED_MD5, sha256=digest(RAW),
        checksumUrl=URL + '.md5', license='ODbL-1.0'), indent=2), encoding='utf-8')


def run(refresh_reviews=False):
    download()
    manifest_file = DEFAULT_DB.with_suffix('.manifest.json')
    existing = json.loads(manifest_file.read_text(encoding='utf-8')) if manifest_file.exists() else {}
    if not (DEFAULT_DB.exists() and existing.get('sourceSha256') == digest(RAW) and existing.get('processingVersion') == 1):
        status('building', downloadedBytes=EXPECTED_BYTES)
        existing = build(RAW, DEFAULT_DB, URL, 'south-korea-extract')
    refreshed = []
    if refresh_reviews:
        for site in ('yangjae', 'han'):
            if not Path(f'verification/{site}-grove/scene.json').exists():
                continue
            status('refreshing-review', site=site)
            subprocess.run([sys.executable, 'scripts/prepare-road-filtered-vegetation.py',
                            '--site', site, '--osm-db', str(DEFAULT_DB)], check=True)
            refreshed.append(site)
        if refreshed:
            status('validating-reviews', refreshedReviews=refreshed)
            subprocess.run([sys.executable, 'tests/check_road_filtered_artifacts.py'], check=True)
    status('complete', database=str(DEFAULT_DB), counts=existing['counts'], refreshedReviews=refreshed)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh-reviews', action='store_true')
    args = parser.parse_args()
    # OS lock is released even on process termination; avoids concurrent writes/resumes.
    STATUS.parent.mkdir(parents=True, exist_ok=True)
    with STATUS.with_suffix('.lock').open('a+b') as lock:
        lock.seek(0); lock.write(b'0'); lock.flush(); lock.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            run(args.refresh_reviews)
        except Exception as error:
            status('failed', error=str(error))
            raise
