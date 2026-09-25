# 전국 환경 자료 수집 계획

## 고정 원칙 — 2026-09-18 사용자 지시

**수치지도는 무조건 1:1,000만 수집·사용한다.** 다른 축척으로 대체하지 않는다. 1:1,000이 제공되지 않는 지역은 미확보로 남긴다. 이전 1:5,000 기본 수집 계획은 폐기했다.

**현재 서울 위성 다운로드는 마저 진행한다. 이후 전국 수치지도·지리 데이터 수집과 검증이 먼저이며, 모든 추가 위성 영상 획득은 가장 마지막이다.** 도시별 지도 다음에 곧바로 해당 도시의 위성을 받지 않는다.

## 순서

1. 실행 중인 서울 위성 20장 다운로드와 검증 유지.
2. 전국 1:1,000 제공 목록 조회. 서울 기존 자료 재사용 → **경기도 전역(필수, 부산보다 우선)** → 부산 등 광역시 → 세종·나머지 도·제주로 확장. 경기도를 특정 단지나 일부 시군으로 한정하지 않는다. (2026-09-19 사용자 지시)
3. 제공되는 전국 1:1,000 ZIP/XML 수집·검증. 오류는 review, 미제공은 not-provided로 기록.
4. 전국 지도 단계가 끝난 뒤 위성 원격 목록 조회·미리보기·선정·다운로드. 기존 서울 영상 재사용.
5. 정합·유효 영역 검사 → 건물/도로/지형 추출 → 지형 보간 → 식생·물 분류 → 중복 제거 → 구역별 저장·3D 표시.

전국 OSM 원본·길 DB는 재사용한다. 건물 높이·수위·수심·그림자 아래 식생, 지도 레이어 부재와 독립 정합 정확도는 별도 검증 대상이다. 자료가 없으면 다른 축척이나 임의 지형으로 완료 처리하지 않는다.

## 코드에서 강제하는 조건

- `national-collection.mjs`: `scales: [1000]`과 활성 지도 작업의 축척을 검사한다. 모든 시군구 목록·지도 작업 준비 및 제공되는 지도 파일 검증이 끝나기 전 위성 inventory/download를 차단한다. 로컬 타깃 준비와 기존 파일 검증은 가능하다.
- `collect-ngii.mjs`와 `ngii-files.mjs`: 직접 실행해도 다른 축척의 신청·정규화·메타데이터 검증을 거부한다.
- `national-inventory.mjs`: 서버 건수 비교, 포화된 목록의 공간 4분할·캐시·도엽 중복 제거. 시군구당 신규 공간 조회 최대 64회. 실패는 재시도 대상으로 남긴다.
- `national-grid.py`: 행정 폴리곤과 교차하는 500m 격자를 생성하고 중심 ±400m로 영상 대상 선정, 64개 격자씩 작업 분할. 격자 크기는 지도 축척과 별개다. 공급자 경계에 포함된 해역·섬도 대상이 될 수 있다.
- `AGENTS.md`, `ENVIRONMENT-IMPLEMENTATION.md`에도 동일한 결정을 기록했다.

## 실행 (프로젝트 루트, PowerShell)

```powershell
# init은 이미 실행했으므로 반복하지 않는다.
node scripts/national-collection.mjs inventory --region gyeonggi --limit 100
node scripts/national-collection.mjs prepare --region gyeonggi
node scripts/national-collection.mjs run --region gyeonggi --dataset maps --phase download --limit 2
# 경기도 후 부산 등 다음 지역
node scripts/national-collection.mjs inventory --region busan --limit 20
node scripts/national-collection.mjs prepare --region busan
node scripts/national-collection.mjs run --region busan --dataset maps --phase download --limit 2
node scripts/national-collection.mjs run --region busan --dataset maps --phase verify --limit 2
node scripts/national-collection.mjs status

# 나머지 전국 지도 작업까지 완료한 뒤에만 실행한다.
node scripts/national-collection.mjs run --region busan --dataset satellite --phase inventory --limit 1
node scripts/national-collection.mjs run --region busan --dataset satellite --phase download --limit 1
```

`node`가 PATH에 없으면 `& 'C:/Program Files/nodejs/node.exe'` 사용. Python은 `.tools/aerial-python/Scripts/python.exe`이며 pyproj/shapely가 필요하다. `--region` 생략 시 설정 순서대로 실행한다. `--limit`은 실행당 구역/작업 수(1~100), 반복 실행으로 진행하며 상주 자동 전환 서비스는 아니다. 사이트 간편인증·최초 동의는 사용자 조작이 필요할 수 있다.

## 상태와 재개

