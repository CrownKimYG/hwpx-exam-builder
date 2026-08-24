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
    assert "Shift+↑/↓" in html
    assert html.count("Shift+↑/↓ 파일 이동") == 1
    assert 'content="multi-bank-v2"' in html
    assert "basic-math-exam.hwpx" in main_js
    assert "createProjectSnapshot" in main_js
    assert "parseBankFilename" in bank_js
    assert "estimateMaximumExamSets" in quick_js
    assert 'SEQUENTIAL_MARKER = "{{QUESTIONS}}"' in builder_js
    assert 'EXPLANATION_MARKER = "#해설"' in builder_js
    assert "buildExamFromSourcesHwpx" in builder_js
    assert 'copyMode: "root-endnote-block"' in open("web/src/parser.js", encoding="utf-8").read()
    assert "prepareMacroCopyElement" in builder_js
    assert "preserveOriginalContent: true" in main_js
    assert 'equation.setAttribute("baseUnit", "100")' in builder_js
