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
    assert 'colCount="2"' in section
    assert "[정답]" not in section
    assert "[해설]" not in section
