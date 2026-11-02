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

    def add_issue(
        category: str,
        severity: str,
        location: str,
        finding: str,
        recommendation: str,
    ) -> None:
        issues.append({
            "category": category,
            "severity": severity,
            "location": location,
            "finding": finding,
            "recommendation": recommendation,
        })

    # ---------------------------------------------------------
    # 1. Detect implementation-status contradictions.
    # ---------------------------------------------------------

    status_patterns = {
        "automatic_operation": (
            r"\bautomatically activates?\b",
            r"\boperates?\s+automatically\b",
            r"\bautomatic(?:\s+operation)?\b",
            r"\bautomated operation\b",
            r"\bautomatic switching\b",
            r"\bautomatic(?:ally)? controlled\b",
            r"\bwithout manual intervention\b",
            r"\bfully autonomous\b",
            r"\bldr[\s-]*(?:based|controlled|switching)\b",
        ),
        "manual_operation": (
            r"\boperates? in manual mode\b",
            r"\bmanually operated\b",
            r"\boperates? manually\b",
            r"\bmanual operation\b",
            r"\bmanually activated\b",
            r"\bmanual(?:ly)? controlled\b",
            r"\bdirect manual control\b",
            r"\bmanual activation\b",
        ),
    }

    status_locations: dict[str, list[str]] = {
        key: [] for key in status_patterns
    }

    for title, content in normalized_sections.items():
        text = content.casefold()

        for status, patterns in status_patterns.items():
            if any(re.search(pattern, text) for pattern in patterns):
                status_locations[status].append(title)

    if all(status_locations.values()):
        add_issue(
            "implementation_status",
            "high",
            ", ".join(
                status_locations["automatic_operation"]
                + status_locations["manual_operation"]
            ),
            (
                "Different sections describe both automatic and manual "
                "operation. These may represent different development stages, "
                "but the current implementation status is not established."
            ),
            (
                "Identify which operation mode is physically implemented, "
                "which has been tested, and which remains proposed. Do not "
                "assume that automatic operation is implemented."
            ),
        )


    automatic_evidence: dict[str, list[tuple[str, str]]] = {
        "implemented": [],
        "not_implemented": [],
    }

    automatic_status_patterns = (
        r"\bnot implemented\b",
        r"\bnot yet implemented\b",
        r"\bhas not been implemented\b",
        r"\bnot currently used\b",
        r"\bnot part of the current prototype\b",
    )

    for title, content in normalized_sections.items():
        for sentence in re.split(r"(?<=[.!?])\s+|\n+", content):
            sentence = sentence.strip()

            if not sentence or not any(
                re.search(pattern, sentence, re.IGNORECASE)
                for pattern in status_patterns["automatic_operation"]
            ):
                continue

            if any(
                re.search(pattern, sentence, re.IGNORECASE)
                for pattern in automatic_status_patterns
            ):
                automatic_evidence["not_implemented"].append((title, sentence))
            elif re.search(
                r"\bprototype operates?\s+automatically\b|\bprototype uses automatic operation\b|\bautomatic operation is implemented\b|\boperates?\s+automatically\b",
                sentence,
                re.IGNORECASE,
            ):
                automatic_evidence["implemented"].append((title, sentence))

    if all(automatic_evidence.values()):
        locations = list(dict.fromkeys(
            [title for title, _ in automatic_evidence["implemented"]]
            + [title for title, _ in automatic_evidence["not_implemented"]]
        ))

        add_issue(
            "implementation_status",
            "high",
            ", ".join(locations),
            (
                "Automatic operation is described as both implemented and "
                "not implemented in different statements."
            ),
            (
                "Verify the actual prototype configuration and distinguish "
                "implemented, tested, and proposed automatic-operation features."
            ),
        )

    # ---------------------------------------------------------
    # 2. Detect hardware and power-source status conflicts.
    # ---------------------------------------------------------

    hardware_groups = {
        "solar_power": (
            r"\bsolar panel\b",
            r"\bphotovoltaic\b",
            r"\bsolar[\s-]+powered\b",
            r"\bsolar energy harvesting\b",
        ),
        "rechargeable_storage": (
            r"\brechargeable battery\b",
            r"\bbattery charging\b",
            r"\bcharge controller\b",
            r"\bbattery storage\b",
        ),
        "non_rechargeable_storage": (
            r"\bnon[\s-]?rechargeable battery\b",
            r"\bprimary battery\b",
            r"\bdisposable battery\b",
        ),
    }

    hardware_evidence: dict[str, list[tuple[str, str]]] = {
        key: [] for key in hardware_groups
    }

    future_patterns = (
        r"\bfuture\b",
        r"\bproposed\b",
        r"\bplanned\b",
        r"\bpotential\b",
        r"\bwill be integrated\b",
        r"\bmay be integrated\b",
        r"\bto be implemented\b",
        r"\bintended to be\b",
        r"\bwould be\b",
    )

    not_implemented_patterns = (
        r"\bnot implemented\b",
        r"\bnot yet implemented\b",
        r"\bnot currently used\b",
        r"\bhas not been implemented\b",
        r"\bhas not been integrated\b",
        r"\bcurrently absent\b",
        r"\bnot part of the current prototype\b",
        r"\bexcluded from the current prototype\b",
    )

    current_patterns = (
        r"\bcurrently uses\b",
        r"\bcurrent prototype uses\b",
        r"\bcurrent prototype includes\b",
        r"\bis currently used\b",
        r"\bis implemented\b",
        r"\bhas been implemented\b",
        r"\bis integrated\b",
        r"\bhas been integrated\b",
        r"\bis installed\b",
        r"\bwas installed\b",
        r"\bphysically present\b",
        r"\bused in the prototype\b",
        r"\bpart of the prototype\b",
        r"\bthe prototype uses\b",
        r"\bthe prototype includes\b",
        r"\bthe system uses\b",
        r"\bthe system includes\b",
    )

    def classify_hardware_sentence(sentence: str) -> str:
        sentence = sentence.casefold()

        if any(re.search(pattern, sentence) for pattern in not_implemented_patterns):
            return "not_implemented"

        if any(re.search(pattern, sentence) for pattern in future_patterns):
            return "future_or_proposed"

        if any(re.search(pattern, sentence) for pattern in current_patterns):
            return "implemented_or_current"

        return "unspecified"

    hardware_evidence: dict[str, list[tuple[str, str, str]]] = {
        key: [] for key in hardware_groups
    }

    section_items = sections.items() if isinstance(sections, dict) else enumerate(sections)

    for title, section_data in section_items:
        if isinstance(section_data, dict):
            content = (
                section_data.get("content")
                or section_data.get("text")
                or section_data.get("body")
                or ""
            )
        else:
            content = str(section_data or "")

        if not isinstance(content, str):
            content = str(content)

        sentences = re.split(r"(?<=[.!?])\s+|\n+", content)

        for sentence in sentences:
            sentence = sentence.strip()

            if not sentence:
                continue

            for hardware, patterns in hardware_groups.items():
                if any(re.search(pattern, sentence, re.IGNORECASE) for pattern in patterns):
                    status = classify_hardware_sentence(sentence)

                    if status != "unspecified":
                        hardware_evidence[hardware].append(
                            (title, status, sentence[:240])
                        )

    for hardware, entries in hardware_evidence.items():
        current = [
            (title, sentence)
            for title, status, sentence in entries
            if status == "implemented_or_current"
        ]

        future = [
            (title, sentence)
            for title, status, sentence in entries
            if status == "future_or_proposed"
        ]

        not_implemented = [
            (title, sentence)
            for title, status, sentence in entries
            if status == "not_implemented"
        ]

        conflict = bool(
            (current and (future or not_implemented))
            or (future and not_implemented)
        )

        if conflict:
            locations = list(dict.fromkeys(
                [title for title, _ in current]
                + [title for title, _ in future]
                + [title for title, _ in not_implemented]
            ))

            add_issue(
                "hardware_implementation_status",
                "high",
                ", ".join(locations),
                (
                    f"The {hardware.replace('_', ' ')} feature has conflicting "
                    "sentence-level implementation descriptions."
                ),
                (
                    "Confirm whether this feature is physically implemented, "
                    "tested, not implemented, or planned for future development. "
                    "Align all report sections with the confirmed status."
                ),
            )

    # ---------------------------------------------------------
    # 3. Detect unsupported experimental and performance claims.
    # ---------------------------------------------------------

    result_claim_patterns = (
        r"\bsuccessfully demonstrated\b",
        r"\bsuccessfully validated\b",
        r"\btesting showed\b",
        r"\bconfirmed that\b",
        r"\bresults obtained\b",
        r"\bresults? (?:confirm|demonstrate|prove|establish)\b",
        r"\beffectively reduces?\b",
        r"\bvalidated in both\b",
        r"\bachieved\s+\d+(?:\.\d+)?\s*%?",
        r"\bdegraded?\s+\d+(?:\.\d+)?\s*%?",
        r"\bpollutant removal efficiency\b",
    )

    result_sections = {
        title: content
        for title, content in normalized_sections.items()
        if any(
            term in title.casefold()
            for term in ("result", "discussion", "conclusion", "abstract")
        )
    }

    claims = [
        title
        for title, content in result_sections.items()
        if any(
            re.search(pattern, content.casefold())
            for pattern in result_claim_patterns
        )
    ]

    if claims:
        add_issue(
            "experimental_evidence",
            "high",
            ", ".join(claims),
            (
                "The report contains claims of successful testing, validation, "
                "or pollutant-removal performance. These claims are not "
                "independently established by the presence of the statements."
            ),
            (
                "Check original experimental records. Require the measured "
                "quantity, units, test conditions, baseline and final values, "
                "sample count, and calculation method before presenting "
                "performance as an established result."
            ),
        )

    # ---------------------------------------------------------
    # 4. Detect vague figure descriptions.
    # ---------------------------------------------------------

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

            if not caption or caption.casefold() in {
                "figure", "image", "photo", "picture",
                "trail2", "untitled", "untitled figure",
            }:
                add_issue(
                    "figure_description",
                    "medium",
                    f"Figure {index}",
                    f"The figure caption '{caption or '(empty)'}' does not adequately identify the image.",
                    (
                        "Provide a descriptive caption and inspect the actual "
                        "image before making claims about what it depicts."
                    ),
                )

    # ---------------------------------------------------------
    # 5. Detect ambiguous tables and unsupported interpretations.
    # ---------------------------------------------------------

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
                "column", "column 1", "column 2", "column 3",
                "column 4", "header", "header 1", "header 2",
                "value", "values",
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
                            "and an explanation of what each row represents."
                        ),
                    )

            if not caption or caption.casefold() in {
                "table", "untitled", "untitled table", "trial table 1",
            }:
                add_issue(
                    "table_description",
                    "medium",
                    f"Table {index}",
                    f"The table caption '{caption or '(empty)'}' is not sufficiently descriptive.",
                    "Provide a caption that accurately describes the table's contents.",
                )

            if not description:
                add_issue(
                    "table_context",
                    "low",
                    f"Table {index}: {caption or '(untitled)'}",
                    "No explanatory table description has been supplied.",
                    "Add context explaining the table's purpose without inventing missing details.",
                )

    # ---------------------------------------------------------
    # 6. Detect missing project-level information.
    # ---------------------------------------------------------

    for field, label, recommendation, severity in (
        (
            "problem_statement",
            "Problem statement",
            "Ask the user to provide or confirm the problem statement.",
            "medium",
        ),
        (
            "research_objectives",
            "Research objectives",
            "Ask the user to provide or confirm the research objectives.",
            "medium",
        ),
        (
            "research_notes",
            "Research notes",
            "Request relevant implementation details, experimental records, or clarifications.",
            "low",
        ),
    ):
        value = project_data.get(field, "")
        if not isinstance(value, str) or not value.strip():
            add_issue(
                "missing_project_information",
                severity,
                label,
                f"The project has no saved {label.casefold()}.",
                recommendation,
            )


    # ---------------------------------------------------------
    # 7. Detect numerical claims unsupported by original inputs.
    # ---------------------------------------------------------

    numeric_unit_pattern = re.compile(
        r"(?<![A-Za-z0-9])"
        r"(-?\d+(?:,\d{3})*(?:\.\d+)?)"
        r"\s*"
        r"(nm|um|mm|cm|km|kg|mg|g|ml|l|kw|mw|w|mah|ah|"
        r"kv|mv|v|ma|a|kwh|wh|deg\s*c|seconds?|secs?|"
        r"minutes?|mins?|hours?|hrs?|days?|%|percent)"
        r"\b",
        re.IGNORECASE,
    )

    def extract_numeric_units(value: Any) -> set[tuple[float, str]]:
        if not isinstance(value, str):
            value = str(value)

        extracted = set()

        for match in numeric_unit_pattern.finditer(value):
            try:
                number = float(match.group(1).replace(",", ""))
            except ValueError:
                continue

            unit = re.sub(r"\s+", "", match.group(2).casefold())
            unit_aliases = {
                "um": "um",
                "degc": "?c",
                "secs": "second",
                "sec": "second",
                "seconds": "second",
                "mins": "minute",
                "min": "minute",
                "minutes": "minute",
                "hrs": "hour",
                "hr": "hour",
                "hours": "hour",
                "days": "day",
                "percent": "%",
            }
            unit = unit_aliases.get(unit, unit)
            extracted.add((number, unit))

        return extracted

    source_parts = []

    for field in (
        "problem_statement",
        "research_objectives",
        "research_notes",
        "name",
        "author_name",
        "institution",
        "department",
    ):
        value = project_data.get(field, "")
        if isinstance(value, str) and value.strip():
            source_parts.append(value)

    if isinstance(figures, list):
        for figure in figures:
            if isinstance(figure, dict):
                source_parts.extend(
                    str(figure.get(field, "") or "")
                    for field in ("caption", "description")
                )

    if isinstance(tables, list):
        for table in tables:
            if not isinstance(table, dict):
                continue

            source_parts.extend(
                str(table.get(field, "") or "")
                for field in ("caption", "description")
            )

            table_content = table.get("content", "")
            if isinstance(table_content, str):
                try:
                    table_content = json.loads(table_content)
                except (json.JSONDecodeError, TypeError):
                    pass

            source_parts.append(
                json.dumps(table_content, ensure_ascii=False)
                if isinstance(table_content, (dict, list))
                else str(table_content or "")
            )

    source_numeric_units = set()

    for source_part in source_parts:
        source_numeric_units.update(
            extract_numeric_units(source_part)
        )

    for title, content in normalized_sections.items():
        unsupported_values = (
            extract_numeric_units(content) - source_numeric_units
        )

        if unsupported_values:
            formatted_values = ", ".join(
                f"{number:g} {unit}"
                for number, unit in sorted(unsupported_values)
            )

            add_issue(
                "numerical_integrity",
                "medium",
                title,
                (
                    "The section contains numerical values with units that "
                    "could not be matched to the original project fields, "
                    "figure metadata, or table data: "
                    f"{formatted_values}. This does not establish that the "
                    "values are incorrect."
                ),
                (
                    "Verify each value against original measurements, "
                    "technical specifications, calculations, or a reliable "
                    "external academic source. Add its provenance before "
                    "presenting it as an established project fact."
                ),
            )

    return issues
