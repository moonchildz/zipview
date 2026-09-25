"""Read-only localhost viewer for the offline material index."""
import argparse
import json
import mimetypes
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'research/linkage/generated/connected-materials'


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send_json(self, data, status=200):
        raw=json.dumps(data,ensure_ascii=False).encode('utf8')
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(raw)))
        self.send_header('Cache-Control','no-store')
        self.end_headers(); self.wfile.write(raw)

    def do_GET(self):
        parsed=urlsplit(self.path); params=parse_qs(parsed.query)
        arg=lambda key,default='':params.get(key,[default])[0]
        if parsed.path in ['/', '/review.html']:
            return self.send_file(ROOT/'scripts/connected-materials-review.html')
        if parsed.path=='/api/recovery':
            progress=OUT/'recovery-progress.json'
            if progress.exists():return self.send_json(json.loads(progress.read_text(encoding='utf8')))
            return self.send_json({'stage':'not-started'})
        database=OUT/'library.sqlite'
        if not database.exists():database=OUT/'library.build.sqlite'
        if not database.exists():
            return self.send_json({'error':'색인 생성 중입니다.'},503)
        db=sqlite3.connect(database.as_uri()+'?mode=ro',uri=True)
        db.row_factory=sqlite3.Row
        try:
            if parsed.path=='/api/summary':
                row=db.execute("SELECT value FROM metadata WHERE key='summary'").fetchone()
                if row:return self.send_json(json.loads(row[0]))
                return self.send_json(dict(stage='indexing',finishedAt='진행 중',entitiesBySource=dict(db.execute('SELECT source,count(*) FROM entities GROUP BY source')),
                    files=db.execute('SELECT count(*) FROM files').fetchone()[0],
                    kbWithPublicCandidates=db.execute("SELECT count(DISTINCT target) FROM links WHERE target LIKE 'kb:%' AND source NOT LIKE 'kb:%'").fetchone()[0]))
            if parsed.path=='/api/search':
                q='%'+arg('q')+'%'; source=arg('source')
                offset=max(0,int(arg('offset','0')))
                where="(e.name LIKE ? OR e.address LIKE ? OR e.id LIKE ?) AND (?='' OR e.source=?)"
                values=[q,q,q,source,source]
                total=db.execute('SELECT count(*) FROM entities e WHERE '+where,values).fetchone()[0]
                rows=[dict(r) for r in db.execute('''SELECT e.id,e.source,e.name,e.address,
                    (SELECT count(*) FROM attachments a WHERE a.entity=e.id) assets,
                    (SELECT count(DISTINCT source) FROM links l WHERE l.target=e.id AND l.status!='weak') relatedSources
                    FROM entities e WHERE '''+where+' ORDER BY e.source,e.name LIMIT 50 OFFSET ?',values+[offset])]
                return self.send_json(dict(total=total,rows=rows))
            if parsed.path=='/api/detail':
                eid=arg('id'); offset=max(0,int(arg('offset','0')))
                record=db.execute('SELECT * FROM entities WHERE id=?',(eid,)).fetchone()
                if not record:return self.send_json({'error':'not found'},404)
                result=dict(record);result['metadata']=json.loads(result['metadata'])
                result['attachmentTotal']=db.execute('SELECT count(*) FROM attachments WHERE entity=?',(eid,)).fetchone()[0]
                result['attachments']=[dict(r) for r in db.execute('''SELECT a.*,f.status,f.bytes,f.detail
                    FROM attachments a LEFT JOIN files f ON a.file=f.path WHERE a.entity=? LIMIT 100 OFFSET ?''',(eid,offset))]
                result['links']=[dict(r) for r in db.execute('''SELECT l.source,l.target,l.method,l.status,l.file,l.locator,l.evidence,e.name
                    FROM links l LEFT JOIN entities e ON e.id=CASE WHEN l.target=? THEN l.source ELSE l.target END
                    WHERE l.target=? OR l.source=? ORDER BY CASE l.status WHEN 'supported' THEN 0 WHEN 'candidate' THEN 1 ELSE 2 END,l.method LIMIT 200''',(eid,eid,eid))]
                result['linkTotal']=db.execute('SELECT count(*) FROM links WHERE target=? OR source=?',(eid,eid)).fetchone()[0]
                result['evidence']=[dict(r) for r in db.execute('SELECT * FROM evidence WHERE entity=? LIMIT 200',(eid,))]
                result['evidenceTotal']=db.execute('SELECT count(*) FROM evidence WHERE entity=?',(eid,)).fetchone()[0]
                env=db.execute('SELECT data FROM environment WHERE entity=?',(eid,)).fetchone()
                result['environment']=json.loads(env[0]) if env else None
                result['officialHouseholds']=self.households(eid,0)
                return self.send_json(result)
            if parsed.path=='/api/households':
                return self.send_json(self.households(arg('id'),max(0,int(arg('offset','0')))))
            if parsed.path=='/api/files':
                q='%'+arg('q')+'%'; offset=max(0,int(arg('offset','0')))
                state=arg('status')
                where="(f.path LIKE ? OR EXISTS(SELECT 1 FROM attachments a WHERE a.file=f.path AND (a.label LIKE ? OR a.type LIKE ?))) AND (?='' OR f.status=?)"
                values=[q,q,q,state,state]
                total=db.execute('SELECT count(*) FROM files f WHERE '+where,values).fetchone()[0]
                rows=[dict(r) for r in db.execute('SELECT f.* FROM files f WHERE '+where+' ORDER BY f.path LIMIT 50 OFFSET ?',values+[offset])]
                return self.send_json(dict(total=total,rows=rows))
            if parsed.path=='/original':
                candidate=(ROOT/arg('file')).resolve()
                try: file=candidate.relative_to(ROOT).as_posix()
                except ValueError:return self.send_json({'error':'outside workspace'},403)
                allowed=db.execute('SELECT 1 FROM files WHERE path=? UNION SELECT 1 FROM entities WHERE manifest=? LIMIT 1',(file,file)).fetchone()
                # Map archives are preserved references from the audited 1:1000 index.
                if not allowed and candidate.parent==ROOT/'mapinfo':
                    allowed=db.execute("SELECT 1 FROM environment WHERE instr(data,?)>0 LIMIT 1",(candidate.name,)).fetchone()
                if not allowed:return self.send_json({'error':'not in index'},403)
                return self.send_file(candidate)
            if parsed.path in ['/entities.csv','/links.csv','/material-matrix.csv','/summary.json','/attachments.csv','/type-assets.csv','/file-review.csv','/households-summary.json','/household-plans-summary.json']:
                return self.send_file(OUT/parsed.path[1:])
            return self.send_json({'error':'not found'},404)
        except (ValueError, sqlite3.Error) as e:
            self.send_json({'error':str(e)},400)
        finally:
            db.close()

    def households(self,eid,offset):
        file=OUT/'households.sqlite'
        if not file.exists():return {'status':'indexing-or-unavailable','total':0,'rows':[]}
        with sqlite3.connect(file.as_uri()+'?mode=ro',uri=True) as d:
            d.row_factory=sqlite3.Row
            count=d.execute('SELECT count(*) FROM matches WHERE entity=?',(eid,)).fetchone()[0]
            rows=[dict(r) for r in d.execute('''SELECT u.*,m.method FROM matches m JOIN units u ON u.source_row=m.source_row
                 WHERE m.entity=? ORDER BY m.source_row LIMIT 100 OFFSET ?''',(eid,offset))]
            plan_db=OUT/'household-plans.sqlite'
            if plan_db.exists():
                p=sqlite3.connect(plan_db.as_uri()+'?mode=ro',uri=True)
                try:
                    for row in rows:
                        link=p.execute('SELECT area_ids,status,image_files FROM links WHERE entity=? AND source_row=?',(eid,row['source_row'])).fetchone()
                        if link:row['providerPlanEvidence']=dict(areaIds=json.loads(link[0]),status=link[1],imageFiles=json.loads(link[2]))
                finally:p.close()
            return dict(status='2025-official-source-address-matches',total=count,offset=offset,rows=rows,
                        source='research/linkage/downloads/housing/housing-2025.zip',
                        note='주소·지번으로 연결한 2025년 원본입니다. 현재 단지 전체 세대의 완전성이나 평면 타입을 확정하지 않습니다.')

    def send_file(self,path):
        if not path.is_file():return self.send_json({'error':'file missing'},404)
        size=path.stat().st_size
        self.send_response(200)
        content_type=mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        if path.suffix.lower() in {'.html','.htm','.js','.svg'} and path!=ROOT/'scripts/connected-materials-review.html':
            content_type='text/plain; charset=utf-8'
        self.send_header('Content-Type',content_type)
        self.send_header('Content-Length',str(size))
        self.send_header('X-Content-Type-Options','nosniff')
        self.end_headers()
        try:
            with path.open('rb') as f:
                while block:=f.read(256*1024):self.wfile.write(block)
        except (BrokenPipeError,ConnectionResetError):pass


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=5182)
    args=p.parse_args()
    print(f'http://127.0.0.1:{args.port}',flush=True)
    ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
