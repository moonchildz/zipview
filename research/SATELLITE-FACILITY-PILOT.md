# 위성 영상 시설물 전체 클래스 시험

## 범위와 재현 방법

2026-09-15, 다운로드된 CAS500-1 RGB PS 완전 세트 4개에서 4,096×4,096 픽셀 구역
12개를 골라 시험했다. 2021년 영상 2개 구역, 2024년 영상 10개 구역이다.
선정 영역은 `research/satellite-pilot-regions.json`에 원본 픽셀 좌표로 기록했다.
명칭은 개괄 영상에서 보이는 주변 용도를 설명하는 편의상 이름이며 공식 시설 식별자가 아니다.
전 장면을 전수 탐지하거나 실제 시설 개수를 조사한 결과가 아니다.

기존 `detect-aerial-yolo.py`는 `merge_vehicles()`에서 소형·대형 차량 이외의 클래스를
버렸다. 나무 영역은 별도 모델 결과를 재사용했다. 따라서 기존 화면의 클래스 제한과
YOLO 모델 자체의 지원 범위는 다르다.

- **기존 YOLO26m-OBB 체크포인트:** DOTAv1 15개 클래스. 모델을 실제 로드해 `model.names`로 확인했다.
- **DOTA 데이터셋:** v1.5는 16개, v2는 18개. 추가 항목은 컨테이너 크레인, 공항,
  헬리패드다. 데이터셋 클래스 수를 늘려 적는 것만으로 기존 체크포인트가 이를 인식하지는 않는다.
- **YOLOE-26m:** 사용자 지정 텍스트 클래스를 받는다. 이번에는 30개 항목을 지정했다.
  30은 이번 실험 목록의 크기이며 모델의 최대 클래스 수가 아니다. 지정 가능성과
  위성 영상에서의 검증된 탐지 성능은 구별해야 한다. 두 모델의 목록은 일부 중복된다.

