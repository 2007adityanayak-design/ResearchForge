from typing import Any
from pathlib import Path
import re

from ai.document_planner import plan_document
from ai.document_generator import generate_document_section
from ai.evidence_auditor import audit_project_evidence
from ai.template_reader import read_document_template, TemplateReadError





def _load_template_guidance(project_data: dict[str, Any]) -> dict[str, Any] | None:
    relative_path = project_data.get("template_file_path")

    if not relative_path:
        return None

    if not isinstance(relative_path, str):
        raise TemplateReadError("Invalid uploaded template file path.")

    backend_root = Path(__file__).resolve().parents[1]
    template_directory = (backend_root / "uploads" / "templates").resolve()
    candidate = (backend_root / "uploads" / relative_path).resolve()

    if candidate.parent != template_directory:
        raise TemplateReadError("The uploaded template path is invalid.")

    template_data = read_document_template(str(candidate))

    allowed_fields = (
        "source_format",
        "page_count",
        "character_count",
        "outline",
        "table_patterns",
        "table_caption_examples",
        "figure_caption_examples",
        "formatting_guidance",
        "usage_rules",
        "extraction_warning",
    )

    return {
        key: template_data[key]
        for key in allowed_fields
        if key in template_data
    }


def normalize_section_key(value: str) -> str:
    """Normalize section IDs and titles for reliable matching."""
    return re.sub(r"[^a-z0-9]", "", value.casefold())


def generate_full_document(
    project_data: dict[str, Any],
    generation_mode: str = "fill_empty",
) -> dict[str, Any]:

    if not isinstance(project_data, dict):
        raise TypeError("Project data must be a dictionary.")

    if generation_mode not in ("fill_empty", "regenerate"):
        raise ValueError("Invalid generation mode.")

    project_id = project_data.get("id")

    if not project_id:
        raise ValueError("A valid project ID is required.")

    generation_project_data = project_data.copy()
    template_guidance = _load_template_guidance(generation_project_data)

    if template_guidance:
        generation_project_data["template_guidance"] = template_guidance

    document_plan = plan_document(generation_project_data)

    if not isinstance(document_plan, dict):
        raise ValueError("Invalid document plan.")

    recommended_sections = document_plan.get("recommended_sections")

    if not isinstance(recommended_sections, list) or not recommended_sections:
        raise ValueError("No recommended sections found in document plan.")

    existing_sections = (
        project_data.get("sections")
        or project_data.get("document_sections")
        or {}
    )

    previous_sections: dict[str, str] = {}

    if isinstance(existing_sections, dict):
        for section_id, content in existing_sections.items():
            if isinstance(section_id, str) and isinstance(content, str):
                previous_sections[section_id] = content

    elif isinstance(existing_sections, list):
        for item in existing_sections:
            if not isinstance(item, dict):
                continue

            section_id = item.get("section_id", "")
            content = item.get("content", "")

            if (
                isinstance(section_id, str)
                and isinstance(content, str)
                and section_id.strip()
            ):
                previous_sections[section_id] = content

    existing_key_lookup = {}

    for existing_key, content in previous_sections.items():
        normalized_key = normalize_section_key(existing_key)
        if normalized_key:
            existing_key_lookup[normalized_key] = existing_key

    generated_sections = []
    skipped_sections = []
    failed_sections = []

    for section in recommended_sections:

        if not isinstance(section, dict):
            failed_sections.append({
                "section_title": "Unknown section",
                "error": "Invalid section definition.",
            })
            continue

        title = section.get("title", "")
        section_id = section.get("section_id", "")

        if not isinstance(title, str) or not title.strip():
            failed_sections.append({
                "section_title": "Unknown section",
                "error": "Section has no valid title.",
            })
            continue

        if not isinstance(section_id, str) or not section_id.strip():
            failed_sections.append({
                "section_title": title,
                "error": "Section has no valid section ID.",
            })
            continue

        title = title.strip()
        section_id = section_id.strip()

        matching_existing_key = (
            existing_key_lookup.get(normalize_section_key(section_id))
            or existing_key_lookup.get(normalize_section_key(title))
        )

        existing_content = (
            previous_sections.get(matching_existing_key, "")
            if matching_existing_key else ""
        )

        # Protect populated template sections when the AI expands their titles.
        # This is deliberately conservative: every word in the existing
        # template title must appear in the recommended title.
        expanded_title_matches = []

        if generation_mode == "fill_empty":
            title_words = set(re.findall(r"[a-z0-9]+", title.casefold()))

            for existing_key, content in previous_sections.items():
                if not isinstance(content, str) or not content.strip():
                    continue

                existing_words = set(
                    re.findall(r"[a-z0-9]+", existing_key.casefold())
                )

                if (
                    existing_words
                    and existing_words.issubset(title_words)
                    and normalize_section_key(existing_key)
                    != normalize_section_key(title)
                ):
                    expanded_title_matches.append(existing_key)

        if generation_mode == "fill_empty" and (
            existing_content.strip() or expanded_title_matches
        ):
            skipped_sections.append({
                "section_id": section_id,
                "section_title": title,
                "existing_section_key": (
                    matching_existing_key
                    or expanded_title_matches[0]
                ),
                "skip_reason": (
                    "Matching existing section already contains content."
                ),
                "matched_existing_sections": (
                    expanded_title_matches
                    if expanded_title_matches
                    else [matching_existing_key]
                ),
            })
            continue

        try:
            result = generate_document_section(
                project_data=generation_project_data,
                section=section,
                document_plan=document_plan,
                previous_sections=previous_sections.copy(),
                generation_mode=generation_mode,
            )

            if not isinstance(result, dict):
                raise ValueError("Generator returned an invalid response.")

            content = result.get("content")

            if not isinstance(content, str) or not content.strip():
                raise ValueError("Generator returned empty section content.")

            canonical_key = matching_existing_key or title

            generated = {
                **section,
                **result,
                "section_id": section_id,
                "section_title": result.get("section_title") or title,
                "existing_section_key": canonical_key,
                "content": content,
            }

            generated_sections.append(generated)
            previous_sections[canonical_key] = content
            existing_key_lookup[normalize_section_key(canonical_key)] = canonical_key

        except Exception as error:
            failed_sections.append({
                "section_id": section_id,
                "section_title": title,
                "error": str(error),
            })

    evidence_findings = audit_project_evidence({
        **project_data,
        "sections": previous_sections.copy(),
    })

    return {
        "project_id": project_id,
        "project_name": project_data.get("name", "Untitled Project"),
        "document_plan": document_plan,
        "generated_sections": generated_sections,
        "skipped_sections": skipped_sections,
        "failed_sections": failed_sections,
        "all_sections": previous_sections,
        "evidence_findings": evidence_findings,
        "generation_complete": (
            not failed_sections
            and len(generated_sections) + len(skipped_sections)
            == len(recommended_sections)
        ),
    }
