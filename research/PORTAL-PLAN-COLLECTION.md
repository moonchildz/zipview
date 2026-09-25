# 평면도 원본 수집 — 2026-09-20

## 공개 원본 우선 원칙

### LH 전송 개선 (2026-09-20)

`scripts/lh-stream-download.mjs`를 적용했다. 첨부는 메모리에 전부 모으지 않고 `.part` 파일로 스트리밍 저장하며, 전체 파일 SHA-256도 스트림으로 계산한다. 기존 첨부의 150MB 제한을 제거했다(HTML 목록 요청 제한은 별개). 파일 내용 검사는 앞부분만 수행하므로 완전한 문서/이미지 파싱 검증을 의미하지 않는다.

공고별 첨부 동시 전송은 최대 3개, 전체 요청 시작 간격은 최소 1초다. 45초 무응답 시 전송을 종료하고 최대 3회 시도한다. HTTP 401/403/429에는 수집을 멈춘다. 강한 ETag와 정확한 Content-Range가 일치하는 서버 응답에서만 이어받으며, Range를 무시한 200 응답은 기존 부분 파일을 비우고 다시 받는다. 서버의 LH 실제 이어받기 지원은 모든 파일에서 확인된 것이 아니다.

기존 실패 공고는 새 공고 뒤에서 처리하여 반복 실패가 신규 수집을 막지 않게 했다. 임시 파일과 URL/검증자 기록은 중단 후 보존한다. 상태 파일 교체 시 Windows의 일시적 잠금도 재시도한다.

검증: `node --test tests/lh-stream-download.test.mjs` 3개 통과. 연결 중단 후 정확한 이어받기, Range 무시 시 안전한 재다운로드, 151MB 전송을 로컬 HTTP 서버로 확인했다. 운영 실행 로그는 `verification/portal-collection/lh-stream-run1.log/.err`. 실제 속도 향상 배율은 아직 측정하지 않았다.

### 전국 LH 및 건설사 수집 실행 보강 (2026-09-20 후속)

- 재개 보강: LH 충남 2020년 임대 목록은 마지막 5페이지도 50건이라, 6페이지 요청에 서버가 5페이지를 반환했다. 명시적 끝 페이지 버튼, 반환 페이지 번호, 기존 저장 목록 fingerprint가 모두 일치할 때만 정상 종료로 인정하도록 수정했다. 실제 캐시 응답으로 검사했고, 재개 후 충남 2017년까지 진행하며 발견 공고 13,999건을 확인했다. 로그: `lh-national-resume.log/.err`. 이후 전체 목록 탐색 완료 시 첨부 수집을 자동 실행한다.
- 건설사 2곳은 첫 수집을 마쳤으며 라체르보 174개, 송내 98개 첨부 연결을 저장했다. 오류 첨부 7개를 `builders-run3.log/.err` 실행으로 재시도했으나 HTML 오류 응답이 지속되어 실패 기록을 유지한다. 건설사 전체 목록 수집 완료를 의미하지 않는다.

- LH 반복 페이지 원인 확인: `srchY=Y`는 검색을 초기화하여 페이지 번호를 되돌린다. `srchY=N`, `prevListCo=50`으로 공식 페이지 이동 조건을 반영했다. 서울 2024년 임대 목록에서 1페이지 50건과 2페이지 11건의 서로 다른 ID를 실제 응답으로 확인했다. 확인 원본은 `verification/portal-collection/lh-probe-1.html`, `lh-probe-2.html`이다.
- 현재 페이지 번호와 반복 목록을 모두 검사한다. 종전 목록 캐시는 완료 근거로 사용하지 않고 paginationVersion 2로 재탐색한다. 이미 확보한 공고·파일은 보존한다.
- 지역은 사이트의 공개 지역 선택 목록에서 읽고 서울→경기→나머지 순으로 2000년 이후 임대·분양 공고를 탐색한다. 공개 검색에서 조회되지 않는 과거 자료까지 확보했다는 뜻은 아니다.
- `node scripts/run-lh-national-library.mjs` 실행 중: 먼저 전국 공고 목록을 저장하고 성공적으로 끝나면 모든 첨부 수집을 자동 실행한다. 발견 수는 132건에서 1,480건 이상으로 늘었다(중간 확인값). 공고 수와 단지 수는 구분한다. 로그: `verification/portal-collection/lh-national.log`, `.err`.
- `scripts/collect-official-builder-library.mjs`와 `research/linkage/official-builder-sources.json`을 추가했다. 공식 라체르보 푸르지오 써밋(서울), 송내역 푸르지오 센트비엔(경기) 사이트를 시작점으로 등록하고 실행했다. 페이지 원본·첨부·이미지를 출처/해시와 함께 저장한다. 외부 링크는 발견 목록에만 남기고 자동으로 범위를 확대하지 않는다. 폼은 제출하지 않는다.
- 건설사 저장 위치: `research/linkage/downloads/official-builders/<source-id>/state.json`. 이 시작점 2곳은 전체 건설사/전체 단지 목록이 아니다. 동적 화면·외부 파일 호스트·JS/CSS 내부 자산은 별도 어댑터가 필요할 수 있다. 로그: `verification/portal-collection/builders-run1.log`, `.err`.
- 남은 작업: 건설사 공식 단지 목록에서 시작점 확대, LH 개별 전송 실패 재검증, 마이홈/LH 단지정보의 추가 경로 구축, ZIP 내부 파일 목록 및 전국 단지 대조. 현재 실행은 이 전체 작업의 완료를 의미하지 않는다.

