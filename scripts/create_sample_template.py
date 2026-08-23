"""Generate the public, content-free sample exam template."""

from pathlib import Path

from hwpx import HwpxDocument


OUTPUT = Path(__file__).resolve().parents[1] / "web/public/templates/basic-math-exam.hwpx"


def build_template() -> None:
    document = HwpxDocument.new()
    document.page.setup(
        paper_size="A4",
        margin_left_mm=15,
        margin_right_mm=15,
        margin_top_mm=13,
        margin_bottom_mm=13,
        header_margin_mm=8,
        footer_margin_mm=8,
        columns=1,
    )

    title_style = document.styles.ensure_run(bold=True, font="함초롬바탕", size=18)
    explanation_style = document.styles.ensure_run(bold=True, font="함초롬바탕", size=15)
    meta_style = document.styles.ensure_run(font="함초롬돋움", size=9.5, color="#425B62")
    body_style = document.styles.ensure_run(font="함초롬바탕", size=10.5)

    title = document.paragraphs[0]
    title.clear_text()
    title.add_run("선택 문항 시험지", char_pr_id_ref=title_style)
    document.styles.apply_paragraph_format(paragraph_index=0, alignment="CENTER", spacing_after_pt=8, keep_with_next=True)

    document.add_paragraph("과목: 수학    이름: ____________________    점수: __________", char_pr_id_ref=meta_style)
    document.styles.apply_paragraph_format(paragraph_index=1, alignment="CENTER", spacing_after_pt=8, keep_with_next=True)

    document.add_paragraph("※ 문항의 풀이 과정과 답을 답안지에 작성하세요.", char_pr_id_ref=body_style)
    document.styles.apply_paragraph_format(paragraph_index=2, alignment="LEFT", spacing_after_pt=9, keep_with_next=True)

    marker = document.add_paragraph("{{QUESTIONS}}", char_pr_id_ref=body_style)
    document.page.set_columns(2, same_gap=2268, paragraph=marker)

    explanation = document.add_paragraph(
        "#해설",
        char_pr_id_ref=explanation_style,
        pageBreak="1",
    )
    document.page.set_columns(1, paragraph=explanation)
    document.styles.apply_paragraph_format(
        paragraph_index=4,
        alignment="CENTER",
        spacing_after_pt=10,
        keep_with_next=True,
    )
    document.page.set_page_number(position="BOTTOM_CENTER")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    document.save_to_path(OUTPUT)


if __name__ == "__main__":
    build_template()
