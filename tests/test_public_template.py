from zipfile import ZIP_STORED, ZipFile


TEMPLATE = "web/public/templates/basic-math-exam.hwpx"


def test_public_exam_template_is_valid_and_content_free() -> None:
    with ZipFile(TEMPLATE) as archive:
        first = archive.infolist()[0]
        assert first.filename == "mimetype"
        assert first.compress_type == ZIP_STORED
        section = archive.read("Contents/section0.xml").decode("utf-8")

    assert "선택 문항 시험지" in section
    assert "{{QUESTIONS}}" in section
    assert "#해설" in section
    assert 'colCount="2"' in section
    assert "[정답]" not in section
    assert "[해설]" not in section


def test_web_uses_multi_bank_exam_workspace() -> None:
    html = open("web/index.html", encoding="utf-8").read()
    main_js = open("web/src/main.js", encoding="utf-8").read()
    builder_js = open("web/src/template-builder.js", encoding="utf-8").read()
    bank_js = open("web/src/bank-model.js", encoding="utf-8").read()
    quick_js = open("web/src/quick-generator.js", encoding="utf-8").read()

    assert 'id="folder-input"' in html and "webkitdirectory" in html
    assert 'id="files-input"' in html and "multiple" in html
    assert 'accept=".hwp,.hwpx"' in html
    assert "normalizeBankFile" in main_js
    assert 'id="preview-file"' in html
    assert 'id="matrix-wrap"' in html
    assert 'id="exam-list"' in html
    assert 'id="generation-bar"' in html
    assert 'id="output-type"' in html
    assert 'id="global-transform"' not in html
    assert 'id="hide-endnotes"' not in html
    assert '<link rel="stylesheet" href="./src/styles.css"' in html
    assert '<script type="module" src="./src/main.js"' in html
    assert 'window.location.protocol === "file:"' in html
    assert "RHWP_INIT_TIMEOUT_MS" in main_js
    assert 'dataset.rendererState = "ready"' in main_js
    assert "문항 미리보기" not in html
    assert "webkitGetAsEntry" in main_js
    assert "Shift+↑/↓" not in html
    assert "예: 01-003" not in main_js
    assert "브라우저에서만 처리" not in html
    assert "원본 그대로 복사해 시험지를 조립합니다" not in html
    assert "폴더를 끌어놓거나" not in html
    assert 'setStatus("준비 완료.")' not in main_js
    assert 'class="subtitle"' not in html
    assert 'class="privacy-badge"' not in html
    assert 'content="subject-handoff-v1"' in html
    assert 'id="bank-home"' in html
    assert 'id="bank-list-button"' not in html
    assert 'id="quick-question-count-label"' in html
    assert 'id="build-warning-dialog"' in html
    assert "최종 시험지 생성" in html
    assert "basic-math-exam.hwpx" in main_js
    assert 'id="save-project"' not in html
    assert 'id="project-file"' not in html
    assert "createProjectSnapshot" not in main_js
    assert 'value="ebsi-korean-v1"' in html
    assert "prepareEbsiKoreanHwpx" in main_js
    assert "parseBankFilename" in bank_js
    assert "estimateMaximumExamSets" in quick_js
    assert 'SEQUENTIAL_MARKER = "{{QUESTIONS}}"' in builder_js
    assert 'EXPLANATION_MARKER = "#해설"' in builder_js
    assert "buildExamFromSourcesHwpx" in builder_js
    assert 'copyMode: "root-endnote-block"' in open("web/src/parser.js", encoding="utf-8").read()
    assert "prepareMacroCopyElement" in builder_js
    assert "preserveOriginalContent: true" in main_js
    assert 'equation.setAttribute("baseUnit", "100")' in builder_js