사용자 지시: KOVI·아키스케치는 확보 경로에서 제외한다. SH·LH·건설사·시행사·공공기관이 직접 공개한 자료를 최대한 보존한 다음 활용성을 판정한다. CAD가 아닌 PDF·이미지·압축파일도 수집하며, 파일 수를 CAD 도면 확보량으로 표현하지 않는다.

LH는 기존 공고 132건에서 파일명 필터로 빠졌던 첨부까지 확보하기 위해 `node scripts/collect-lh-plan-library.mjs --queued-only --all-attachments`로 재개했다. 이미 받은 파일은 해시 검증 후 재사용한다. 이 실행은 기존 공고 큐만 처리하며, 반복 페이지 오류를 고쳤거나 전국 공고 탐색을 완료했다는 뜻은 아니다. 로그는 `verification/portal-collection/lh-all-attachments.log` 및 `.err`다. 목록 페이지 반복 문제 해결과 서울·경기 이후 전국 목록 확장은 남은 작업이다.

건설사 전용 전체 수집기는 아직 없다. 기존 `collect-hanshin-sources.mjs`는 특정 한진아파트의 건축물대장·OSM 자료용이고, 건설사 도면 수집기가 아니다. 다음 작업은 건설사별 공식 분양·지난 분양 사이트에서 공개 단지 목록과 평면도·카탈로그·첨부 링크를 발견하는 수집기를 구축하는 것이다.

## SH 전체 공개 첨부 수집 보강 (2026-09-20)

사용자 요청에 따라 SH 주택정보 공개 검색·공고에서 발견한 전체 4,248개 대상의 첨부를 계속 수집한다. SH 회사 홈페이지의 모든 게시판을 전수 수집한다는 뜻은 아니다. 기존 성공 건과 파일 해시는 재사용하고, 실패 건을 먼저 재시도한다.

- 기존 수집기가 DWG를 이미지 디코더로 처리하여 누락한 문제를 수정했다. `scripts/sh-asset-format.mjs`에서 DWG·DXF·PDF·ZIP/Office ZIP·OLE 문서·7z·RAR 서명을 인식한다.
- 이미지 디코딩 실패 또는 미지원 형식도 원본을 보존하고 `verification: unverified-original`, `validationError`를 기록한다. 저장 성공과 도면 활용 가능 여부는 다르다.
- 빈 응답과 HTML 오류 페이지는 첨부로 저장하지 않는다. 서버 404는 실패 내역에 남긴다. HTTP 401/403/429 중단 정책과 요청 간격은 유지한다.
- 이미지 이외 형식도 원본 URL·파일명·SHA-256·크기를 기록한다. CAD·압축파일의 내부 내용 검증은 별도 단계다.
- 보강 후 실행 로그: `verification/portal-collection/sh-run4.log`, `sh-run4.err`.

사용자 요청에 따라 완성률 집계보다 서울·경기도의 산재한 원본 확보를 우선한다. 평면도, 타입 이미지, 배치도, 팸플릿, 공급주택 목록을 출처별로 보관한다. 다른 타입이나 동호수에 임의로 매칭하지 않는다.

## 실행 중인 수집

