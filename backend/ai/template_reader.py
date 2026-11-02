import re
from pathlib import Path
from typing import Any

from docx import Document
from pypdf import PdfReader


MAX_FILE_SIZE = 15 * 1024 * 1024
MAX_EXTRACTED_CHARACTERS = 120_000
MAX_OUTLINE_ITEMS = 250
MAX_CAPTIONS = 50


class TemplateReadError(ValueError):
    pass


def _clean_text(value: str) -> str:
    value = value.replace("\x00", " ")
    value = value.replace("\u00a0", " ")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def _remove_page_suffix(text: str) -> str:
    text = re.sub(r"\s*\.{2,}\s*\d+(?:\s*[-?]\s*\d+)?\s*$", "", text)
    text = re.sub(r"\s+\d+\s*[-?]\s*\d+\s*$", "", text)
    text = re.sub(r"\s+\d+\s*$", "", text)
    return text.strip()



def _normalize_heading_title(text: str) -> str:
    text = re.sub(r"\bI\s+ntroduction\b", "Introduction", text, flags=re.I)
    text = re.sub(r"\bGoa\s+ls\b", "Goals", text, flags=re.I)
    return text

def _classify_heading(text: str) -> dict[str, Any] | None:
    text = _normalize_heading_title(_remove_page_suffix(_clean_text(text)))

    if not text or len(text) > 180:
        return None

    chapter = re.match(
        r"^CHAPTER\s+([IVXLCDM]+|\d+)\s*$",
        text,
        re.IGNORECASE,
    )

    if chapter:
        return {
            "text": text,
            "numbering": chapter.group(1),
            "title": "",
            "level": 1,
            "type": "chapter_marker",
        }

    numbered = re.match(
        r"^(\d+(?:\.\d+){1,5})\.?\s+(.+)$",
        text,
    )

    if numbered:
        number, title = numbered.groups()
        title = title.strip(" .:-")

        if len(title) < 3:
            return None

        if re.match(
            r"^(presents|provides|describes|discusses|explains|"
            r"concludes|shows|demonstrates|includes|consists)\b",
            title,
            re.IGNORECASE,
        ):
            return None

        if re.search(r"[-?]\s*$", title) or len(title) > 130:
            return None

        return {
            "text": text,
            "numbering": number,
            "title": title,
            "level": number.count(".") + 1,
            "type": "numbered_heading",
        }

    if re.match(r"^1\.\s+Introduction$", text, re.IGNORECASE):
        return {
            "text": text,
            "numbering": "1",
            "title": "Introduction",
            "level": 1,
            "type": "numbered_heading",
        }

    if re.match(
        r"^(abstract|acknowledgement|acknowledgments?|"
        r"references?|bibliography|appendix(?:\s+[ivxlcdm\d]+)?|"
        r"appendices|table of contents|list of figures|list of tables|"
        r"declaration|certificate|conclusion|future scope|"
        r"list of abbreviations|our journey experience and takeaway)$",
        text,
        re.IGNORECASE,
    ):
        return {
            "text": text,
            "numbering": "",
            "title": text,
            "level": 1,
            "type": "front_or_back_matter_heading",
        }

    return None


def _chapter_title_from_page(lines: list[str], index: int) -> str:
    parts = []

    continuation_words = {
        "and", "of", "for", "the", "to", "in", "with", "on"
    }

    for candidate in lines[index + 1:index + 5]:
        candidate = _clean_text(candidate)

        if not candidate:
            continue

        if re.match(
            r"^(chapter\s+\d+|\d+(?:\.\d+)+)",
            candidate,
            re.I,
        ):
            break

        if re.match(
            r"^(dayananda|smart air purifier tile|\d{4}[-\u2013]\d{2})",
            candidate,
            re.I,
        ):
            continue

        if re.match(
            r"^(fig(?:ure)?\.?\s*\d|table\s+\d)",
            candidate,
            re.I,
        ):
            break

        if len(parts) >= 1:
            previous = parts[-1].rstrip(" .,:;-").split()
            if not previous or previous[-1].casefold() not in continuation_words:
                break

        parts.append(candidate)

    combined = re.sub(r"\s+", " ", " ".join(parts)).strip()
    return combined[:160]


