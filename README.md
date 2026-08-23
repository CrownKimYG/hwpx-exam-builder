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

## 로컬 실행

### Python 미리보기

```bash
streamlit run app/main.py
```

명령을 실행하면 기본 브라우저에서 로컬 개발 화면이 열립니다.

Python 3.10 이상이 필요합니다.

### GitHub Pages용 웹 화면

GitHub Pages에서는 Python 서버를 실행할 수 없으므로, 웹 화면은 브라우저에서
HWPX를 직접 읽는 별도 정적 앱으로 구성되어 있습니다. 선택한 파일은 서버로
전송하지 않고 현재 브라우저 메모리에서만 처리됩니다.

```bash
pnpm install
pnpm dev
```

배포용 파일은 `pnpm build`로 `web/dist/`에 생성됩니다.

## 첫 번째 문제은행 페이지 미리보기

현재 파서는 첫 번째 2027 EBS 변형 문제은행 형식에 맞춰져 있습니다.

1. 로컬 화면에서 `.hwpx` 문제은행을 선택합니다.
2. 인식된 전체 문항 수와 객관식·단답식 수를 확인합니다.
3. 이전·다음 버튼으로 원본 문서 페이지를 확인합니다.

문항 카드에서는 문제·정답·해설의 수식을 각각 rhwp SVG로 확인할 수 있고,
키보드 좌우 방향키로 문항을 이동할 수 있습니다. 원하는 문항을 선택한 뒤
**선택 문항으로 시험지 생성**을 누르면 기본 2단 시험지 템플릿에 맞춘 HWPX가
브라우저에서 생성되어 내려받아집니다.

## 사용자 시험지 템플릿과 누름틀 입력

웹 화면에서 사용자가 시험지 HWPX 템플릿을 직접 선택할 수 있습니다.
템플릿의 `CLICK_HERE` 누름틀 필드명을 자동으로 읽어 입력칸을 생성하며,
같은 이름의 필드가 여러 곳에 있으면 한 번 입력한 값을 모든 위치에 적용합니다.

현재 샘플 템플릿에서 확인한 필드는 다음과 같습니다.

- `title`: 시험지 제목
- `time`: 시험 시간(분)
- `test_questions_count`: 총 문항 수

`test_questions_count`는 선택한 문항 수를 기본값으로 자동 연동하며 사용자가
필요하면 직접 수정할 수 있습니다. 입력한 값만 적용한 HWPX를 먼저 다운로드해
누름틀 반영 결과를 검증할 수도 있습니다.

사용자가 업로드한 템플릿 파일은 브라우저 메모리에서만 처리하며 저장소에
커밋하거나 서버로 업로드하지 않습니다.

공개용 기본 템플릿은 `web/public/templates/basic-math-exam.hwpx`에 있으며 실제
문제은행 내용은 포함하지 않습니다. 템플릿을 다시 만들 때는 다음 명령을
사용합니다.

```bash
python scripts/create_sample_template.py
```

웹 미리보기는 `@rhwp/core`의 WebAssembly 렌더러로 HWPX 문단·수식·표·그림을
페이지 SVG로 표시합니다. KaTeX 변환이나 원본 XML 코드는 화면에 노출하지
않습니다.

원본 문제은행은 프로젝트에 복사하거나 저장하지 않습니다. 다른 문제은행
형식은 해당 파일의 XML 구조를 확인한 뒤 별도 파서를 추가해야 합니다.

`python-hwpx`는 저장소에 소스를 복사하지 않고 Python 의존성으로 사용합니다.

## 자동 검사와 GitHub Pages 배포

- `.github/workflows/ci.yml`: Python 테스트와 웹 빌드를 검사합니다.
- `.github/workflows/pages.yml`: CI가 성공한 `main` 커밋을 빌드해 GitHub
  Pages로 배포합니다.
- 배포 주소: <https://crownkimyg.github.io/hwpx-exam-builder/>

저장소의 **Settings → Pages → Build and deployment → Source**는
`GitHub Actions`로 설정합니다.

## 민감 자료

실제 문제은행 및 시험지 파일(`.hwp`, `.hwpx`)은 Git에 커밋하지 않습니다.
비공개 샘플은 `data/` 또는 `samples/private/` 아래에서 관리하세요.
