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

## 첫 번째 문제은행 XML 미리보기

현재 파서는 첫 번째 2027 EBS 변형 문제은행 형식에 맞춰져 있습니다.

1. 로컬 화면에서 `.hwpx` 문제은행을 선택합니다.
2. 인식된 전체 문항 수와 객관식·단답식 수를 확인합니다.
3. 문항 선택 메뉴에서 확인할 문항을 고릅니다.
4. `읽기 화면`에서 문제와 수식을 사람이 읽기 쉬운 형태로 확인합니다.
5. `XML 미리보기`에서 문제 영역, 정답 미주, 해설 미주 또는 전체
   `QuestionBlock`을 확인합니다.

수식은 읽기 화면에서 KaTeX로 렌더링합니다. 변환할 수 없는 일부 HWP 전용
수식 문법은 원문을 보존해 표시합니다.

원본 문제은행은 프로젝트에 복사하거나 저장하지 않습니다. 다른 문제은행
형식은 해당 파일의 XML 구조를 확인한 뒤 별도 파서를 추가해야 합니다.

`python-hwpx`는 저장소에 소스를 복사하지 않고 Python 의존성으로 사용합니다.

## 자동 검사와 GitHub Pages 배포

- `.github/workflows/ci.yml`: Python 테스트와 웹 빌드를 검사합니다.
- `.github/workflows/pages.yml`: CI가 성공한 `main` 커밋을 빌드해 GitHub
  Pages로 배포합니다.
- 배포 주소: <https://crownkimyg.github.io/hwpx-exam-builder/>

저장소의 **Settings → Pages → Build and deployment → Source**는
`GitHub Actions`로 설정해야 합니다. 비공개 저장소의 GitHub Pages 사용은
계정 요금제에 따라 제한될 수 있습니다.

## 민감 자료

실제 문제은행 및 시험지 파일(`.hwp`, `.hwpx`)은 Git에 커밋하지 않습니다.
비공개 샘플은 `data/` 또는 `samples/private/` 아래에서 관리하세요.
