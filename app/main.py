"""Local UI for inspecting parsed HWPX question blocks."""

from pathlib import Path
import sys

import streamlit as st


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from question_bank import parse_hwpx


st.set_page_config(page_title="HWPX Exam Builder", page_icon="📝", layout="wide")

st.title("HWPX Exam Builder")
st.caption("첫 번째 문제은행 형식의 문항 영역과 미주를 XML로 점검합니다.")

uploaded = st.file_uploader(
    "문제은행 HWPX 파일",
    type=["hwpx"],
    help="파일은 현재 로컬 실행 과정에서만 읽으며 프로젝트나 Git 저장소에 저장하지 않습니다.",
)


@st.cache_data(show_spinner=False)
def parse_uploaded(data: bytes):
    return parse_hwpx(data)


if uploaded is None:
    st.info("첫 번째 샘플 형식의 HWPX 파일을 선택하면 문항별 XML을 표시합니다.")
    st.stop()

try:
    with st.spinner("문항 영역과 미주를 분석하는 중입니다..."):
        result = parse_uploaded(uploaded.getvalue())
except Exception as exc:
    st.error(f"파일을 분석하지 못했습니다: {exc}")
    st.stop()

count, multiple_choice, short_answer = st.columns(3)
count.metric("인식 문항", len(result.questions))
multiple_choice.metric("5지선다형", result.multiple_choice_count)
short_answer.metric("단답식", result.short_answer_count)

if len(result.questions) != 36:
    st.warning(f"이 샘플은 36문항이어야 하지만 {len(result.questions)}문항이 인식됐습니다.")
if result.warnings:
    for warning in result.warnings:
        st.warning(warning)

labels = [
    f"{q.ordinal:02d}. {q.source_label} · "
    f"{'객관식' if q.answer_type == 'multiple_choice' else '단답식'} · "
    f"정답 {q.answer_value if q.answer_value is not None else '확인 필요'}"
    for q in result.questions
]
selected_index = st.selectbox(
    "미리 볼 문항",
    range(len(labels)),
    format_func=lambda index: labels[index],
)
question = result.questions[selected_index]

summary, xml_preview = st.tabs(["문항 요약", "XML 미리보기"])

with summary:
    left, right = st.columns([2, 1])
    with left:
        st.subheader(question.source_label)
        st.text_area("문제 텍스트", question.question_text, height=180, disabled=True)
        st.text_area("해설 텍스트", question.explanation_text, height=240, disabled=True)
    with right:
        st.write("응답 유형", "객관식" if question.answer_type == "multiple_choice" else "단답식")
        st.write("인식 정답", question.answer_value)
        st.write("선택지 수", question.choice_count)
        if question.warnings:
            for warning in question.warnings:
                st.warning(warning)
        else:
            st.success("구조 검사 통과")

with xml_preview:
    body_tab, answer_tab, explanation_tab, full_tab = st.tabs(
        ["문제 영역", "정답 미주", "해설 미주", "전체 QuestionBlock"]
    )
    with body_tab:
        st.caption("미주를 제거한 문제유형 제목, 본문, 선택지 및 관련 문단입니다.")
        st.code(question.body_xml, language="xml", line_numbers=True)
    with answer_tab:
        st.code(question.answer_xml, language="xml", line_numbers=True)
    with explanation_tab:
        st.code(question.explanation_xml, language="xml", line_numbers=True)
    with full_tab:
        st.code(question.full_xml, language="xml", line_numbers=True)