- `.tools/national/config.json`: `scales: [1000]`, 지도 우선 순서, 경로·예산.
- `districts.json`: 공급자 행정구역 목록과 조회 오류. 코드 변경은 사이트 목록으로 확인한다.
- `jobs.json`: 활성 작업. 기존 다른 축척의 작업은 취소 기록으로 분리하고 대기열에서 제거한다.
- `status.json`: 지도·영상 진행과 기존 서울·OSM 상태.
- 원본은 `mapinfo`, `C:/Users/User/Downloads/satellite_01`에서 공유·검증 후 재사용한다. 새 환경에서는 설정 경로를 수정한다.
- 2026-09-19 실제 수치지도 전송 폴더는 `C:/Users/User/Downloads/map_all_01`로 확인했다. `mapInbox`도 이 경로로 설정했다. 가져오기 코드는 직접 지정한 폴더와 `down_*`, `map_all_*` 하위 폴더를 지원하며, 원본을 보존하고 검증된 ZIP/XML 쌍만 `mapinfo`로 복사한다. 폴더명 차이로 첫 21개 완료를 감지하지 못한 문제를 수정했다.
- 전송 창의 `nlippd.ngii.go.kr/nlippd/pd/innorix/innorixdownLoad.do` 주소도 지원한다. 전체 다운로드 이후 별도 전송시작 버튼은 설정 경로 및 1:1,000 도엽 파일명이 확인될 때 한 번만 누른다. 로그인·신청서 입력을 다시 요청하지 않고 기존 메모리 입력을 이어 사용한다.
- `--retry`: 오류 재시도, review 재신청, 위성 계획 재계산. 영상 품질 기준을 통과하지 못하면 미확보 영역으로 유지한다.
- 위성 예산 1,000GB, 작업당 60GB/10장, 디스크 여유 50GB는 사전 예상 기준이다. 전국에 충분하다는 뜻이나 전송 프로그램 내부 바이트 강제 제한이 아니다.
- 실행 잠금으로 중복 작업을 막는다. 강제 종료 후에는 해당 PID 종료를 확인하고 정확한 run.lock만 제거한다. 기존 서울 실행 상태는 수정하지 않는다.
- `files-verified`는 계획 파일 검증 성공, `coverage-gap`은 영상 미확보 격자/미완료 목록, `not-provided`는 해당 1:1,000 목록 미제공이다. 미제공을 지도 확보 완료로 해석하지 않는다. 전국 품질 감사 전 `nationalComplete`는 false다.

## 2026-09-19 다운로드 대기 오류 수정

- 후속 보정으로 다운로드 후 검토 대상 75개를 모두 재검증했다. PRJ 누락 41개와 부분 레이어 누락 2개는 원본을 보존한 작업용 ZIP으로 보완했고, 메타데이터 제목의 괄호 앞 공백 요구를 수정했다. 경기도 수집 목록 5,548개는 모두 verified이며, 별도 NGI/source-review 제외 항목은 여전히 미완료다. 상세 근거: `verification/ngii-review-repair/README.md`, `repair-report.json`.

- 전송 시작 기록은 묶음별로 초기화하지 않고 브라우저 세션 전체에서 유지한다. 완료된 이전 전송 창을 새 묶음에서 다시 누르지 않으며, 같은 창에 새 문서가 로드될 때만 시작 기록을 초기화한다. 사용자가 시작한 전송 창도 처리한 것으로 기록한다. 덮어쓰기 안내를 자동 승인하지 않는다.

- 신청 후 전송 창이 열리지 않는 경우, 60초 간격으로 기존 신청 내역에서 현재 `requested` 도엽을 찾는다. 최신 5페이지(페이지당 100건) 범위에서 준비 완료·무료·수치지도 V2·1:1,000인 행만 선택하고 중복 도엽은 제외한다. 새 신청을 반복하지 않으며, 파일/메타데이터 검증 전에는 완료 처리하지 않는다. 이 범위를 벗어나거나 준비 중인 항목은 미완료로 남는다. 복구 선택 내역은 `map-session.json`의 `historyRecovery`에 기록한다.

- 고양 도엽 376080406, 376080407, 376080416은 압축이 정상이어도 PRJ 좌표계 파일이 없어 검증 실패했다. 완료로 세지 않고 원본 위치와 `incomplete-layers` 사유를 manifest의 `review`에 보존한다. 다음 묶음은 계속 처리한다.
- 파일 변경 후 10초 이내에는 전송 중일 수 있으므로 보류한다. 미완성 ZIP/CRC 오류를 위 형식 검토와 혼동하지 않는다.
- INNORIX 전송 창이 열려 있으면 뒤쪽 전체 다운로드를 재클릭하지 않는다. 클릭 직전 창이 생기는 경쟁 상태는 재확인한다. 전송 시작 클릭 시 해당 창을 앞으로 가져와 배경 창의 클릭 대기를 줄인다.
- 재개 시 기존 지도 탭을 재사용할 수 있으며, 로그인 후 스크립트 준비 확인은 화면 애니메이션 대신 시간 간격으로 검사한다.

## 확인한 범위

`prepare`는 기본적으로 지도 작업만 만든다. 영상 격자 준비는 `prepare --dataset satellite`로 별도 실행한다. 영상용 행정경계가 유효하지 않아도 지도 다운로드 준비가 중단되지 않도록 분리했다. NGI 등 현재 ZIP/SHP 검증기가 처리하지 못하는 원본은 source-review.json에 기록하며 완료로 세지 않는다.

사이트 행정구역 254개 조회, 부산 중구 1:1,000 도엽 20개와 영상 타깃 격자 22개 준비. 공간 검색과 서버 집계 일치도 확인했다. 다른 축척 항목은 공급자 원본 응답 기록에만 남으며 수집 대상이 아니다. 광역시 대량 다운로드는 시작하지 않았다.
