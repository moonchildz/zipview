"""Read-only, paginated viewer for the 2025 national apartment unit registry."""
import argparse
import json
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'research/linkage/generated/national-units'
DB = OUT / 'units.sqlite'


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        request = urlsplit(self.path)
        params = parse_qs(request.query)
        arg = lambda key, default='': params.get(key, [default])[0]
        if request.path in ('/', '/review.html'):
            body = (ROOT / 'scripts/national-units-review.html').read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if request.path == '/api/status':
            progress = OUT / 'progress.json'
            summary = OUT / 'summary.json'
            readiness = OUT / 'readiness-summary.json'
            return self.send_json(dict(progress=json.loads(progress.read_text(encoding='utf-8')) if progress.exists() else {'stage': 'not-started'},
                                       summary=json.loads(summary.read_text(encoding='utf-8')) if summary.exists() else None,
                                       readiness=json.loads(readiness.read_text(encoding='utf-8')) if readiness.exists() else None))
        if request.path == '/complex-readiness.csv':
            file = OUT / 'complex-readiness.csv'
            if not file.exists():
                return self.send_json({'error': '자료 공백 집계 전입니다.'}, 404)
            self.send_response(200)
            self.send_header('Content-Type', 'text/csv; charset=utf-8')
            self.send_header('Content-Length', str(file.stat().st_size))
            self.end_headers()
            try:
                with file.open('rb') as stream:
                    while block := stream.read(256 * 1024):
                        self.wfile.write(block)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        if not DB.exists():
            return self.send_json({'error': '전국 동·호수 색인 생성 중입니다. /api/status에서 진행 상태를 확인하세요.'}, 503)
        db = sqlite3.connect(DB.as_uri() + '?mode=ro', uri=True)
        db.row_factory = sqlite3.Row
        try:
            offset = min(max(int(arg('offset', '0')), 0), 15_580_435)
            if request.path == '/api/complexes':
                q = arg('q').strip()[:100]
                province = arg('province').strip()[:30]
                where = '(name LIKE ? OR road_address LIKE ? OR complex_code=?) AND (?="" OR province=?)'
                values = ['%' + q + '%', '%' + q + '%', q, province, province]
                rows = [dict(row) for row in db.execute('SELECT * FROM complexes WHERE ' + where +
                                                        ' ORDER BY unit_count DESC,name LIMIT 50 OFFSET ?', values + [offset])]
                total = db.execute('SELECT count(*) FROM complexes WHERE ' + where, values).fetchone()[0]
                return self.send_json(dict(total=total, offset=offset, rows=rows))
            if request.path == '/api/units':
                complex_id = arg('complex_id')
                if not (len(complex_id) == 24 and all(c in '0123456789abcdef' for c in complex_id)):
                    return self.send_json({'error': 'complex_id가 필요합니다.'}, 400)
                complex_row = db.execute('SELECT * FROM complexes WHERE id=?', (complex_id,)).fetchone()
                if not complex_row:
                    return self.send_json({'error': '단지를 찾을 수 없습니다.'}, 404)
                building = arg('building').strip()[:60]
                if building.startswith('#'):
                    where = 'complex_id=? AND building_code=?'
                    values = [complex_id, building[1:]]
                else:
                    where = 'complex_id=? AND (?="" OR building=?)'
                    values = [complex_id, building, building]
                rows = [dict(row) for row in db.execute('SELECT * FROM units WHERE ' + where +
                                                        ' ORDER BY building,unit LIMIT 100 OFFSET ?', values + [offset])]
                for row in rows:
                    row['planLinks'] = [dict(link) for link in db.execute(
                        'SELECT entity,area_ids,status,image_files FROM provider_links WHERE source_row=?', (row['source_row'],))]
                total = db.execute('SELECT count(*) FROM units WHERE ' + where, values).fetchone()[0]
                return self.send_json(dict(complex=dict(complex_row), total=total, offset=offset, rows=rows))
            return self.send_json({'error': 'not found'}, 404)
        except (ValueError, sqlite3.Error) as error:
            return self.send_json({'error': str(error)}, 400)
        finally:
            db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=5183)
    args = parser.parse_args()
    print(f'http://127.0.0.1:{args.port}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
