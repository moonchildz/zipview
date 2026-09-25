# 수치지도 지형과 수목 결합

## 경희궁자이 OSM 내부 길 보완

`scripts/osm-path-mask.py`는 기존 `research/gyeonghuigung-xi/scene.json`의 로컬 좌표를 원래 변환(111195m/위도도, 경도 cos 보정)으로 경위도에 되돌린 뒤 EPSG:5179로 옮긴다. footway/path/pedestrian/steps/service/living_street의 지상 구간만 사용하며 교량/터널/비지상 layer는 제외한다. 실제 숫자 width 태그를 우선하고 없으면 기존 profile 폭을 쓴다. 폭을 알 수 없는 구간은 건너뛴다.

현 시험 구역의 후보 289개는 모두 class-assumption 폭이다. 중심선을 폭/2만큼 확장한 면을 수치지도 도로 면과 합쳐 차감했다. 도로 외 추가 제외는 수관 2,089픽셀, 낮은 식생(0.35) 31,061픽셀이다. 이 수치는 지리 정확도나 측량 면적이 아니다. 각 OSM way ID, 폭/근거, 원본 파일 해시는 산출 JSON의 osm 항목에 남는다. 자료 출처는 OpenStreetMap contributors이며 기존 저장본을 사용했다.

`verification/xi-grove/osm-path-comparison.jpg`: 왼쪽 원본, 오른쪽 파랑=수치지도 도로, 분홍=추가 OSM 길. 길 위치/폭은 잠정 정합과 추정 폭 영향을 받는다. 작은 보행로가 실제보다 넓게 잘리지 않는지 비교가 필요하다. 모델 재생성 후 경희궁자이 브라우저 검사와 양쪽 구역의 도로 비중첩/낮은 식생 패치 경계 검사가 통과했다.

## 도로 제외 및 낮은 식생 3D