- **SH**: 공개 홈페이지 공고 링크와 25개 서울 자치구·주요 단지명 검색 결과에서 발견한 ID 4,248개를 대기열에 저장했다. 아파트 외 임대주택도 포함하며, 4,248개 모두에 도면이 있다는 뜻은 아니다. 단지 개요·타입·이미지 분류를 읽고 JPEG/PNG/TIFF/BMP 및 PDF 원본을 저장한다. BMP 검증에는 기존 `.tools/aerial-python`의 Pillow를 사용한다.
- **LH**: 공개 공고 목록의 서울(11), 경기(41) 지역 필터를 이용한다. 2026년부터 2000년까지 연도별로 임대/분양 목록을 순회하며 게시된 공고 ID만 따른다. 첨부 이름에 평면·팸플릿·배치·동호·공급주택 등이 있는 파일을 저장한다. ZIP, PDF, HWP/HWPX, XLS/XLSX 및 래스터 이미지 원본을 보존한다. 기간 범위 밖 자료나 사이트에서 내려간 공고까지 확보했다는 뜻은 아니다.
- **KB**: 기존 서울 수집기를 `--retry-incomplete --no-build`로 재개했다. 기존 캐시를 재사용하고 미완료 대상을 다시 확인한다. 앱 카탈로그 빌드는 수집 단계에서 실행하지 않는다.
- **네이버**: 단지 페이지 접근과 KB 시작을 묶은 명령이 자동 승인 검토에서 거절됐다. 제공된 사유는 `blocked by policy`뿐이다. 해당 네이버 접근은 실행하지 않았고, KB의 별도 시작 명령은 승인되어 실행됐다. 네이버 수집 성공으로 집계하지 않는다.

## 파일과 상태

- `research/linkage/downloads/portal-library/sh/`: 단지별 JSON, 요청 원본, 해시 이름의 자산.
- `research/linkage/downloads/portal-library/lh/`: 공고별 JSON, 목록/공고 HTML, 해시 이름의 자산.
- 각 폴더의 `state.json`, `summary.json`: 진행 상태·대기열·오류·마지막 갱신 시각.
- `research/linkage/downloads/portal-library/review.html`: 원본을 검색하고 열 수 있는 검토 화면. 생성 시점의 스냅샷이며 실시간 집계가 아니다.
- `verification/portal-collection/*-run*.log`, `*.err`: 실행 로그.

새 자산에는 원본 URL, 수집 시각, SHA-256, 바이트 크기와 가능한 경우 이미지 규격을 기록한다. 파일 해시가 같으면 저장 파일을 공유하지만 타입/출처 연결은 각각 유지한다. 따라서 `assetLinks`와 `uniqueFiles`는 다르다. 이미지와 배치도·외관 사진·공급목록을 모두 평면 타입 수로 합산하면 안 된다.

평면 이미지가 아닌 분류에 도면이 들어 있을 수 있어 SH 사진 분류도 수집한다. 한 파일이 잘못돼도 같은 단지의 나머지 자산을 계속 처리한다. LH 파일에는 형식 시그니처 검사와 해시를 적용하며 PDF 전체 구조 검증·도면 페이지 추출은 별도 작업이다. 대용량 첨부의 전송 종료 오류는 공고별로 남긴다.

## 실행·재개·중지

```powershell
node scripts/collect-sh-plan-library.mjs --status
node scripts/collect-lh-plan-library.mjs --status
node scripts/collect-seoul-apartments.mjs --status

node scripts/collect-sh-plan-library.mjs
node scripts/collect-lh-plan-library.mjs
node scripts/collect-seoul-apartments.mjs --retry-incomplete --no-build

node scripts/review-portal-plan-library.mjs
```

SH/LH는 각각 해당 폴더에 `STOP`이라는 빈 파일을 만들면 요청 사이에 중지한다. 진행 중인 요청은 완료 또는 시간초과 후 중지한다. 다시 시작하려면 해당 STOP 파일만 지우고 같은 명령을 실행한다. 살아 있는 PID 잠금이 있으면 중복 실행을 거절한다. KB 중지는 기존 `research/linkage/generated/seoul-apartment-collection.json.stop` 파일을 사용한다.

출처별 요청 시작 간격은 최소 1초이며, SH/LH는 HTTP 401/403/429가 발생하면 해당 실행을 멈춘다. 다른 계정·주소로 차단을 우회하지 않는다. 새 원본 확보와 앱의 최종 동호수 연결은 별도 단계다.
