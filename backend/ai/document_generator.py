import json
import os
import random
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from google import genai
from google.genai import errors, types

PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")


def create_gemini_client():
    api_key = os.getenv("GEMINI_API_KEY")
    model = os.getenv("GEMINI_MODEL")

    if not api_key:
        raise ValueError("Gemini API key is not configured.")

    if not model:
        raise ValueError("Gemini model is not configured.")

    client = genai.Client(
        api_key=api_key,
        http_options={
            "timeout": 120000,
            "retry_options": types.HttpRetryOptions(attempts=1),
        },
    )

    return client, model


def generate_json_response(
    client: genai.Client,
    model: str,
    prompt: str,
    operation_name: str = "DOCUMENT GENERATOR",
) -> dict[str, Any]:

    started_at = time.perf_counter()
    retry_delays = [2, 5]

    print(f"[{operation_name}] Model: {model}")
    print(f"[{operation_name}] Prompt size: {len(prompt):,} characters")

    response = None

    for attempt in range(len(retry_delays) + 1):
        attempt_started = time.perf_counter()

        try:
            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config={
                    "response_mime_type": "application/json",
                    "temperature": 0.35,
                    "max_output_tokens": 8192,
                },
            )

            print(
                f"[{operation_name}] Completed in "
                f"{time.perf_counter() - attempt_started:.2f} seconds "
                f"(attempt {attempt + 1})."
            )
            break

        except errors.APIError as exc:
            print(
                f"[{operation_name}] Gemini HTTP error "
                f"{exc.code} (attempt {attempt + 1})."
            )

            if exc.code not in (408, 429, 500, 502, 503, 504):
                raise

            if attempt == len(retry_delays):
                raise

            delay = retry_delays[attempt] + random.uniform(0, 1)
            print(f"[{operation_name}] Retrying in {delay:.2f} seconds.")
            time.sleep(delay)

    if response is None or not response.text:
        raise ValueError("Gemini returned an empty response.")

    try:
        result = json.loads(response.text)
    except json.JSONDecodeError as exc:
        raise ValueError("Gemini returned invalid JSON.") from exc

    if not isinstance(result, dict):
        raise ValueError("Gemini returned an unexpected response structure.")

    print(
        f"[{operation_name}] Total time: "
        f"{time.perf_counter() - started_at:.2f} seconds."
    )

    return result


def validate_generated_section(
    result: dict[str, Any],
    expected_title: str,
) -> dict[str, Any]:

    required_fields = {
        "section_title",
        "content",
        "background_context",
        "information_gaps",
        "integrity_notes",
    }

    missing_fields = required_fields - result.keys()

    if missing_fields:
        raise ValueError(
            "Generated section is missing required fields: "
            + ", ".join(sorted(missing_fields))
        )

    section_title = result["section_title"]
    content = result["content"]

    if not isinstance(section_title, str) or not section_title.strip():
        raise ValueError("Generated section has an invalid title.")

    if section_title.strip().casefold() != expected_title.strip().casefold():
        raise ValueError(
            f"Expected section '{expected_title}', "
            f"but received '{section_title}'."
        )

    if not isinstance(content, str) or not content.strip():
        raise ValueError("Generated section content is empty or invalid.")

    for field in (
        "background_context",
        "information_gaps",
        "integrity_notes",
    ):
        if not isinstance(result[field], list):
            raise ValueError(
                f"Generated section contains an invalid '{field}' structure."
            )

        if not all(
            isinstance(item, str) and item.strip()
            for item in result[field]
        ):
            raise ValueError(
                f"Generated section contains invalid entries in '{field}'."
            )

    result["section_title"] = section_title.strip()
    result["content"] = content.strip()

    return result