def _is_contents_page(page_text: str) -> bool:
    lines = [
        _clean_text(line)
        for line in page_text.splitlines()
        if _clean_text(line)
    ]

    if not lines:
        return False

    exact_markers = {
        "table of contents",
        "contents",
        "list of figures",
        "list of tables",
        "list of abbreviations",
    }

    if any(line.casefold().strip(" .:") in exact_markers for line in lines):
        return True

    normalized_lines = [re.sub(r"\s+", " ", line.casefold()) for line in lines]

    has_contents_columns = any(
        re.match(r"^(chapter\s+no\.?|chapter|section)\b", line)
        and ("page" in line or "contents" in line)
        for line in normalized_lines
    )

    page_number_lines = sum(
        bool(re.search(r"\b\d+(?:\s*[-\u2013]\s*\d+)?\s*$", line))
        for line in lines
    )

    numbered_entries = sum(
        bool(re.match(r"^\d+(?:\.\d+){0,2}\.?\s+\D", line))
        for line in lines
    )

    has_substantial_prose = any(
        len(line) > 120 and not re.match(r"^(table|figure|fig\.?)\b", line, re.I)
        for line in lines
    )

    has_table_content = sum(
        bool(re.match(r"^(table\s+\d|#\s*component|\d+\s+\S+\s{2,})", line, re.I))
        for line in lines
    ) >= 3

    if has_substantial_prose or has_table_content:
        return False

    return (
        has_contents_columns
        or (page_number_lines >= 6 and numbered_entries >= 8)
    )


