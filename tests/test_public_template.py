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


def test_web_uses_order_input_and_optional_template() -> None:
    html = open("web/index.html", encoding="utf-8").read()
    main_js = open("web/src/main.js", encoding="utf-8").read()
    builder_js = open("web/src/template-builder.js", encoding="utf-8").read()

    assert 'id="question-order"' in html
    assert 'id="hide-endnotes"' in html
    assert '<link rel="stylesheet" href="./src/styles.css"' in html
    assert "문항 미리보기" not in html
    assert "dragenter" in main_js and "drop" in main_js
    assert "selectedOrdinals.join" in main_js
    assert "basic-math-exam.hwpx" in main_js
    assert 'SEQUENTIAL_MARKER = "{{QUESTIONS}}"' in builder_js
    assert 'EXPLANATION_MARKER = "#해설"' in builder_js
    assert 'equation.setAttribute("baseUnit", "100")' in builder_js
