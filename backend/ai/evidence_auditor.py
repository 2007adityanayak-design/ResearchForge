import json
import re
from typing import Any


def audit_project_evidence(project_data: dict[str, Any]) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []

    sections = project_data.get("sections", {})

    if not isinstance(sections, dict):
        sections = {}

    normalized_sections = {
        str(title).strip(): str(content)
        for title, content in sections.items()
        if isinstance(title, str) and isinstance(content, str)
    }

    combined_text = "\n".join(normalized_sections.values()).casefold()

    def add_issue(
        category: str,
        severity: str,
        location: str,
        finding: str,
        recommendation: str,
    ) -> None:
        issues.append(
            {
                "category": category,
                "severity": severity,
                "location": location,
                "finding": finding,
                "recommendation": recommendation,
            }
        )

    automatic_patterns = (
        r"\bautomatically activates?\b",
        r"\bautomated operation\b",
        r"\bautomatic switching\b",
        r"\bautomatic(?:ally)? controlled\b",
        r"\bwithout manual intervention\b",
        r"\bfully autonomous\b",
    )

    manual_patterns = (
        r"\boperates? in manual mode\b",
        r"\bmanually activated\b",
        r"\bmanual(?:ly)? controlled\b",
        r"\bplanned for future development\b",
        r"\bfuture development roadmap\b",
        r"\bplanned\b",
    )

    automatic_locations = []
    manual_locations = []

    for title, content in normalized_sections.items():
        text = content.casefold()

        if any(re.search(pattern, text) for pattern in automatic_patterns):
            automatic_locations.append(title)

        if any(re.search(pattern, text) for pattern in manual_patterns):
            manual_locations.append(title)

    if automatic_locations and manual_locations:
        add_issue(
            "implementation_status",
            "high",
            ", ".join(dict.fromkeys(automatic_locations + manual_locations)),
            (
                "The document contains statements suggesting automatic operation "
                "and statements suggesting manual operation or planned implementation. "
                "These statements may refer to different development stages."
            ),
            (
                "Compare the conflicting passages and establish which features are "
                "implemented, tested, proposed, or planned. Do not resolve the "
                "contradiction without confirmation."
            ),
        )

    result_claim_patterns = (
        r"\bsuccessfully demonstrated\b",
        r"\bsuccessfully validated\b",
        r"\btesting showed\b",
        r"\bconfirmed that\b",
        r"\bresults obtained\b",
        r"\bresults? (?:confirm|demonstrate|prove|establish)\b",
        r"\beffectively reduces?\b",
        r"\bvalidated in both\b",
    )

    result_sections = {
        title: content
        for title, content in normalized_sections.items()
        if any(
            term in title.casefold()
            for term in ("result", "discussion", "conclusion", "abstract")
        )
    }

    claims_found = any(
        re.search(pattern, content.casefold())
        for content in result_sections.values()
        for pattern in result_claim_patterns
    )

    if claims_found:
        add_issue(
            "experimental_evidence",
            "high",
            ", ".join(result_sections.keys()),
            (
                "The document makes claims about successful testing, validation, "
                "or pollutant reduction. The presence of these statements alone "
                "does not establish that the results are supported by measurements."
            ),
            (
                "Check the original experimental records. Where applicable, supply "
                "test conditions, baseline and final measurements, units, sample "
                "counts, and calculation methods. Preserve unsupported statements "
                "as reported claims until verified."
            ),
        )

    figures = project_data.get("figures", [])

    if isinstance(figures, list):
        for index, figure in enumerate(figures, start=1):
            if not isinstance(figure, dict):
                add_issue(
                    "figure_data",
                    "medium",
                    f"Figure {index}",
                    "The saved figure entry is not a valid object.",
                    "Inspect and correct the saved figure data.",
                )
                continue

            caption = str(figure.get("caption", "")).strip()
            caption_normalized = caption.casefold()

            if not caption or caption_normalized in {
                "figure",
                "image",
                "photo",
                "picture",
                "trail2",
                "untitled",
                "untitled figure",
            }:
                add_issue(
                    "figure_description",
                    "medium",
                    f"Figure {index}",
                    f"The figure caption '{caption or '(empty)'}' does not "
                    "adequately identify the image content.",
                    (
                        "Provide a descriptive caption. Inspect the actual image "
                        "before making claims about what it depicts."
                    ),
                )

    tables = project_data.get("tables", [])

    if isinstance(tables, list):
        for index, table in enumerate(tables, start=1):
            if not isinstance(table, dict):
                add_issue(
                    "table_data",
                    "medium",
                    f"Table {index}",
                    "The saved table entry is not a valid object.",
                    "Inspect and correct the saved table data.",
                )
                continue

            caption = str(table.get("caption", "")).strip()
            description = str(table.get("description", "")).strip()
            content = table.get("content", "")

            parsed_content: dict[str, Any] = {}

            if isinstance(content, str):
                try:
                    parsed = json.loads(content)
                    if isinstance(parsed, dict):
                        parsed_content = parsed
                except (json.JSONDecodeError, TypeError):
                    pass
            elif isinstance(content, dict):
                parsed_content = content

            rows = parsed_content.get("rows", [])
            headers = rows[0] if isinstance(rows, list) and rows else []

            generic_headers = {
                "column",
                "column 1",
                "column 2",
                "column 3",
                "column 4",
                "header",
                "header 1",
                "header 2",
                "value",
                "values",
            }

            if isinstance(headers, list) and headers:
                if any(
                    not isinstance(header, str)
                    or not header.strip()
                    or header.strip().casefold() in generic_headers
                    for header in headers
                ):
                    add_issue(
                        "table_interpretation",
                        "medium",
                        f"Table {index}: {caption or '(untitled)'}",
                        (
                            "The table contains empty or generic column headings. "
                            "Its values cannot reliably establish what was measured."
                        ),
                        (
                            "Provide meaningful column names, units, data provenance, "
                            "and an explanation of what each row represents before "
                            "using the table to support conclusions."
                        ),
                    )

            if not caption or caption.casefold() in {
                "table",
                "untitled",
                "untitled table",
                "trial table 1",
            }:
                add_issue(
                    "table_description",
                    "medium",
                    f"Table {index}",
                    f"The table caption '{caption or '(empty)'}' is not sufficiently descriptive.",
                    "Provide a caption that accurately describes the table's contents.",
                )

            if not description.strip():
                add_issue(
                    "table_context",
                    "low",
                    f"Table {index}: {caption or '(untitled)'}",
                    "No explanatory table description has been supplied.",
                    (
                        "Add context explaining the table's purpose and the meaning "
                        "of its data, if known. Do not invent missing details."
                    ),
                )

    if not project_data.get("problem_statement", "").strip():
        add_issue(
            "missing_project_information",
            "medium",
            "Problem statement",
            "The project has no saved problem statement.",
            "Ask the user to provide or confirm the problem statement before drafting claims that depend on it.",
        )

    if not project_data.get("research_objectives", "").strip():
        add_issue(
            "missing_project_information",
            "medium",
            "Research objectives",
            "The project has no saved research objectives.",
            "Ask the user to provide or confirm the research objectives.",
        )

    if not project_data.get("research_notes", "").strip():
        add_issue(
            "missing_project_information",
            "low",
            "Research notes",
            "No additional research notes have been saved.",
            "Request relevant implementation details, experimental records, or clarifications when needed.",
        )

    return issues
