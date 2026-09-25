# SegFormer 위성 영상 식생 시험

## 입력

`C:\Users\User\Downloads\satellite_01`의 2021년/2024년 위성 영상 4세트에서 추출한 기존 4096×4096 RGB 구역 12개를 사용한다. 원본 전체 장면을 처리한 결과가 아니다. 입력 밴드 경로와 구역 위치, 이미지 SHA-256은 `verification/satellite-facilities/manifest.json`에 기록되어 있다. TIFF에 좌표계/지리변환이 없어 출력은 이미지 픽셀 좌표를 사용한다.

## 분류

| 표시 | 모델 | 의미 |
|---|---|---|
| 초록, 마스크 1 | [restor/tcd-segformer-mit-b3](https://huggingface.co/restor/tcd-segformer-mit-b3) | tree: 나무·숲의 수관. 둘을 별개 클래스로 분류하지 않음 |
| 노랑, 마스크 2 | [nave1616/SegFormer-landcover-FT](https://huggingface.co/nave1616/SegFormer-landcover-FT) | rangeland: 풀·낮은 식생 후보. 잔디만을 뜻하지 않음 |

YOLO는 사용하지 않는다. 두 모델 모두 SegFormer이며 버전 커밋, 라이브러리 버전, 전처리 설정, 타일 수, 실행 시간, 입력 해시는 구역별 JSON에 보존한다. 풀 모델은 전처리 파일이 공개되지 않아 기반 모델의 ImageNet 정규화(mean 0.485/0.456/0.406, std 0.229/0.224/0.225)를 가정했다.

512픽셀 타일을 128픽셀 겹치고 양의 삼각 가중치로 확률을 평균한다. 수관 확률 0.5 이상을 초록으로 표시한다. 풀은 전체 9개 클래스 중 rangeland가 최댓값이며 확률이 0.5 이상일 때 표시한다. 두 모델이 겹치면 수관을 우선한다. 원본 RGB 밴드 중 하나라도 0 이하인 픽셀은 제외한다. 지도상의 면적이나 개별 나무 수를 추정하지 않는다.

## 실행 및 출력

```powershell
.tools/aerial-python/Scripts/python.exe scripts/segment-satellite-vegetation.py --resume
.tools/aerial-python/Scripts/python.exe -m unittest discover -s tests -p test_satellite_vegetation.py
```

`verification/satellite-vegetation/review.html`에서 구역, 수관/풀 표시, 투명도, 원본, 배율을 선택할 수 있다. 구역별 `overlay.jpg`, `mask.png`, 투명 레이어 PNG, 확률 NPZ와 실행 JSON을 저장한다. `summary.json`은 유효 픽셀 중 예측된 각 분류 비율을 포함한다. 비율은 검증 정확도나 실측 면적이 아니다.

첫 west-sports-2024 구역에서는 단지 사이 수목과 하천변 식생을 확인했다. 운동장 일부도 풀 후보로 분류되므로 천연잔디/인조잔디 구별이나 시설 판정에 사용하면 안 된다. 그림자, 지붕, 관목 등에 오분류 또는 누락이 있을 수 있다. 정답 마스크와 비교한 정량 정확도 검증은 수행하지 않았다.

## 완료 및 검증

### 풀 후보 기준 0.35 비교

사용자 요청에 따라 풀 후보 기준만 0.5에서 0.35로 낮춘 결과를 `verification/satellite-vegetation-grass035`에 별도로 저장한다. 나무·숲 기준은 0.5, 풀의 9개 클래스 최댓값 조건과 수관 우선순위는 유지한다. 기존 확률 파일을 재사용한다.

```powershell
.tools/aerial-python/Scripts/python.exe scripts/segment-satellite-vegetation.py --render-only --cache-dir verification/satellite-vegetation --output verification/satellite-vegetation-grass035 --grass-threshold 0.35
```

`comparison.jpg`는 west-sports-2024 단지 부분의 0.5/0.35 표시 비교다. 임계값을 낮추면 후보 영역이 늘어나며, 클래스 수만으로 적절한 임계값이 결정되지는 않는다.

12개 구역 모두 두 모델 추론과 결과 저장을 완료했다. `overview.jpg`는 12개 결과 모음이고, `west-sports-2024/comparison.jpg`는 단지 부분의 원본/결과 확대 비교다. 산림 수관도 표시되지만 어두운 부분에는 누락이 보인다.

마스크 겹침 우선순위/NoData 및 타일 경계 테스트 2개 통과. 전체 12개 출력의 크기, 클래스 ID, 픽셀 집계 일치를 확인했다. `tests/vegetation-browser.mjs`로 12개 구역 목록, 원본/레이어 전환, 배율, 구역 변경과 데스크톱/모바일 화면을 확인했고 페이지 오류는 없었다.