def build_section_generation_prompt(
    project_data: dict[str, Any],
    section: dict[str, Any],
    document_plan: dict[str, Any] | None = None,
    previous_sections: dict[str, str] | None = None,
    generation_mode: str = "fill_empty",
) -> str:

    section_title = section.get("title", "").strip()

    if not section_title:
        raise ValueError("A valid section title is required.")

    if generation_mode not in ("fill_empty", "regenerate"):
        raise ValueError("Invalid section generation mode.")

    project_context = {
        "project_name": project_data.get("name", ""),
        "document_type": project_data.get("document_type", ""),
        "format_style": project_data.get("format_style", ""),
        "author_name": project_data.get("author_name", ""),
        "institution": project_data.get("institution", ""),
        "department": project_data.get("department", ""),
        "supervisor": project_data.get("supervisor", ""),
        "problem_statement": project_data.get("problem_statement", ""),
        "research_objectives": project_data.get("research_objectives", ""),
        "research_notes": project_data.get("research_notes", ""),
        "existing_sections": project_data.get("sections", {}),
        "figures": project_data.get("figures", []),
        "tables": project_data.get("tables", []),
    }

    section_context = {
        "section_id": section.get("section_id", ""),
        "title": section_title,
        "purpose": section.get("purpose", ""),
        "key_points": section.get("key_points", []),
        "source_fields": section.get("source_fields", []),
        "required_information": section.get("required_information", []),
        "suggested_word_count": section.get("suggested_word_count", ""),
    }

    context_json = json.dumps(
        project_context,
        ensure_ascii=False,
        indent=2,
        default=str,
    )

    section_json = json.dumps(
        section_context,
        ensure_ascii=False,
        indent=2,
        default=str,
    )

    plan_json = json.dumps(
        document_plan or {},
        ensure_ascii=False,
        indent=2,
        default=str,
    )

    plan_data = document_plan or {}

    evidence_constraints = {
        "integrity_requirements": plan_data.get("integrity_requirements", []),
        "missing_information": plan_data.get("missing_information", []),
    }

    evidence_constraints_json = json.dumps(
        evidence_constraints,
        ensure_ascii=False,
        indent=2,
        default=str,
    )

    previous_json = json.dumps(
        previous_sections or {},
        ensure_ascii=False,
        indent=2,
        default=str,
    )

    return f"""
You are ResearchForge, an advanced academic writing and research-document
generation engine.

Your responsibility is to generate one complete, detailed, academically
rigorous section of a larger document.

You must behave like an experienced academic researcher, technical writer,
subject specialist, critical reviewer and scientific editor.

==================================================
1. PROJECT INFORMATION
==================================================

{context_json}

==================================================
2. SELECTED SECTION
==================================================

{section_json}

==================================================
3. COMPLETE DOCUMENT PLAN
==================================================

{plan_json}

==================================================
4. PREVIOUSLY GENERATED SECTIONS
==================================================

{previous_json}

==================================================
5. MANDATORY EVIDENCE AND INTEGRITY CONSTRAINTS
==================================================

{evidence_constraints_json}

These constraints are mandatory.

- Follow every integrity requirement when generating this section.
- Treat missing-information entries as unresolved information, not as
  permission to invent missing project details.
- Never present disputed implementation details as established facts.
- If implementation status is unclear, explicitly qualify the statement
  or identify the information gap.
- Do not silently resolve contradictions between project information.
- Preserve the distinction between current implementation and future work.
- General academic knowledge may be used to expand explanations, but it
  must never be used to manufacture project-specific evidence.
- If a requirement cannot be satisfied because information is missing,
  clearly acknowledge the limitation.


==================================================
6. PRIMARY WRITING OBJECTIVE
==================================================

Generate the selected section with substantial academic depth.

Do not merely repeat the information supplied by the user.

Interpret the supplied information, understand its academic and technical
context, and develop it into a coherent, comprehensive section.

When the user supplies limited information, expand the discussion using
relevant, established academic and technical knowledge.

Useful expansion may include:

- Fundamental concepts and definitions.
- Relevant scientific and engineering principles.
- Established theories and technical explanations.
- Historical or academic background where relevant.
- Practical context and real-world significance.
- Relationships between the topic and related disciplines.
- Technical reasoning and explanations.
- Benefits, limitations and challenges supported by established knowledge.
- Relevant implications and carefully qualified interpretations.
- Connections to the project's stated objectives.
- Appropriate transitions and explanations.

Expansion must always remain relevant to the actual project and selected
section.

Never add paragraphs merely to increase word count.

==================================================
7. STRICT FACTUAL-INTEGRITY RULES
==================================================

These rules have the highest priority.

1. Never invent project-specific facts.

2. Never fabricate experiments, experimental procedures, measurements,
   test results, performance figures, observations, datasets or outcomes.

3. Never invent hardware, software, components, materials, sensors,
   algorithms or technologies that the user has not supplied.

4. Never claim that a proposed feature has been implemented.

5. Clearly distinguish:
   - Implemented features.
   - Tested features.
   - User-reported observations.
   - Verified experimental results.
   - Proposed improvements.
   - Future work.

6. Preserve every supplied numerical value exactly.
   Do not silently round, modify, reinterpret or replace values.

7. If information is missing, do not fill the gap with invented project
   information.

8. If the project information contains contradictions, do not silently
   choose one version. Identify the inconsistency.

9. Do not convert an assumption into an established fact.

10. Do not claim that a project has achieved a particular efficiency,
    accuracy, performance, environmental impact or improvement unless
    supporting information is supplied.

11. Do not invent citations, research papers, author names, publication
    years, journals, publishers, DOIs or reference entries.

12. If verified references are not supplied, write the conceptual
    explanation without pretending that a particular paper supports it.
    Mention the need for verified references in information_gaps when
    appropriate.

13. Do not pretend that figures or tables contain information that is
    unavailable in their actual supplied data.

14. Do not invent institutional details, certificate approvals,
    supervisor signatures, declarations or acknowledgements.

15. Never misrepresent general academic background as an experiment or
    achievement of the user's project.

==================================================
8. INTELLIGENT CONTENT-EXPANSION RULES
==================================================

When supplied information is insufficient:

1. Identify what the selected section is academically expected to explain.

2. Use established general knowledge to develop the missing conceptual
   explanation.

3. Explain the relevant principles in sufficient detail for the document
   type and academic level.

4. Connect general knowledge to the supplied project without inventing
   project-specific implementation details.

5. Clearly qualify general principles and illustrative applications.

6. Explain why the concepts matter to the project's objectives.

7. Include relevant limitations and technical challenges.

8. Avoid unrelated textbook material.

9. Avoid repetitive definitions and repeated conclusions.

10. Do not make the section artificially long.

The goal is meaningful academic completeness, not inflated word count.

==================================================
9. ACADEMIC WRITING QUALITY
==================================================

Write in professional, natural academic English.

The writing must be:

- Detailed and technically meaningful.
- Clear and logically organized.
- Grammatically correct.
- Formal without sounding unnecessarily complicated.
- Consistent in terminology.
- Appropriate for the selected document type.
- Appropriate for the selected section.
- Free from conversational filler.
- Free from repetitive statements.
- Free from unsupported superlative claims.

Use meaningful paragraphs with clear progression.

Use headings and subheadings when they improve readability.

Use numbered lists only when academically appropriate.

Explain technical terms when they are first introduced.

Use examples only when they genuinely clarify the subject. Never present
hypothetical examples as actual project results.

Avoid generic openings such as "In today's modern world" unless the
specific context genuinely requires them.

Avoid repeatedly using phrases such as "plays a vital role", "plays a
crucial role" and "in this modern era".

Do not write the same introduction, conclusion or explanation in every
section.

==================================================
10. DOCUMENT CONSISTENCY
==================================================

Consider the document type, document plan and previous sections.

Maintain consistent terminology, project naming and technical scope.

Do not repeat entire explanations already covered in previous sections.

Use previous sections to maintain continuity, not to copy their content.

Do not introduce objectives that conflict with the supplied objectives.

Do not introduce new project features simply because they would improve
the discussion.

Do not generate a conclusion for the entire document when only an
individual technical section is requested.

==================================================
11. SPECIAL SECTION HANDLING
==================================================

For title pages and front matter:
- Use only supplied author and institutional information.
- Use clear placeholders for unavailable required information.
- Never fabricate approvals or signatures.

For abstracts:
- Summarize only information supported by the project.
- Do not invent results or claim unverified success.

For literature reviews and related work:
- Do not invent studies or citations.
- Discuss established concepts where appropriate.
- Clearly identify where verified literature is needed.

For methodology:
- Describe only supplied or confirmed procedures as implemented.
- Clearly label suggested procedures as proposed, if relevant.

For implementation and system design:
- Do not invent architecture, components, code or implementation details.

For results and discussion:
- Preserve supplied data.
- Do not create measurements, graphs, comparisons or statistical findings.

For limitations and future scope:
- Distinguish actual limitations from possible future improvements.

For references:
- Never fabricate bibliography entries.
- If verified references are unavailable, clearly report that they are
  required.

For tables and lists:
- Do not reproduce unavailable table data.
- Do not invent figure or table contents.

For a table of contents or list of figures:
- Do not invent page numbers.
- These should be generated by the document layout/export system where
  possible.

==================================================
12. GENERATION MODE
==================================================

Current mode: {generation_mode}

If the mode is fill_empty:
Generate the section as new content.

If the mode is regenerate:
Produce a fresh, improved version while retaining all valid supplied
project facts and respecting the factual-integrity rules.

Do not mention the generation mode in the academic content.

==================================================
13. OUTPUT REQUIREMENTS
==================================================

Return valid JSON only.

Use exactly this structure:

{{
  "section_title": "{section_title}",
  "content": "Complete academic section as plain text",
  "background_context": [
    "Relevant general academic background incorporated into the section"
  ],
  "information_gaps": [
    "Important project information that is unavailable or requires confirmation"
  ],
  "integrity_notes": [
    "Factual limitations, qualifications or verification requirements"
  ]
}}

Additional output requirements:

- section_title must exactly match the selected section title.
- content must contain the complete section.
- content must be plain text, not HTML.
- Use newline characters for paragraph and heading separation.
- background_context must contain only relevant general background actually
  used in the generated section.
- information_gaps must identify meaningful missing information.
- integrity_notes must identify important qualifications or evidence limits.
- Use empty arrays when no items need to be reported.
- Do not add fields outside the specified JSON structure.
- Do not wrap the JSON in Markdown code fences.

Generate the section now.
"""


def generate_document_section(
    project_data: dict[str, Any],
    section: dict[str, Any],
    document_plan: dict[str, Any] | None = None,
    previous_sections: dict[str, str] | None = None,
    generation_mode: str = "fill_empty",
) -> dict[str, Any]:

    if not isinstance(project_data, dict):
        raise ValueError("Invalid project information.")

    if not isinstance(section, dict):
        raise ValueError("Invalid section information.")

    if generation_mode not in ("fill_empty", "regenerate"):
        raise ValueError("Invalid generation mode.")

    section_title = section.get("title", "").strip()

    if not section_title:
        raise ValueError("A valid section title is required.")

    prompt = build_section_generation_prompt(
        project_data=project_data,
        section=section,
        document_plan=document_plan,
        previous_sections=previous_sections,
        generation_mode=generation_mode,
    )

    client, model = create_gemini_client()

    result = generate_json_response(
        client=client,
        model=model,
        prompt=prompt,
        operation_name=f"SECTION: {section_title}",
    )

    return validate_generated_section(
        result=result,
        expected_title=section_title,
    )
