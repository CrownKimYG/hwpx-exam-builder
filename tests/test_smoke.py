from pathlib import Path


def test_streamlit_entrypoint_exists() -> None:
    assert Path("app/main.py").is_file()
