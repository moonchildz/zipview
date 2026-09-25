# 받은 원본을 단지·자료 종류에 연결

2026-09-23. 모델 생성 없이 로컬 원본을 다시 검사하고 검색·연결하는 파이프라인이다.

## 실행

```powershell
.tools/aerial-python/Scripts/python.exe -m pip install -r scripts/requirements-material-linkage.txt
.tools/aerial-python/Scripts/python.exe scripts/connect-downloaded-materials.py
.tools/aerial-python/Scripts/python.exe scripts/connect-national-households.py
.tools/aerial-python/Scripts/python.exe scripts/connect-household-plans.py
.tools/aerial-python/Scripts/python.exe scripts/connect-material-environment.py
.tools/aerial-python/Scripts/python.exe scripts/serve-connected-materials.py --port 5182
```

검토 화면: <http://127.0.0.1:5182>. 서버는 localhost에만 바인딩한다.

## 무엇을 연결하는가

- KB 기존 단지 전체, SH 저장 단지 기록 전체, LH 저장 공고 전체, 건설사 저장 기록 전체를 스냅샷으로 읽는다. 이후 수집된 파일은 재실행 시 추가된다.
- `research/linkage/downloads`의 나머지 파일도 목록에 보존한다. 어느 단지와 연결되는지 모르는 파일을 버리지 않는다. 다운로드 중인 `.part`는 완료 원본으로 취급하지 않는다.
- 기관 자체 기록에 첨부된 파일은 해당 출처 기록에 직접 연결한다. 원본 파일명, URL, 기관 타입 표기를 보존한다. KB 동호수 목록은 원본 JSON 경로를 통해 사용한다.
- 공통 주소, 공고 제목, 문서의 단지명·도로명주소를 근거로 출처 간 연결을 만든다. LH 공고는 단지로 세지 않는다. 여러 단지 공고에 속한 전체 파일을 특정 단지 자료로 확정하지 않는다.
- PDF는 페이지별 텍스트, HWP는 본문 섹션, HWPX·Office Open XML은 XML 본문, ZIP은 내부 항목과 지원 문서의 텍스트를 색인한다. 내부 파일은 디스크에 풀거나 실행하지 않는다.
- 평면도·단지배치도·동호배치표·공급목록·높이·팸플릿·CAD 관련 키워드의 위치와 발췌문을 저장한다. 키워드 출현은 그 도면이 실제 수록됐다는 확정 판정이 아니다.
- 좌표가 있는 KB·SH 기록에 기존 **1:1,000만** 사용한 지도 색인, 다운로드된 RGB 영상과 카탈로그 영역, 로컬 OSM 도로를 연결한다. 원본 지도 ZIP과 RGB 파일 경로, OSM 객체 ID를 보존한다.
- 이미 받은 전국 공동주택 공시가격 CSV 15,580,435행 전체를 스트리밍하고 원본 SHA-256과 행 수를 검증한다. 도로명주소와 확보된 지번으로 KB·SH 기록에 연결한다. 2025년 자료이므로 현재 재건축·신축·분할 현황과 다를 수 있다.
- 공식 동호수 행을 기존 KB 동·호 및 전용면적과 대조한다. 면적만 같은 경우나 반올림한 면적이 같은 경우는 별도 후보이며, 같은 면적의 여러 타입을 임의로 하나로 정하지 않는다. 이 연결은 기존 앱의 세대별 타입 할당을 변경하지 않는다.

## 결과와 활용

경로: `research/linkage/generated/connected-materials/`

| 파일 | 내용 |
|---|---|
| `library.sqlite` | entities / files / attachments / evidence / links / environment / issues |
| `entities.csv` | 단지·공고 원본 기록과 타입 등 메타데이터 |
| `links.csv` | 출처 간 연결의 방법·상태·원본 파일·페이지 |
| `summary.json` | 완료된 스냅샷의 집계 |
| `environment-summary.json` | 주변 자료 공간 연결 집계 |
| `progress.json` | 문서 색인 진행 상태 |
| `text-cache.sqlite` | 크기·수정시각·파서 버전으로 재사용하는 추출 캐시 |
| `households.sqlite` | 공식 세대 행과 단지별 주소·지번 연결 |
| `household-plans.sqlite` | 공식 세대 → KB 타입 근거, 면적 후보, 충돌 |
| `material-matrix.csv` | 단지별 도면 후보·공식 세대·지도·영상·OSM 보유 대조표 |
| `attachments.csv`, `type-assets.csv` | 출처별·타입별 실제 원본 연결 |
| `file-review.csv` | 파서 오류, 텍스트 없음, 미지원 형식 등 추가 검토 |

검토 화면에서 단지명 검색 → 직접 첨부와 타입 확인 → 연결 근거의 원본 페이지 열기 순으로 사용한다. 모든 연결은 SQLite와 CSV에서도 조회할 수 있다. 원본과 기존 앱 카탈로그는 수정하지 않는다.

## 상태 해석

- `supported`: 현재는 **주소와 이름이 모두 일치하고 해당 주소의 KB 후보가 하나인 출처 연결**만 해당한다. 세대별 도면 대응이나 자료 완비 판정이 아니다.
- `candidate`: 주소만 일치하거나 제목/본문에서 이름·주소가 발견된 경우. 단계·단지·표의 행 대응 확인 전에는 자동 병합하지 않는다.
- `weak`: 이름만 일치하면서 여러 주소에서 쓰이는 이름이거나 공고 지역과 대상 지역이 다른 경우. 일반 연결 후보 수에서 제외하고 근거는 보존한다.
- SH 타입 이미지 중 자료명이 실내 사진을 가리키는 경우 `photo-label-conflict`로 분리한다. 서버의 분류만으로 평면도를 확보했다고 보지 않는다.
- `document-text-candidate`: 해당 페이지/섹션에 관련 키워드가 존재한다. 실제 도면·표의 판독이 필요하다.
- 이미지 원본은 크기·헤더를 검사하되 OCR·도면 해석은 하지 않았다. 스캔 PDF, 구형 XLS/DOC/PPT, CAD의 내부 구조는 별도 검토 대상이다.
- 대용량 문서와 압축 계층/용량 한도에 걸린 항목은 생략 여부를 파일 상세에 기록한다. 오류 문서도 파일 목록에서 빠지지 않는다. 헤더 검사는 파일 전체 무결성 검사와 다르다.
- 수치지도는 레이어 경계상자 중첩, 영상은 반경 400m 카탈로그 범위 검사다. 건물 높이 속성·유효화소·전 조망 범위·OSM 미등록 길의 완전성을 보장하지 않는다.

이 결과의 파일 수·연결 수·출처 기록 수를 '완비 단지 수'로 바꾸어 보고하지 않는다. 준비된 원본을 찾아 사용하는 연결 기반이며, 불확실한 자료를 확정 자료와 섞지 않는다.

## 검증

```powershell
.tools/aerial-python/Scripts/python.exe tests/test_material_connection.py
```

PDF 페이지 위치 보존, 텍스트 없는 PDF 식별, 압축 내부 경로 보존, HWPX 본문 탐색을 검사한다. 색인 완료 시 SQLite 무결성 검사를 수행한다.
