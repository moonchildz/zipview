# 전국 OSM 길 사전 처리

2026-09-17. 위성 영상과 독립적으로 도로·보행로를 준비한다. 전국 배포 파일을 내려받고, EPSG:5179 기준 SQLite 공간 인덱스에 저장한다. 원하는 범위만 조회할 수 있으므로 최초 단계에서는 전국을 수많은 JSON 격자로 복제하지 않는다.

## 원본과 저장 범위

- 제공: https://download.geofabrik.de/asia/south-korea.html
- 고정 원본: `south-korea-260915.osm.pbf` (287,326,352 bytes)
- 제공자 MD5: `a77f70c413bbd1031fee926fba165d25`, 원본 URL에 `.md5`를 붙인 파일에서 확인.
- 라이선스: OpenStreetMap contributors / ODbL-1.0. 배포·공개 시 출처와 라이선스를 유지한다.
- 도로, 단지 내 서비스 도로, 보행로, 산책로, 계단, 자전거길 등을 보존한다. OSM에 없는 길은 생성하지 않는다.
- 원본 highway way 태그와 중심선, 폭, 폭의 근거, 폭을 적용한 면, 지상 사용 가능 여부 및 제외 사유를 저장한다.
- 유효한 width 태그를 우선한다. 없으면 차로 수 또는 종류별 추정 폭을 사용한다. 기존 화면의 폭 가정을 기반으로 하되 명시 폭은 최대 100m까지 허용하고 추정 차로 폭은 35m로 제한한다.
- 교량·터널·덮개·실내·0이 아닌 layer/level 또는 불명확한 층은 지상 식생 제외용에서 제외하되 DB에는 보존한다.
- 유효한 닫힌 highway area way는 실제 면을 사용한다. 관계(relation) 기반 복합 보행 면의 조립은 아직 지원하지 않는다.
- 지상 여부는 태그 기반이며 실측 높이 검증이 아니다. 영상·OSM 촬영/수정 시점 차이가 남는다.

## 실행

```powershell
& .tools/aerial-python/Scripts/python.exe -m pip install -r scripts/requirements-osm.txt
& .tools/aerial-python/Scripts/python.exe scripts/collect_osm_roads.py --refresh-reviews
```

최초 전국 처리는 완료했다(2026-09-17 03:55 KST). 길 객체 1,809,870개를 저장했고 지상 사용 가능 객체는 1,654,333개다. 유효하지 않은 길 1개는 건너뛴 기록이 있다. 실제 진행률과 완료 여부는 `research/osm/generated/pipeline-status.json`이 기준이다. 컴퓨터 종료로 중단되면 같은 명령으로 이어받는다. 네트워크 오류는 대기 후 최대 3회 시도하고, 실패 상태와 부분 파일을 남긴다. 실행 잠금으로 중복 작업을 막는다.

1. `.partial`로 다운로드하고 재실행 시 HTTP Range로 이어받는다.
2. 크기와 MD5 검증을 통과해야 원본 파일로 확정한다. SHA-256도 기록한다.
3. 원본에서 길 데이터를 처리해 임시 DB에 저장하고 무결성 검사 후 최종 DB로 교체한다.
4. `--refresh-reviews` 사용 시 양재천·한강의 수치지도 도로에 OSM 지상 길을 합쳐 식생 제외 결과를 다시 만든다. 마스크 검증을 통과한 뒤 완료 상태로 기록한다.

전국 DB: `research/osm/generated/south-korea-roads.sqlite`.
원본·DB·생성 결과는 Git에서 제외한다. DB에 원본 해시·OSM 시각·처리 버전·집계·라이선스를 기록한다. 전국 추출 영역은 제공자 범위이며 완전한 현황 도로망을 보장하지 않는다.

## 구역 조회와 마스크 저장