`scripts/prepare-road-filtered-vegetation.py`는 실제 다운로드 ZIP의 도로경계 면 `N1A_A0010000`을 EPSG:5179로 변환한 뒤 영상 격자에 래스터화한다. 폴리곤 구멍을 보존하고 임의 도로 폭이나 추가 완충 폭을 적용하지 않는다. 도로 마스크를 수관과 낮은 식생 양쪽에서 차감한다. 도로 위로 뻗은 실제 수관도 제거되는 표시 규칙이며, 도로 판정 모델이 아니다. 도로경계 면의 의미는 [수치지도 2.0 도로 연구, 표 2-2](https://oak.chosun.ac.kr/bitstream/2020.oak/17164/2/%EC%88%98%EC%B9%98%EC%A7%80%EB%8F%84%202.0%20%EB%8D%B0%EC%9D%B4%ED%84%B0%20%EA%B8%B0%EB%B0%98%20%EB%8F%84%EB%A1%9C%20%EA%B3%A1%EC%84%A0%EC%9D%98%20%EC%8B%9C%EC%9E%91%EC%A0%90%20%EC%84%A0%EC%A0%95%20%EB%B0%A9%EB%B2%95.pdf)과 대조했다.

경희궁자이 0.35 기준 수관 3,736픽셀, 낮은 식생 75,825픽셀을 제외했다. 남은 낮은 식생 15.38%는 정확도/실측 면적이 아니다. 월드컵공원은 수관 106,130픽셀, 낮은 식생 12,551픽셀을 제외했다. 지도에 없는 내부 보행로, 시기 차이, 잠정 정합 오차는 남을 수 있다.

낮은 식생은 거리변환으로 경계/구멍/도로를 침범하지 않는 반경을 구해 높이 0.4m의 낮은 타원체로 표현한다. 실제 관목 개수/높이를 뜻하지 않는다. 지형의 중심점 표고에 배치하며 미세 경사 접촉까지 복원하지 않는다. 화면에서 3D/노란 후보 영역 및 0.35/0.5를 전환할 수 있다. 도로는 추가 지형 높이로 만들지 않는다.

재생성 순서: 기존 구역/지형 준비 → `prepare-low-vegetation.py` → `prepare-road-filtered-vegetation.py`. 기존 확률/원본 마스크는 보존한다. `road-filtered-review.jpg`는 파랑=도로, 초록=남은 수관, 노랑=남은 낮은 식생이다. 도로 원본 ZIP 해시와 차감 수량은 `road-filtered-vegetation.json`에 기록한다. 양쪽 구역 브라우저 검증에서 3D/마스크 전환, 기준 변경 및 지형 전환이 통과했다.

## 낮은 식생 후보 표시 추가

`scripts/prepare-low-vegetation.py`로 저장된 SegFormer rangeland 확률/최댓값 클래스를 재사용해 0.35 및 0.5 마스크를 생성했다. 수관(0.5 이상)은 제외한다. 추가 모델 추론이나 잔디/꽃/관목 세부 분류를 수행한 것은 아니다. 실제 식생 높이를 추정하지 않고 지형에 노란 후보 영역을 표시한다. 화면에 낮은 식생 토글과 기준 선택을 추가했다.

경희궁자이 1km 구역의 후보 픽셀 비율은 0.35에서 17.19%, 0.5에서 14.10%다. 중앙 단지 확대 비교에서 일부 조경과 함께 어두운 바닥/그림자까지 넓게 표시된다. 따라서 화단 경계나 조경 실측 면적으로 사용할 수준으로 검증되지 않았다. `verification/xi-grove/low-vegetation-comparison.jpg`는 원본/0.35/0.5 동일 위치 비교다. 두 구역의 브라우저 검증에 후보 토글 및 기준 선택을 추가했고 통과했다.

## 범위 및 화면

- 월드컵경기장·문화비축기지: `/northwest-grove.html?site=northwest`
- 경희궁자이: `/northwest-grove.html?site=xi`

각각 약 1,024×1,024m 시험 구역이다. 지형 높이 토글로 기존 평면과 비교한다. 나무 밑동과 건물 외곽은 같은 지표면을 따른다. 수직 배율은 1배이며 높이를 과장하지 않았다. 건물은 외곽선만 표시하고 고층 건물 모형이나 실제 세대 전망에는 아직 연결하지 않았다.

## 지형 근거

다운로드한 NGII 수치지도 ZIP의 `N1L_F0010000` 등고수치와 `N1P_F0020000` 표고 수치를 원본 PRJ에서 EPSG:5179로 변환했다. 구역 바깥 250m까지 자료를 확보하고 선분을 5m 이하 간격으로 표본화한 뒤, 선형 TIN 보간으로 257×257 격자(약 4m 간격)를 생성했다. 원본 표고는 유지하며 화면 좌표에서만 중앙값 표고를 뺀다. 이 격자 간격은 실제 측량 정확도가 아니다.

동일 좌표의 표고 충돌을 검사하고 1m 초과 시 중단한다. 두 구역 모두 충돌 0m였으며 보간 영역 밖을 임의 높이로 채우지 않았다. 전체 격자가 유한한 값인지 검사했다. 기록의 보간 잔차는 입력 자료에 대한 수치 검사이며 독립 정확도 검증이 아니다. 옹벽, 수직 단차, 교량, 건물 지붕은 이 지형만으로 복원되지 않는다.

| 구역 | 중복 제거 표본 | 격자 표고 범위 |
|---|---:|---:|
| 월드컵공원 | 26,603 | 2.36–93.57m |
| 경희궁자이 | 38,705 | 31.71–136.62m |

## 경희궁자이 영상 및 수목

기존 앱 `research/gyeonghuigung-xi/scene.json`의 중심 좌표를 사용했다. 서울 서북부 2024년 영상은 이 중심을 포함하지 않아, 이미 받은 `C1_20250406014951_22435_00552767`의 2048×2048 구역을 추출했다. RGB 유효 픽셀 100%, 원본 위치 (4610,23485). 카탈로그 경계/0.5m GSD에 따른 잠정 위치 정합이며 독립 기준점 잔차는 미측정이다.

SegFormer 수관 기준 0.5, 풀 후보 0.35로 추론했다. 수관 예측 1.41%, 풀 후보 17.19%. 4월 초 영상에서 수관 누락 및 풀 후보 오분류가 육안으로 보이므로 녹지 전체 면적이나 나무 수로 사용하지 않는다. 3D에는 수관만 사용한다. 64픽셀 미만 영역을 제외한 수관 77영역, 수치지도 건물 외곽 2,862개를 연결했다. 실제 수종·수고·나무 개수는 추정하지 않았다. 높은 지붕과 바닥 외곽의 어긋남이 보이므로 전체 영상을 지붕에 맞춰 이동시키지 않았다.

## 재생성

```powershell
# 월드컵공원: 준비 스크립트는 평면 정보를 생성하므로 지형 명령을 이어서 실행
.tools/aerial-python/Scripts/python.exe scripts/prepare-northwest-grove.py
.tools/aerial-python/Scripts/python.exe scripts/add-grove-terrain.py verification/northwest-grove
# 경희궁자이
.tools/aerial-python/Scripts/python.exe scripts/prepare-xi-satellite.py
.tools/aerial-python/Scripts/python.exe scripts/segment-satellite-vegetation.py --input verification/xi-satellite/manifest.json --output verification/xi-vegetation --grass-threshold 0.35 --resume --offline
.tools/aerial-python/Scripts/python.exe scripts/prepare-northwest-grove.py --site xi
.tools/aerial-python/Scripts/python.exe scripts/add-grove-terrain.py verification/xi-grove
```

추가 Python 패키지: scipy 1.18.1, pyproj 3.8.0, pyshp 3.1.6. `--offline`은 내려받은 모델 캐시의 main 커밋을 사용하며 실제 커밋은 결과 JSON에 기록한다. 지도 도엽 및 SHA-256, 격자 높이, 가정은 각 `verification/*-grove/scene.json`에 저장한다.

## 검증

`node --test tests/grove-terrain.test.mjs tests/aerial-grove.test.mjs`: 5개 통과. 격자 삼각형과 표고 보간 일치, 북쪽/텍스처 방향, 평면 전환, 수목의 높이 이동과 수평 배치 보존, 수관 구멍·경계 검사.

`node tests/northwest-grove-browser.mjs` 및 `node tests/northwest-grove-browser.mjs xi`: 두 구역에서 로딩, 지형/평면 전환, 나무/사진/외곽 표시와 높이 설정, 모바일 확인. 실제 지리 정확도와 현장 수목 검증을 대신하지 않는다.
