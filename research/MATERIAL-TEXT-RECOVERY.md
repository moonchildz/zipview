# 다운로드 문서 추가 해석 (2026-09-23)

기존 연결 색인에서 읽지 못한 자료를 로컬 스크립트로 추가 처리한다. 원본 수정이나 모델 구현은 하지 않는다.

## 확인 결과

- 구형 XLS 38개 전부 추출 성공. 4,162개 시트 행을 `recovery.sqlite`에 보존했다.
- OCR 대상은 PDF 788개와 ZIP 53개, 총 841개 파일이다. 압축파일 내부 PDF도 순회한다. 직접 PDF의 페이지 수 합계는 8,215쪽이며, 압축 내부 쪽수는 별도다.
- 첫 스캔 PDF는 11쪽 OCR 성공. 평면도 등의 문서 종류 근거를 원본 페이지와 함께 기존 색인에 추가했다. 나머지는 숨겨진 단일 작업자로 처리 중이며 현재 값은 진행 JSON을 확인한다.
- 기존 parse-error 3개: PDF 확장자 안의 HTML 응답 1개, HWP 3.0 미지원 1개, OLE 구조 읽기 실패 1개. 이들은 복구 완료로 세지 않는다.

## 실행과 검증

```powershell
.tools/aerial-python/Scripts/python.exe scripts/recover-material-text.py
.tools/aerial-python/Scripts/python.exe -m unittest discover -s tests -p "test_material*.py"
.tools/aerial-python/Scripts/python.exe scripts/check-connected-materials.py
```

Windows에 설치된 한국어 Windows.Media.Ocr 엔진을 사용한다. 외부 AI 호출이나 파일 업로드는 없다. 페이지 렌더링 최대 변 2,400픽셀, OCR 프로세스 제한 90초, 작업자 1개다. ZIP 내부는 압축 해제 경로에 쓰지 않고 메모리에서 읽고, 중첩 깊이와 용량을 제한한다.

`research/linkage/generated/connected-materials/` 아래:

- `recovery-progress.json`: 실제 갱신 시각, PID, 파일 완료/오류, 현재 페이지. 갱신이 멈추면 프로세스를 확인해야 한다.
- `recovery.sqlite`: 원본 크기·mtime 기반 식별자와 페이지별 텍스트, 처리 기록. 중단 후 재시작하면 완료 페이지를 재사용한다.
- `recovery.stdout.log`, `recovery.stderr.log`: 숨겨진 작업자 로그.
- `recovery.lock`: 중복 실행 방지. 프로세스가 살아 있으면 지우지 않는다.

검토 화면: http://127.0.0.1:5182 (추가 처리 상태 30초 갱신).

OCR 근거는 `ocr-text-candidate`, XLS 근거는 `legacy-xls-text-candidate`로 저장한다. 이름만 일치한 연결은 항상 weak이며 주소가 있어도 candidate다. OCR 오인식, 다단지 문서, 실제 도면 수록 여부를 자동 확정하지 않는다. 따라서 처리 파일 수를 구현 가능 단지 수로 환산하지 않는다.

연결 근거와 파일 상태는 파일별로 커밋하므로 화면에 반영된다. summary 및 CSV 집계는 배치 종료 때 갱신되며 실행 중에는 진행 JSON이 최신이다. 기존 material-matrix.csv는 공간 연결 스크립트를 재실행해야 갱신된다. 전체 색인을 다시 만들 경우 작업을 겹쳐 실행하지 말고 완료 후 recovery를 다시 실행한다. 저장된 OCR 페이지는 재사용한다. CAD, 원본 이미지 전체, 구형 HWP 해석은 이 작업에 포함되지 않는다.

검증: 문서 연결 및 복구 테스트 10개 통과, SQLite 무결성 정상, 끊어진 첨부·단지·문서 참조 0개. 기존 시범 단지 동호수 원본 행 보존 확인.
