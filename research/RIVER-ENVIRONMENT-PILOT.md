# 양재천·한강 환경 결합 시험

2026-09-17. 기존에 내려받은 영상으로 두 구역의 지형·수목·낮은 식생·도로 제외·물 후보를 결합했다.

## 구역과 영상

공통 영상은 `C1_20240611014916_17892_00718251`, 촬영일 2024-06-11이다. 원본 위치는 `C:/Users/User/Downloads/satellite_01`. 각 구역은 2048×2048 픽셀, 약 1024×1024m이며 유효 RGB 비율은 100%다.

| 구역 | 요청 중심 경도·위도 | 물 후보 비율 | 건물 외곽 수 | 표시용 수목 수 | 낮은 식생 덩어리 수(0.35) |
| --- | --- | --- | --- | --- | --- |
| 양재천·도곡 | 127.051, 37.481 | 1.28% | 1682 | 1515 | 2869 |
| 한강·반포 | 127.003, 37.516 | 50.23% | 205 | 1144 | 7504 |

비율은 영상 전체에 대한 예측 픽셀 비율이며 정확도나 실측 면적이 아니다. 수목과 식생 덩어리 수 역시 실제 개체 수가 아니다.

## 처리

- 수관: `restor/tcd-segformer-mit-b3`, 확률 0.5 이상.
- 낮은 식생: `nave1616/SegFormer-landcover-FT`의 rangeland 클래스, 최댓값 조건과 확률 0.35/0.5 비교.
- 물: 같은 토지피복 모델의 클래스 6 water, 최댓값 조건과 확률 0.5 이상.
- 모델 가중치는 로컬 캐시를 사용했다. 토지피복 모델 전처리는 배포 processor 부재로 기본 ImageNet 정규화를 사용하며 해당 가정은 유지한다.
- 수치지도 도로 면과 물 후보를 수관·낮은 식생에서 제외한 후 기존 절차적 3D 모델을 생성했다.
- 수치지도 등고선·표고점을 보간한 지형 위에 영상·외곽선·식생·물 후보를 배치했다. 카탈로그 경계 기반 잠정 정합이며 독립 기준점 정확도 검증은 하지 않았다.
- 건물은 외곽선만 표시한다. 나무 높이 8m, 낮은 식생 높이 0.4m는 표시용 가정이다.

## 확인된 한계

- 양재천은 좁은 물길이 검출되지만 일부 건물 그림자도 물로 오인한다.
- 한강은 넓은 수면이 검출되지만 수면 내부에 누락이 남는다. 임의로 메우지 않았다.
- 물 표시는 지형에 얹은 후보 레이어다. 평탄한 실제 수위, 수심, 교량 상하 관계를 복원한 결과가 아니다.
- OSM 추가 내부 길·산책로 수집은 서버 HTTP 406/429로 실패했다. 이번 두 구역의 길 제외는 수치지도 도로 면만 반영했다. 기존 경희궁자이의 OSM 처리 결과는 유지했다.

## 결과와 검증

- 화면: `/northwest-grove.html?site=yangjae`, `/northwest-grove.html?site=han`
- 결과 폴더: `verification/yangjae-grove`, `verification/han-grove`
- 원본·물 비교: 각 폴더의 `source.jpg`, `water-review.jpg`, `water.json`
- 화면 검증: `node tests/northwest-grove-browser.mjs yangjae`, `node tests/northwest-grove-browser.mjs han` 통과. 물/식생/지형 전환, 데스크톱·모바일 렌더링과 페이지 오류를 확인했다.
- 마스크 검증: `tests/check_road_filtered_artifacts.py` 네 구역 통과. 도로·물과 식생 마스크의 비중첩 및 낮은 식생 덩어리의 경계를 확인했다.

구역 준비와 추론은 `prepare-xi-satellite.py --site`, `segment-satellite-vegetation.py`를 사용한다. 이어 `prepare-northwest-grove.py`, `add-grove-terrain.py`, `prepare-low-vegetation.py`, `prepare-river-water.py`, `prepare-road-filtered-vegetation.py` 순으로 결합한다. 각 스크립트의 CLI 인자는 `--help`로 확인한다.
