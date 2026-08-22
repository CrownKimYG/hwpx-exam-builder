"""Local development UI for HWPX Exam Builder."""

import streamlit as st


st.set_page_config(page_title="HWPX Exam Builder", page_icon="📝", layout="wide")

st.title("HWPX Exam Builder")
st.caption("HWPX 문제은행에서 원하는 문항을 골라 시험지를 만드는 도구")

st.info("현재는 로컬 실행 환경과 기본 화면을 확인하는 초기 버전입니다.")

question_bank, template = st.columns(2)

with question_bank:
    st.subheader("1. 문제은행")
    st.file_uploader(
        "문제은행 HWPX 파일",
        type=["hwpx"],
        help="선택한 파일은 이 초기 화면에서 서버로 전송하거나 저장하지 않습니다.",
    )

with template:
    st.subheader("2. 시험지 템플릿")
    st.file_uploader(
        "템플릿 HWPX 파일",
        type=["hwpx"],
        help="템플릿 적용 기능은 다음 단계에서 구현합니다.",
    )

st.subheader("3. 시험지 구성")
unit = st.text_input("단원", placeholder="예: 지수와 로그")
difficulty = st.select_slider("난이도", options=[1, 2, 3, 4, 5], value=3)
question_count = st.number_input("문항 수", min_value=1, max_value=100, value=20)

if st.button("시험지 만들기", type="primary"):
    st.warning(
        f"아직 생성 엔진을 연결하지 않았습니다. "
        f"선택값: 단원={unit or '전체'}, 난이도={difficulty}, 문항 수={question_count}"
    )
