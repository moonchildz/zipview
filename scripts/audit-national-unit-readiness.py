"""Summarize per-complex plan evidence gaps without claiming finished models."""
import csv
import json
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'research/linkage/generated/national-units'
DB = OUT / 'units.sqlite'


def main():
    if not DB.exists():
        raise SystemExit('National unit registry is not complete yet')
    db = sqlite3.connect(DB.as_uri() + '?mode=ro', uri=True)
    groups = {}
    provinces = defaultdict(lambda: {'groups': 0, 'units': 0, 'linkedUnits': 0, 'planCandidateUnits': 0})
    for gid, province, district, name, address, count in db.execute(
            'SELECT id,province,district,name,road_address,unit_count FROM complexes'):
        groups[gid] = [province, district, name, address, count, 0, 0]
        provinces[province]['groups'] += 1
        provinces[province]['units'] += count
    for gid, linked, strong in db.execute('''SELECT u.complex_id,COUNT(DISTINCT u.source_row),
            COUNT(DISTINCT CASE WHEN p.status='provider-unit-area-consistent'
              AND p.image_files IS NOT NULL AND p.image_files!='[]' THEN u.source_row END)
            FROM provider_links p JOIN units u ON u.source_row=p.source_row GROUP BY u.complex_id'''):
        if gid in groups:
            groups[gid][5] = linked
            groups[gid][6] = strong
            province = groups[gid][0]
            provinces[province]['linkedUnits'] += linked
            provinces[province]['planCandidateUnits'] += strong
    with (OUT / 'complex-readiness.csv').open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.writer(stream)
        writer.writerow(['complex_id', 'province', 'district', 'name', 'road_address',
                         'unit_rows', 'provider_linked_units', 'plan_candidate_units', 'no_plan_candidate_units'])
        for gid, (province, district, name, address, count, linked, strong) in groups.items():
            writer.writerow([gid, province, district, name, address, count, linked, strong, count - strong])
    summary = {
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'sourceYear': 2025,
        'sourceRows': sum(v['units'] for v in provinces.values()),
        'sourceDerivedComplexGroups': len(groups),
        'providerLinkedUnits': sum(v['linkedUnits'] for v in provinces.values()),
        'planCandidateUnits': sum(v['planCandidateUnits'] for v in provinces.values()),
        'noPlanCandidateUnits': sum(v['units'] - v['planCandidateUnits'] for v in provinces.values()),
        'rowsWithoutBuildingName': db.execute('SELECT count(*) FROM units WHERE building IS NULL OR length(trim(building))=0').fetchone()[0],
        'groupsWithAnyPlanCandidate': sum(v[6] > 0 for v in groups.values()),
        'groupsWithAllUnitsPlanCandidate': sum(v[4] > 0 and v[4] == v[6] for v in groups.values()),
        'byProvince': dict(sorted(provinces.items())),
        'definition': 'A plan candidate has a provider-unit-area-consistent link to at least one image. No layout, placement, orientation, window or view is validated by this audit.',
    }
    (OUT / 'readiness-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in summary.items() if k != 'byProvince'}, ensure_ascii=False, indent=2))
    db.close()


if __name__ == '__main__':
    main()