근거: [Ultralytics DOTA 문서](https://docs.ultralytics.com/datasets/obb/dota-v2),
[YOLO OBB 문서](https://docs.ultralytics.com/tasks/obb/),
[YOLOE 문서](https://docs.ultralytics.com/models/yoloe/).

### 실행

Windows에서 Python 3.12 환경과 RTX 3080 GPU를 사용했다.
CUDA 12.6 PyTorch 환경을 먼저 설치하고 위성 실험 의존성을 설치한다.

```powershell
py -3.12 -m venv .tools/aerial-python
& .tools/aerial-python/Scripts/python.exe -m pip install torch==2.14.0 torchvision==0.29.0 --index-url https://download.pytorch.org/whl/cu126
& .tools/aerial-python/Scripts/python.exe -m pip install -r scripts/requirements-satellite.txt
& .tools/aerial-python/Scripts/python.exe scripts/prepare-satellite-pilot.py --inbox C:/Users/User/Downloads/satellite_01 --regions research/satellite-pilot-regions.json
& .tools/aerial-python/Scripts/python.exe scripts/detect-satellite-facilities.py --mode obb --resume
& .tools/aerial-python/Scripts/python.exe scripts/detect-satellite-facilities.py --mode open --resume
& .tools/aerial-python/Scripts/python.exe scripts/review-satellite-facilities.py
& .tools/aerial-python/Scripts/python.exe tests/test_satellite_facilities.py
```

YOLOE 첫 실행은 공식 CLIP 토크나이저와 `mobileclip2_b.ts`도 내려받는다.
이번 설치의 CLIP 커밋은 `a13192f8cb767260d7dfd98c843b0716593169e7`이다.
다운로드는 모델 파일을 받기 위한 것이며 위성 영상을 외부 추론 API로 보내지 않는다.

결과는 Git에서 제외되는 `verification/satellite-facilities/`에 있다.
`review.html`은 로컬 파일로 바로 열 수 있다. 모델·구역·클래스·최소 점수 선택,
차량 숨김, 원본 확대, 원본 장면의 픽셀 좌표 확인을 지원한다.
`classes/`에는 높은 점수 후보를 클래스마다 최대 6개, 구역마다 최대 2개 보여주는
확대 예시가 있다. 이는 무작위 표본이나 정확도 평가용 정답셋이 아니다.

### 처리 조건

- RGB PS 세 밴드의 헤더·파일 크기를 검사하고, 선택 구역은 실제 픽셀을 읽었다.
  전 파일 전체 픽셀 무결성을 검사한 것은 아니다.
- TIFF에는 읽을 수 있는 CRS와 지리 변환 정보가 없었다. XML의 촬영 코너 좌표를
  정사영상의 사각 경계로 간주하지 않았다. 탐지 결과는 원본 픽셀 좌표만 기록했다.
- 장면당 RGB 밴드의 유효 픽셀 표본에서 p2–p98 스트레치, 감마 1.2.
  합성 영상 SHA-256, XML SHA-256, 원본 밴드 경로·크기, 영역 좌표를 기록했다.
  영상 생성·초해상도 복원은 적용하지 않았다.
- 구역마다 1,024 / 2,048 / 4,096 픽셀 창, 25% 겹침으로 35회 추론.
  모델 입력은 1,024 픽셀. 작은 창은 원본 픽셀 크기를 보존하고 큰 창은 큰 시설의 문맥을 제공한다.
- 전체 420개 창/모델, 후보 저장 임계값 0.15. 0.25와 0.50의 집계도 제공한다.
- 회전 다각형 IoU 0.35로 같은 클래스의 겹치는 후보를 제거한다. OBB의 두 차량
  하위 클래스는 하나의 중복 제거 그룹으로 취급한다. 서로 다른 시설 클래스는 유지한다.
- 요약 집계는 같은 원본 장면의 겹치는 구역도 다시 중복 제거한다. 날짜·장면이
  다른 결과는 합치지 않는다. 한 시설의 전체/부분 상자와 유사 클래스 중복은 남을 수 있다.
- YOLOE는 이번 비교에서 박스를 사용한다. 건물 윤곽 분할·3D 복원·시설 높이 추정은 수행하지 않았다.

## 해석 시 주의할 점

점수는 정답률이 아니다. 미탐·오탐·부분 상자·클래스 간 혼동이 남는다.
0건인 클래스도 실제 시설이 없음을 뜻하지 않는다. 2021/2024년 촬영 영상에서
현재 시설의 존속 여부를 추론할 수 없다.

이번 높은 점수 예시의 육안 확인에서는 테니스장·축구장·교량·선박에 맞는 사례가
보였고, 농구장과 야구장도 실제 코트/내야 형태를 잡았다. 육상 트랙은 타원형의
다른 시설이 섞였으며, 저장탱크는 실제 원통형 탱크 외에 작은 옥상 설비와 그림자가
섞였다. 수영장은 녹색 지붕을 잘못 잡는 예시가 있었다. 회전교차로도 광장이나
조경을 잡았다. 비행기는 전시 항공기로 보이는 사례와 도로·옥상 구조물 오탐이 함께 있었다.
이것은 선택된 예시의 정성 관찰이며 클래스별 정밀도·재현율 측정이 아니다.

## 이번 실행의 클래스별 후보 수

같은 장면의 겹치는 구역을 중복 제거한 후보 집계다. 정답 개수나 시설 대장이 아니다.

### 항공영상 YOLO OBB

| 클래스 | 점수 ≥0.25 | 점수 ≥0.50 |
|---|---:|---:|
| plane | 13 | 5 |
| ship | 94 | 74 |
| storage tank | 28 | 11 |
| baseball diamond | 4 | 4 |
| tennis court | 93 | 69 |
| basketball court | 13 | 5 |
| ground track field | 44 | 31 |
| harbor | 6 | 2 |
| bridge | 40 | 30 |
| large vehicle | 8 | 0 |
| small vehicle | 3 | 0 |
| helicopter | 0 | 0 |
| roundabout | 1 | 0 |
| soccer ball field | 60 | 46 |
| swimming pool | 5 | 1 |

### YOLOE 텍스트 지정 30개 항목

| 클래스 | 점수 ≥0.25 | 점수 ≥0.50 |
|---|---:|---:|
| building | 7 | 1 |
| parking lot | 3 | 1 |
| playground | 0 | 0 |
| road | 0 | 0 |
| bridge | 2 | 1 |
| railway | 10 | 0 |
| train | 132 | 28 |
| bus | 477 | 89 |
| truck | 5 | 0 |
| car | 67 | 3 |
| storage tank | 0 | 0 |
| solar panel | 52 | 8 |
| greenhouse | 8 | 1 |
| swimming pool | 0 | 0 |
| tennis court | 0 | 0 |
| basketball court | 0 | 0 |
| soccer field | 0 | 0 |
| baseball field | 0 | 0 |
| running track | 0 | 0 |
| stadium | 108 | 36 |
| construction site | 65 | 11 |
| crane | 0 | 0 |
| shipping container | 2 | 0 |
| boat | 0 | 0 |
| pier | 0 | 0 |
| tree | 1 | 0 |
| fountain | 0 | 0 |
| helipad | 2 | 0 |
| roundabout | 4 | 1 |
| power transmission tower | 0 | 0 |

## YOLOE 추가 시험: 실용적인 시설 탐지 실패

건물·주차장·놀이터 탐지의 성공 결과로 사용할 수 없다. 확대 예시에서 아파트를 버스,
주거 구역을 경기장, 지붕을 태양광 패널로 분류했다. 건물 7건도 개별 건물의 올바른
탐지 7건을 뜻하지 않으며, 넓은 주거 블록을 감싼 상자가 포함된다.

일반 공식 버스 사진에서는 같은 30개 항목으로 버스를 정상적으로 탐지했다.
동일 위성 구역을 FP32로 재실행해도 경기장·태양광·버스 오탐이 남았다.
건물·나무·자동차·놀이터 4개 프롬프트로 줄인 재실행에서는 0.15 이상 후보가 없었다.
이는 한 구역 진단이며 모든 프롬프트/모델의 가능성을 부정하는 실험은 아니다.
진단 결과는 `verification/satellite-facilities/diagnostic.json`에 보관했다.

## 결론

이번 영상은 나무·차량 이외에도 운동시설·교량·선박 탐지의 타당한 예시를 제공했다.
기본 항공영상 모델의 15개 클래스를 모두 사용할 수 있다. 그러나 일반 텍스트 지정
모델에 시설 이름을 추가하는 것만으로 건물·놀이터 등의 탐지가 해결되지는 않았다.
다음 단계는 항공·위성영상용 건물 분할 모델과 놀이터 등 별도 학습이 필요한 항목을
구분하는 것이다. 이번 결과를 검증 없이 서비스의 실제 시설물이나 3D 구조물로 넣지 않았다.

## 실행 검증

- 두 모델 모두 12개 구역 × 35개 창 처리 결과와 원시 후보를 저장했다.
- `tests/test_satellite_facilities.py`: 클래스 보존, 차량 하위 클래스 중복 제거,
  잘못된 좌표 제거, 영상 가장자리 창 배치 4개 테스트 통과.
- `node tests/satellite-browser.mjs`: Chrome 데스크톱/모바일에서 로컬 HTML 로드,
  15/30개 클래스 표시, 점수 필터, 확대, 모델·구역 전환, 가로 넘침 검증 통과.
- 이는 코드·화면의 동작 검증이며 객체 인식 정확도 테스트가 아니다.
