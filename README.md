# HWPX Exam Builder

HWPX 문제은행에서 문항을 선택하고 시험지를 생성하기 위한 프로젝트입니다.

## 프로젝트 구조

- `app/`: 애플리케이션과 사용자 인터페이스
- `question_bank/`: 문제은행 파싱 및 관리
- `exam_builder/`: 문항 선택과 시험지 생성
- `hwpx_engine/`: HWPX 복사, 스타일, 리소스, 미주 처리
- `templates/`: 시험지 템플릿
- `tests/`: 자동화 테스트

## 설치

Python 가상환경을 만든 뒤 의존성을 설치합니다.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

`python-hwpx`는 저장소에 소스를 복사하지 않고 Python 의존성으로 사용합니다.

## 민감 자료

실제 문제은행 및 시험지 파일(`.hwp`, `.hwpx`)은 Git에 커밋하지 않습니다.
비공개 샘플은 `data/` 또는 `samples/private/` 아래에서 관리하세요.
