"""Parser for the first 2027 EBS-variant HWPX question-bank format.

This parser is deliberately format-specific.  It uses an endnote as the
question anchor, a preceding ``❙...유사유형`` paragraph as the start marker,
and paragraph property 6 as the five-choice rows used by this sample.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import re
from typing import BinaryIO
from zipfile import BadZipFile, ZipFile

from lxml import etree


TITLE_RE = re.compile(
    r"❙\s*(예제|유제|기초연습|기본연습|실력완성)\s*(\d+)\s*(유사유형)?"
)
CHOICE_PARAGRAPH_IDS = {"6", "16"}
MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024


@dataclass(frozen=True)
class ParsedQuestion:
    ordinal: int
    source_label: str
    source_type: str
    source_number: int
    answer_type: str
    answer_value: str | int | None
    choice_count: int
    question_text: str
    explanation_text: str
    body_xml: str
    answer_xml: str
    explanation_xml: str
    full_xml: str
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class ParseResult:
    filename: str
    source_sha256: str
    questions: tuple[ParsedQuestion, ...]
    warnings: tuple[str, ...] = ()

    @property
    def multiple_choice_count(self) -> int:
        return sum(q.answer_type == "multiple_choice" for q in self.questions)

    @property
    def short_answer_count(self) -> int:
        return sum(q.answer_type == "short_answer" for q in self.questions)


def _local_name(element: etree._Element) -> str:
    return etree.QName(element).localname


def _descendants(element: etree._Element, name: str):
    return (item for item in element.iter() if _local_name(item) == name)


def _first_descendant(element: etree._Element, name: str):
    return next(_descendants(element, name), None)


def _equation_script(equation: etree._Element) -> str:
    script = _first_descendant(equation, "script")
    if script is None:
        return ""
    value = "".join(script.itertext()).strip()
    return value.splitlines()[0].strip() if value else ""


def _plain_text(element: etree._Element, *, skip_notes: bool = False) -> str:
    fragments: list[str] = []

    def visit(node: etree._Element) -> None:
        name = _local_name(node)
        if skip_notes and name == "endNote":
            return
        if name == "t" and node.text:
            fragments.append(node.text)
            return
        if name == "equation":
            script = _equation_script(node)
            if script:
                fragments.append(f" {{수식: {script}}} ")
            return
        if name == "lineBreak":
            fragments.append("\n")
        for child in node:
            visit(child)

    visit(element)
    return re.sub(r"[ \t]+", " ", "".join(fragments)).strip()


def _image_refs(element: etree._Element, *, skip_notes: bool = False) -> list[str]:
    refs: list[str] = []

    def visit(node: etree._Element) -> None:
        if skip_notes and _local_name(node) == "endNote":
            return
        if _local_name(node) == "img" and node.get("binaryItemIDRef"):
            refs.append(node.get("binaryItemIDRef"))
        for child in node:
            visit(child)

    visit(element)
    return refs


def _without_endnotes(element: etree._Element) -> etree._Element:
    clone = deepcopy(element)
    for note in list(_descendants(clone, "endNote")):
        parent = note.getparent()
        if parent is not None:
            parent.remove(note)
    return clone


def _xml_wrapper(name: str, elements: list[etree._Element], **attributes: str) -> str:
    wrapper = etree.Element(name, **attributes)
    for element in elements:
        wrapper.append(deepcopy(element))
    return etree.tostring(wrapper, encoding="unicode", pretty_print=True)


def _read_source(source: str | Path | bytes | bytearray | BinaryIO) -> tuple[bytes, str]:
    if isinstance(source, (str, Path)):
        path = Path(source)
        return path.read_bytes(), path.name
    if isinstance(source, (bytes, bytearray)):
        return bytes(source), "uploaded.hwpx"
    name = Path(getattr(source, "name", "uploaded.hwpx")).name
    return source.read(), name


def _find_part(archive: ZipFile, binary_ref: str) -> str | None:
    prefix = f"BinData/{binary_ref}."
    return next((name for name in archive.namelist() if name.startswith(prefix)), None)


def _digest_for_ref(archive: ZipFile, binary_ref: str) -> str | None:
    part = _find_part(archive, binary_ref)
    return sha256(archive.read(part)).hexdigest() if part else None


def _answer_value(
    archive: ZipFile,
    answer_paragraph: etree._Element,
    choice_refs: list[str],
) -> tuple[str, str | int | None, list[str]]:
    warnings: list[str] = []
    answer_images = _image_refs(answer_paragraph)
    if answer_images:
        answer_digest = _digest_for_ref(archive, answer_images[0])
        choice_digests = [_digest_for_ref(archive, ref) for ref in choice_refs]
        matches = [i + 1 for i, digest in enumerate(choice_digests) if digest == answer_digest]
        if len(matches) == 1:
            return "multiple_choice", matches[0], warnings
        warnings.append(f"정답 그림과 선택지 번호 그림의 일치 항목이 {len(matches)}개입니다.")
        return "multiple_choice", None, warnings

    equations = list(_descendants(answer_paragraph, "equation"))
    if equations:
        return "short_answer", _equation_script(equations[0]) or None, warnings

    text = _plain_text(answer_paragraph).replace("[정답]", "").strip()
    if not text:
        warnings.append("정답 영역에서 그림, 수식 또는 텍스트를 찾지 못했습니다.")
    return "short_answer", text or None, warnings


def parse_hwpx(source: str | Path | bytes | bytearray | BinaryIO) -> ParseResult:
    """Parse one file using the first-sample layout rules."""

    data, filename = _read_source(source)
    source_digest = sha256(data).hexdigest()
    try:
        archive = ZipFile(BytesIO(data))
    except BadZipFile as exc:
        raise ValueError("정상적인 HWPX ZIP 패키지가 아닙니다.") from exc

    with archive:
        total_size = sum(item.file_size for item in archive.infolist())
        if total_size > MAX_UNCOMPRESSED_BYTES:
            raise ValueError("압축 해제 크기가 허용 범위를 초과합니다.")
        section_names = sorted(
            name for name in archive.namelist()
            if re.fullmatch(r"Contents/section\d+\.xml", name)
        )
        if not section_names:
            raise ValueError("본문 section XML을 찾을 수 없습니다.")

        questions: list[ParsedQuestion] = []
        result_warnings: list[str] = []
        for section_name in section_names:
            parser = etree.XMLParser(resolve_entities=False, no_network=True, recover=False)
            root = etree.fromstring(archive.read(section_name), parser=parser)
            children = list(root)
            anchors: list[tuple[int, etree._Element]] = []
            for index, child in enumerate(children):
                note = _first_descendant(child, "endNote")
                if note is not None:
                    anchors.append((index, note))

            starts: list[int] = []
            metadata: list[tuple[str, str, int]] = []
            for anchor_index, _ in anchors:
                match = None
                start_index = anchor_index
                for candidate in range(anchor_index - 1, -1, -1):
                    candidate_text = _plain_text(children[candidate], skip_notes=True)
                    found = TITLE_RE.search(candidate_text)
                    if found:
                        match = found
                        start_index = candidate
                        break
                if match is None:
                    source_type, source_number, source_label = "미분류", 0, f"문항 {len(starts) + 1}"
                else:
                    source_type = match.group(1)
                    source_number = int(match.group(2))
                    source_label = match.group(0).strip()
                starts.append(start_index)
                metadata.append((source_label, source_type, source_number))

            for position, ((anchor_index, note), start_index, meta) in enumerate(
                zip(anchors, starts, metadata), start=1
            ):
                end_index = starts[position] if position < len(starts) else len(children)
                block = children[start_index:end_index]
                anchor = children[anchor_index]
                body_elements = [_without_endnotes(element) for element in block]

                note_paragraphs = list(_descendants(note, "p"))
                answer_paragraph = next(
                    (p for p in note_paragraphs if "[정답]" in _plain_text(p)),
                    note_paragraphs[0] if note_paragraphs else note,
                )
                explanation_start = next(
                    (i for i, p in enumerate(note_paragraphs) if "[해설]" in _plain_text(p)),
                    len(note_paragraphs),
                )
                explanation_paragraphs = note_paragraphs[explanation_start:]

                choice_refs: list[str] = []
                for element in block:
                    if (
                        _local_name(element) == "p"
                        and element.get("paraPrIDRef") in CHOICE_PARAGRAPH_IDS
                    ):
                        choice_refs.extend(_image_refs(element, skip_notes=True))
                answer_type, answer, warnings = _answer_value(
                    archive, answer_paragraph, choice_refs
                )
                if answer_type == "multiple_choice" and len(choice_refs) != 5:
                    warnings.append(f"객관식 선택지 번호 그림이 {len(choice_refs)}개입니다.")

                source_label, source_type, source_number = meta
                answer_xml = _xml_wrapper("answer", [answer_paragraph])
                explanation_xml = _xml_wrapper("explanation", explanation_paragraphs)
                body_xml = _xml_wrapper(
                    "body", body_elements, section=section_name, anchor=str(anchor_index)
                )
                full = etree.Element(
                    "questionBlock",
                    ordinal=str(position),
                    sourceLabel=source_label,
                    answerType=answer_type,
                    answerValue="" if answer is None else str(answer),
                )
                full.append(etree.fromstring(body_xml.encode()))
                full.append(etree.fromstring(answer_xml.encode()))
                full.append(etree.fromstring(explanation_xml.encode()))

                questions.append(
                    ParsedQuestion(
                        ordinal=position,
                        source_label=source_label,
                        source_type=source_type,
                        source_number=source_number,
                        answer_type=answer_type,
                        answer_value=answer,
                        choice_count=len(choice_refs),
                        question_text=_plain_text(anchor, skip_notes=True),
                        explanation_text="\n".join(
                            _plain_text(p).replace("[해설]", "").strip()
                            for p in explanation_paragraphs
                        ).strip(),
                        body_xml=body_xml,
                        answer_xml=answer_xml,
                        explanation_xml=explanation_xml,
                        full_xml=etree.tostring(full, encoding="unicode", pretty_print=True),
                        warnings=tuple(warnings),
                    )
                )

        if not questions:
            result_warnings.append("미주가 연결된 문항을 찾지 못했습니다.")
        return ParseResult(
            filename=filename,
            source_sha256=source_digest,
            questions=tuple(questions),
            warnings=tuple(result_warnings),
        )
