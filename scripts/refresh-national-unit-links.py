"""Import a rebuilt provider/household match index without rereading 15.6M CSV rows."""
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'research/linkage/generated/national-units'
REGISTRY = OUT / 'units.sqlite'
LINKS = ROOT / 'research/linkage/generated/connected-materials/household-plans.sqlite'


def main():
    if not REGISTRY.exists() or not LINKS.exists():
        raise SystemExit('Both the national registry and rebuilt household-plan index are required')
    db = sqlite3.connect(REGISTRY, timeout=120)
    try:
        db.execute('ATTACH DATABASE ? AS source', (str(LINKS),))
        missing = db.execute('''SELECT count(*) FROM source.links l
                                LEFT JOIN units u ON u.source_row=l.source_row
                                WHERE u.source_row IS NULL''').fetchone()[0]
        if missing:
            raise RuntimeError(f'{missing} provider links refer to missing national source rows')
        db.execute('BEGIN IMMEDIATE')
        db.execute('DELETE FROM provider_links')
        db.execute('''INSERT INTO provider_links(source_row,entity,area_ids,status,image_files)
                      SELECT source_row,entity,area_ids,status,image_files FROM source.links''')
        links = db.execute('SELECT count(*) FROM provider_links').fetchone()[0]
        units = db.execute('SELECT count(DISTINCT source_row) FROM provider_links').fetchone()[0]
        db.commit()
        db.execute('DETACH DATABASE source')
        summary_file = OUT / 'summary.json'
        summary = json.loads(summary_file.read_text(encoding='utf-8'))
        summary.update(providerLinks=links, providerLinkedUnits=units,
                       providerLinksRefreshedAt=datetime.now(timezone.utc).isoformat())
        temporary = summary_file.with_suffix('.tmp')
        temporary.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
        os.replace(temporary, summary_file)
        print(json.dumps({'providerLinks': links, 'providerLinkedUnits': units}, ensure_ascii=False))
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == '__main__':
    main()