```powershell
# EPSG:5179 미터 좌표: minx miny maxx maxy
& .tools/aerial-python/Scripts/python.exe scripts/osm_road_store.py query --bbox 952000 1951900 953100 1953100 --output research/osm/generated/region-roads.json
# 기존 위성 구역의 좌표/해상도를 그대로 사용하여 길 면을 래스터화
& .tools/aerial-python/Scripts/python.exe scripts/export_osm_road_mask.py verification/xi-grove/scene.json research/osm/generated/xi-national-preview
# 길을 식생에서 제외하는 기존 흐름에 직접 연결
& .tools/aerial-python/Scripts/python.exe scripts/prepare-road-filtered-vegetation.py --site han --osm-db research/osm/generated/south-korea-roads.sqlite
```

조회는 폭을 적용한 면의 경계로 후보를 찾고 실제 교차 여부를 검사한다. 따라서 조회 구역 밖에 중심선이 있어도 폭이 구역에 닿으면 포함된다. JSON 좌표는 EPSG:5179이며 경위도 GeoJSON으로 해석하면 안 된다. 도로 접근 제한 태그도 보존하지만 현재 작업은 시각화·식생 제외용으로, 보행 경로 안내용이 아니다.

## 검증과 화면

- `osm-road-review.html`: 전국 진행 상태와 경희궁자이 표본 표시.
- 경희궁자이 기존 XML 표본: 258개 저장, 지상 사용 242개, 제외 16개. 전국 완료 결과와 구별한다.
- `research/osm/generated/xi-pilot-roads.sqlite`, `xi-preview/road-mask.png`, `xi-preview/roads.json` 저장 완료.
- `tests/test_osm_road_store.py`: 다운로드 이어받기/검증 실패, 지상 분리, 폭 근거, 구역을 통과하는 길 조회, 실패한 재생성이 기존 DB를 훼손하지 않는지 검증.
- 저장 스키마나 처리 규칙 변경 시 `processingVersion`을 올려 재생성한다.

### 미리보기 범위 보완

최종 미리보기는 전국 DB에서 해당 영상 범위를 다시 조회한 `xi-national-preview`를 사용한다. 지상 길 560개, 제외 객체 25개이며, 이전 주변 표본의 385개에서 늘었다. 좌상단·우상단·우하단 큰 도로가 이어지는 것을 영상 대조로 확인했다. 추가 segmentation이나 수동 연결은 하지 않았다. `osm-road-review.html`에서 이전 결과와 전환 비교할 수 있다.

```powershell
& .tools/aerial-python/Scripts/python.exe scripts/export_osm_road_mask.py verification/xi-grove/scene.json research/osm/generated/xi-national-preview
```

초기 `osm.xml`의 요청 경계는 경도 126.961–126.968, 위도 37.568–37.574로 약 620×670m다. 1024m 위성 구역보다 좁아 경계 밖 일부 길만 이어져 보이는 문제가 있었다. 이를 전국 데이터의 완성도로 해석하면 안 된다.

기존 `research/gyeonghuigung-xi/scene.json`에 보존된 주변 길 1851개를 별도 `xi-merged-roads.sqlite`에 저장했다. 이 자료의 로컬 x/z 좌표를 원래 경위도로 역변환해 사용하며, 원본 시점이 혼합된 검증 자료다. 위성 구역과 교차하는 지상 길은 385개(이전 242개), 제외 객체는 16개다. `xi-merged-preview/road-context-review.jpg`에서 지상 면은 파랑, 교량·터널 등 제외 면은 주황으로 보여준다. 실제 식생 제외 마스크에는 주황 영역을 추가하지 않는다. 폭을 산정하지 못한 선 객체는 제외 목록에만 남을 수 있다. 초기 결과는 비교용으로 유지한다.

```powershell
& .tools/aerial-python/Scripts/python.exe scripts/osm_road_store.py build research/gyeonghuigung-xi/scene.json --db research/osm/generated/xi-merged-roads.sqlite --scope xi-legacy-merged
& .tools/aerial-python/Scripts/python.exe scripts/export_osm_road_mask.py verification/xi-grove/scene.json research/osm/generated/xi-merged-preview --db research/osm/generated/xi-merged-roads.sqlite
```
