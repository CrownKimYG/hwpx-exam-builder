from io import BytesIO
from zipfile import ZipFile

from question_bank import parse_hwpx


def _sample_package() -> bytes:
    xml = b'''<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="urn:sec" xmlns:hp="urn:para" xmlns:hc="urn:core">
  <hp:p paraPrIDRef="26"><hp:run><hp:t>\xe2\x9d\x99\xec\x98\x88\xec\xa0\x9c1 \xec\x9c\xa0\xec\x82\xac\xec\x9c\xa0\xed\x98\x95</hp:t></hp:run></hp:p>
  <hp:p paraPrIDRef="17"><hp:run><hp:t>\xeb\xac\xb8\xec\xa0\x9c</hp:t><hp:endNote>
    <hp:p><hp:run><hp:t>[\xec\xa0\x95\xeb\x8b\xb5]</hp:t><hp:pic><hc:img binaryItemIDRef="answer"/></hp:pic></hp:run></hp:p>
    <hp:p><hp:run><hp:t>[\xed\x95\xb4\xec\x84\xa4] \xed\x95\xb4\xec\x84\xa4 \xeb\x82\xb4\xec\x9a\xa9</hp:t></hp:run></hp:p>
  </hp:endNote></hp:run></hp:p>
  <hp:p paraPrIDRef="6"><hp:run><hp:pic><hc:img binaryItemIDRef="c1"/></hp:pic><hp:pic><hc:img binaryItemIDRef="c2"/></hp:pic></hp:run></hp:p>
  <hp:p paraPrIDRef="6"><hp:run><hp:pic><hc:img binaryItemIDRef="c3"/></hp:pic><hp:pic><hc:img binaryItemIDRef="c4"/></hp:pic></hp:run></hp:p>
  <hp:p paraPrIDRef="6"><hp:run><hp:pic><hc:img binaryItemIDRef="c5"/></hp:pic></hp:run></hp:p>
</hs:sec>'''
    target = BytesIO()
    with ZipFile(target, "w") as archive:
        archive.writestr("Contents/section0.xml", xml)
        for index in range(1, 6):
            archive.writestr(f"BinData/c{index}.png", f"choice-{index}".encode())
        archive.writestr("BinData/answer.png", b"choice-3")
    return target.getvalue()


def test_parses_multiple_choice_and_previews_xml() -> None:
    result = parse_hwpx(_sample_package())
    assert len(result.questions) == 1
    question = result.questions[0]
    assert question.source_type == "예제"
    assert question.answer_type == "multiple_choice"
    assert question.answer_value == 3
    assert question.choice_count == 5
    assert "endNote" not in question.body_xml
    assert "[정답]" in question.answer_xml
    assert "[해설]" in question.explanation_xml