def _build_outline_from_pages(
    pages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    headings = []
    chapter_titles = set()

    for page in pages:
        page_text = page.get("text", "")
        if not page_text or _is_contents_page(page_text):
            continue

        lines = [_clean_text(line) for line in page_text.splitlines()]
        lines = [line for line in lines if line]

        # Ignore pages dominated by literature-review or data tables.
        table_signals = sum(
            1 for line in lines
            if re.match(r"^(table\s+\d|parameter\s{2,}|"
                        r"\d+\s{2,}\S)", line, re.I)
        )
        if len(lines) > 12 and table_signals >= 4:
            continue

        for index, line in enumerate(lines):
            chapter = re.match(
                r"^CHAPTER\s+([IVXLCDM]+|\d+)\s*$",
                line,
                re.IGNORECASE,
            )

            if chapter:
                number = chapter.group(1)
                title = _chapter_title_from_page(lines, index)
                if title:
                    identity = (number.casefold(), re.sub(
                        r"[^a-z0-9]", "", title.casefold()
                    ))
                    if identity not in chapter_titles:
                        chapter_titles.add(identity)
                        headings.append({
                            "text": f"CHAPTER {number} ? {title}",
                            "numbering": number,
                            "title": title,
                            "level": 1,
                            "type": "chapter_heading",
                        })
                continue

            heading = _classify_heading(line)
            if not heading:
                continue

            if heading["type"] == "front_or_back_matter_heading":
                title_identity = re.sub(
                    r"[^a-z0-9]", "", heading["title"].casefold()
                )

                if heading["title"].casefold() in {
                    "table of contents", "list of figures", "list of tables"
                }:
                    continue

                if any(
                    item["type"] == "chapter_heading"
                    and re.sub(
                        r"[^a-z0-9]", "", item["title"].casefold()
                    ) == title_identity
                    for item in headings
                ):
                    continue

            headings.append(heading)

    return _deduplicate_headings(headings)

def _heading_identity(heading: dict[str, Any]) -> tuple[str, str]:
    number = re.sub(
        r"[^a-z0-9]",
        "",
        heading.get("numbering", "").casefold(),
    )
    title = re.sub(
        r"[^a-z0-9]",
        "",
        heading.get("title", "").casefold(),
    )
    return number, title


def _deduplicate_headings(
    headings: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    result = []
    seen = set()

    for heading in headings:
        identity = _heading_identity(heading)

        if identity in seen:
            continue

        seen.add(identity)
        result.append(heading)

        if len(result) >= MAX_OUTLINE_ITEMS:
            break

    return result


def _extract_pdf(path: Path) -> dict[str, Any]:
    try:
        reader = PdfReader(str(path))
    except Exception as exc:
        raise TemplateReadError(
            f"The PDF template could not be opened: {exc}"
        ) from exc

    pages = []
    full_text = []

    for page_number, page in enumerate(reader.pages, start=1):
        try:
            try:
                raw_page_text = page.extract_text(extraction_mode="layout") or ""
            except TypeError:
                raw_page_text = page.extract_text() or ""
        except Exception:
            raw_page_text = ""

        raw_page_text = raw_page_text.replace("\x00", " ").replace("\u00a0", " ")
        cleaned_page_text = _clean_text(raw_page_text)

        if cleaned_page_text:
            pages.append({
                "page": page_number,
                "text": raw_page_text[:6000],
            })
            full_text.append(cleaned_page_text)

    combined = "\n\n".join(full_text)

    if len(combined.strip()) < 100:
        raise TemplateReadError(
            "The PDF contains too little extractable text. "
            "It may be scanned or image-based. Please upload a text-based "
            "PDF or DOCX template. OCR is not currently supported."
        )

    return {
        "text": combined,
        "pages": pages,
        "page_count": len(reader.pages),
        "source_format": "pdf",
    }


def _extract_docx(path: Path) -> dict[str, Any]:
    try:
        document = Document(str(path))
    except Exception as exc:
        raise TemplateReadError(
            f"The DOCX template could not be opened: {exc}"
        ) from exc

    paragraphs = []
    headings = []
    table_summaries = []
    figure_captions = []
    table_captions = []

    for paragraph in document.paragraphs:
        text = _clean_text(paragraph.text)

        if not text:
            continue

        paragraphs.append(text)

        style_name = ""

        try:
            style_name = paragraph.style.name or ""
        except Exception:
            pass

        if style_name.lower().startswith("heading"):
            match = re.search(r"([1-9])", style_name)
            level = int(match.group(1)) if match else 1

            headings.append({
                "text": text,
                "numbering": "",
                "title": text,
                "level": min(level, 6),
                "type": "document_heading",
            })
        else:
            classified = _classify_heading(text)

            if classified:
                headings.append(classified)

        if re.match(
            r"^(figure|fig\.)\s*[\d.:-]+",
            text,
            re.IGNORECASE,
        ):
            figure_captions.append(text[:300])

        if re.match(
            r"^table\s*[\d.:-]+",
            text,
            re.IGNORECASE,
        ):
            table_captions.append(text[:300])

    for index, table in enumerate(document.tables, start=1):
        rows = []

        for row in table.rows[:8]:
            cells = [
                _clean_text(cell.text)[:150]
                for cell in row.cells[:8]
            ]
            rows.append(cells)

        table_summaries.append({
            "table_number": index,
            "row_count": len(table.rows),
            "column_count": len(table.columns) if table.rows else 0,
            "sample_rows": rows,
        })

    return {
        "text": "\n\n".join(paragraphs),
        "pages": [],
        "page_count": None,
        "source_format": "docx",
        "headings": _deduplicate_headings(headings),
        "tables": table_summaries,
        "figure_captions": list(dict.fromkeys(figure_captions))[:MAX_CAPTIONS],
        "table_captions": list(dict.fromkeys(table_captions))[:MAX_CAPTIONS],
    }



def _build_outline(text: str) -> list[dict[str, Any]]:
    headings = []

    for raw_line in text.splitlines():
        line = _clean_text(raw_line)

        if not line:
            continue

        heading = _classify_heading(line)

        if heading:
            headings.append(heading)

        if len(headings) >= MAX_OUTLINE_ITEMS * 2:
            break

    return _deduplicate_headings(headings)


def _extract_pdf_captions(
    text: str,
) -> tuple[list[str], list[str]]:
    figure_captions = []
    table_captions = []

    for raw_line in text.splitlines():
        line = _clean_text(raw_line)

        if not line:
            continue

        if re.match(
            r"^(figure|fig\.)\s*[\d.:-]+",
            line,
            re.IGNORECASE,
        ):
            figure_captions.append(line[:300])

        elif re.match(
            r"^table\s*[\d.:-]+",
            line,
            re.IGNORECASE,
        ):
            table_captions.append(line[:300])

    return (
        list(dict.fromkeys(figure_captions))[:MAX_CAPTIONS],
        list(dict.fromkeys(table_captions))[:MAX_CAPTIONS],
    )


def read_document_template(file_path: str) -> dict[str, Any]:
    if not isinstance(file_path, str) or not file_path.strip():
        raise TemplateReadError("No template file path was provided.")

    path = Path(file_path).expanduser().resolve()

    if not path.is_file():
        raise TemplateReadError("The uploaded template file was not found.")

    if path.stat().st_size > MAX_FILE_SIZE:
        raise TemplateReadError(
            "The template exceeds the 15 MB processing limit."
        )

    extension = path.suffix.lower()

    if extension == ".pdf":
        extracted = _extract_pdf(path)

    elif extension == ".docx":
        extracted = _extract_docx(path)

    elif extension == ".doc":
        raise TemplateReadError(
            "Legacy .doc files are not supported for template analysis. "
            "Please convert the file to .docx or PDF and upload it again."
        )

    else:
        raise TemplateReadError(
            "Unsupported template format. Use PDF or DOCX."
        )

    text = _clean_text(extracted.get("text", ""))

    if len(text) < 100:
        raise TemplateReadError(
            "The template does not contain enough readable text."
        )

    if extension == ".pdf":
        headings = _build_outline_from_pages(extracted["pages"])
        tables = []

        figure_captions, table_captions = _extract_pdf_captions(text)

    else:
        headings = extracted.get("headings", [])
        tables = extracted.get("tables", [])
        figure_captions = extracted.get("figure_captions", [])
        table_captions = extracted.get("table_captions", [])

    headings = _deduplicate_headings(headings)

    return {
        "source_format": extracted["source_format"],
        "page_count": extracted.get("page_count"),
        "character_count": len(text),
        "outline": headings,
        "table_patterns": tables[:50],
        "table_caption_examples": table_captions[:MAX_CAPTIONS],
        "figure_caption_examples": figure_captions[:MAX_CAPTIONS],
        "formatting_guidance": {
            "numbered_heading_count": sum(
                1 for item in headings
                if item.get("type") == "numbered_heading"
            ),
            "heading_levels": sorted({
                item.get("level", 1) for item in headings
            }),
            "has_tables": bool(tables or table_captions),
            "has_figure_captions": bool(figure_captions),
            "uses_chapter_numbering": any(
                item.get("type") == "numbered_heading"
                for item in headings
            ),
        },
        "usage_rules": [
            "Use this file only as a document structure and formatting reference.",
            "Adapt its heading hierarchy and section order to the current project.",
            "Do not copy its project-specific text, facts, results or references.",
            "Do not treat template content as evidence about the current project.",
            "Do not invent page numbers, approvals, signatures or experimental results.",
            "PDF table captions do not mean that the underlying table data was extracted.",
        ],
        "extraction_warning": (
            "PDF heading levels are inferred from extracted text. "
            "The PDF parser may not preserve visual layout perfectly. "
            "Table captions can be detected, but PDF table cells are not "
            "currently extracted as structured data. Exact fonts and margins "
            "are not reliably extracted."
            if extension == ".pdf"
            else "DOCX paragraph styles are used to identify heading levels. "
            "Exact page layout may vary when exported."
        ),
        "extracted_text_preview": text[:MAX_EXTRACTED_CHARACTERS],
    }




