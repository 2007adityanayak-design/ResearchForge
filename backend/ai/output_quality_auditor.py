import re
from collections import Counter
from typing import Any


def _normalize_text(text: str) -> str:
    """Normalize text for reliable duplicate detection."""

    return re.sub(r"\s+", " ", text.casefold()).strip()


def _create_finding(
    category: str,
    severity: str,
    location: str,
    finding: str,
    explanation: str,
    recommendation: str,
) -> dict[str, str]:

    return {
        "category": category,
        "severity": severity,
        "location": location,
        "finding": finding,
        "explanation": explanation,
        "recommendation": recommendation,
    }


def audit_generated_section(
    content: str,
    section_title: str,
    project_data: dict[str, Any] | None = None,
) -> list[dict[str, str]]:
    """
    Perform deterministic quality checks on generated academic content.

    This function never modifies the original content.
    Findings represent potential issues, not independently verified facts.
    """

    findings: list[dict[str, str]] = []

    if not isinstance(content, str) or not content.strip():
        findings.append(
            _create_finding(
                category="content_completeness",
                severity="critical",
                location=section_title,
                finding="Generated section is empty.",
                explanation="No usable academic content was supplied for auditing.",
                recommendation="Generate the section again with sufficient project information.",
            )
        )

        return findings

    text = content.strip()

    # ---------------------------------------------------------
    # 1. Content length checks
    # ---------------------------------------------------------

    word_count = len(re.findall(r"\b[\w'-]+\b", text))

    if word_count < 80:
        findings.append(
            _create_finding(
                category="content_completeness",
                severity="high",
                location=section_title,
                finding="Section contains very little content.",
                explanation=(
                    f"The section contains approximately {word_count} words. "
                    "This may be insufficient for a complete academic section."
                ),
                recommendation=(
                    "Expand the section with relevant explanations, "
                    "technical details and supporting discussion."
                ),
            )
        )

    elif word_count < 150:
        findings.append(
            _create_finding(
                category="content_completeness",
                severity="medium",
                location=section_title,
                finding="Section may lack sufficient depth.",
                explanation=(
                    f"The section contains approximately {word_count} words. "
                    "Its completeness depends on the purpose of the section."
                ),
                recommendation=(
                    "Review whether additional technical explanations, "
                    "evidence or relevant discussion are necessary."
                ),
            )
        )

    # ---------------------------------------------------------
    # 2. Repeated paragraph detection
    # ---------------------------------------------------------

    paragraphs = [
        paragraph.strip()
        for paragraph in re.split(r"\n\s*\n", text)
        if paragraph.strip()
    ]

    normalized_paragraphs = [
        _normalize_text(paragraph)
        for paragraph in paragraphs
    ]

    paragraph_counts = Counter(normalized_paragraphs)

    repeated_paragraphs = [
        paragraph
        for paragraph, count in paragraph_counts.items()
        if count > 1 and len(paragraph.split()) >= 12
    ]

    if repeated_paragraphs:
        findings.append(
            _create_finding(
                category="repetition",
                severity="high",
                location=section_title,
                finding="Repeated paragraphs detected.",
                explanation=(
                    f"{len(repeated_paragraphs)} paragraph(s) appear "
                    "more than once in the generated section."
                ),
                recommendation=(
                    "Remove accidental duplication while preserving "
                    "distinct explanations and necessary emphasis."
                ),
            )
        )

    # ---------------------------------------------------------
    # 3. Repeated sentence detection
    # ---------------------------------------------------------

    sentences = re.split(r"(?<=[.!?])\s+", text)

    normalized_sentences = [
        _normalize_text(sentence)
        for sentence in sentences
        if len(sentence.split()) >= 8
    ]

    sentence_counts = Counter(normalized_sentences)

    repeated_sentences = [
        sentence
        for sentence, count in sentence_counts.items()
        if count > 1
    ]

    if repeated_sentences:
        findings.append(
            _create_finding(
                category="repetition",
                severity="medium",
                location=section_title,
                finding="Repeated sentences detected.",
                explanation=(
                    f"{len(repeated_sentences)} sentence(s) are repeated "
                    "within the generated section."
                ),
                recommendation=(
                    "Review repeated sentences and remove unnecessary "
                    "duplication."
                ),
            )
        )

    # ---------------------------------------------------------
    # 4. Paragraph organization
    # ---------------------------------------------------------

    if word_count >= 150 and len(paragraphs) == 1:
        findings.append(
            _create_finding(
                category="organization",
                severity="medium",
                location=section_title,
                finding="Section contains only one paragraph.",
                explanation=(
                    "A lengthy section presented as one continuous "
                    "paragraph may be difficult to read."
                ),
                recommendation=(
                    "Organize the discussion into logically connected "
                    "paragraphs where appropriate."
                ),
            )
        )

    very_short_paragraphs = [
        paragraph
        for paragraph in paragraphs
        if len(paragraph.split()) < 8
    ]

    if len(paragraphs) >= 5 and len(very_short_paragraphs) >= 3:
        findings.append(
            _create_finding(
                category="organization",
                severity="low",
                location=section_title,
                finding="Several paragraphs are unusually short.",
                explanation=(
                    "Multiple paragraphs contain fewer than eight words, "
                    "which may indicate fragmented writing."
                ),
                recommendation=(
                    "Review paragraph transitions and combine related "
                    "sentences where appropriate."
                ),
            )
        )

    # ---------------------------------------------------------
    # 5. Vague academic language
    # ---------------------------------------------------------

    vague_phrases = [
        "many things",
        "various things",
        "very good",
        "very useful",
        "a lot of",
        "in today's world",
        "plays an important role",
        "has a great impact",
        "it is very important",
        "different types of things",
    ]

    detected_vague_phrases = [
        phrase
        for phrase in vague_phrases
        if phrase in text.casefold()
    ]

    if detected_vague_phrases:
        findings.append(
            _create_finding(
                category="academic_writing",
                severity="low",
                location=section_title,
                finding="Potentially vague academic expressions detected.",
                explanation=(
                    "The section contains general expressions that may "
                    "not communicate sufficiently precise information: "
                    + ", ".join(detected_vague_phrases)
                ),
                recommendation=(
                    "Replace vague expressions with precise technical "
                    "descriptions or evidence-supported explanations."
                ),
            )
        )

    # ---------------------------------------------------------
    # 6. Numerical and experimental claim detection
    # ---------------------------------------------------------

    numerical_claim_pattern = re.compile(
        r"\b(?:increased|decreased|reduced|improved|achieved|operated|"
        r"measured|recorded|observed|demonstrated|resulted in|emitted|emits|wavelength|"
        r"efficiency|accuracy|performance)\b"
        r".{0,100}?"
        r"\b\d+(?:\.\d+)?\s*(?:%|percent|ppm|mg|g|kg|"
        r"cm|mm|nm|um|m|°c|celsius|v|mv|a|ma|w|kw|"
        r"seconds?|minutes?|hours?|days?)(?=$|[\s.,;:!?)}\]])",
        re.IGNORECASE,
    )

    numerical_claims = numerical_claim_pattern.findall(text)

    if numerical_claims:
        findings.append(
            _create_finding(
                category="numerical_integrity",
                severity="high",
                location=section_title,
                finding="Quantitative performance claims require verification.",
                explanation=(
                    f"Detected {len(numerical_claims)} quantitative "
                    "performance statement(s). This rule cannot determine "
                    "whether the values are supported by actual evidence."
                ),
                recommendation=(
                    "Verify each value against supplied measurements, "
                    "experimental records, calculations or cited sources. "
                    "Do not present assumed values as measured results."
                ),
            )
        )

    # ---------------------------------------------------------
    # 7. Missing technical specificity indicators
    # ---------------------------------------------------------

    technical_terms = {
        "methodology",
        "algorithm",
        "architecture",
        "parameter",
        "measurement",
        "experiment",
        "equation",
        "calculation",
        "material",
        "component",
        "mechanism",
        "implementation",
        "configuration",
        "analysis",
        "evaluation",
        "simulation",
        "validation",
        "testing",
    }

    detected_technical_terms = {
        term
        for term in technical_terms
        if re.search(r"\b" + re.escape(term) + r"\b", text, re.IGNORECASE)
    }

    if word_count >= 150 and len(detected_technical_terms) < 2:
        findings.append(
            _create_finding(
                category="technical_depth",
                severity="low",
                location=section_title,
                finding="Limited technical terminology detected.",
                explanation=(
                    "The section contains relatively few technical "
                    "indicators. This does not establish that its "
                    "technical content is insufficient."
                ),
                recommendation=(
                    "Review whether relevant mechanisms, parameters, "
                    "methods, components or technical explanations "
                    "should be included."
                ),
            )
        )

    # ---------------------------------------------------------
    # 8. Final audit summary
    # ---------------------------------------------------------

    print(
        f"[QUALITY AUDITOR] Section: {section_title} | "
        f"Words: {word_count} | "
        f"Findings: {len(findings)}"
    )

    return findings
def summarize_quality_findings(
    findings: list[dict[str, str]],
) -> dict[str, Any]:
    """Create a severity-based summary of quality audit findings."""

    severity_counts = {
        "critical": 0,
        "high": 0,
        "medium": 0,
        "low": 0,
    }

    for finding in findings:
        severity = finding.get("severity", "").lower()

        if severity in severity_counts:
            severity_counts[severity] += 1

    if severity_counts["critical"] > 0:
        overall_status = "critical_issues"
    elif severity_counts["high"] > 0:
        overall_status = "needs_attention"
    elif severity_counts["medium"] > 0:
        overall_status = "review_recommended"
    elif severity_counts["low"] > 0:
        overall_status = "minor_improvements"
    else:
        overall_status = "no_issues_detected"

    return {
        "overall_status": overall_status,
        "total_findings": len(findings),
        "severity_counts": severity_counts,
        "passed": len(findings) == 0,
    }

def evaluate_generated_section(
    content: str,
    section_title: str,
    project_data: dict[str, Any],
    deterministic_findings: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """
    Evaluate generated academic content using the existing Gemini client.

    This function only evaluates content. It never rewrites or modifies it.
    """

    from ai.document_generator import (
        create_gemini_client,
        generate_json_response,
    )

    if not isinstance(content, str) or not content.strip():
        raise ValueError("Cannot evaluate empty generated content.")

    if not isinstance(project_data, dict):
        raise ValueError("Invalid project information supplied for evaluation.")

    evidence = {
        "project_name": project_data.get("name", ""),
        "document_type": project_data.get("document_type", ""),
        "problem_statement": project_data.get("problem_statement", ""),
        "research_objectives": project_data.get("research_objectives", ""),
        "research_notes": project_data.get("research_notes", ""),
        "figures": project_data.get("figures", []),
        "tables": project_data.get("tables", []),
    }

    evidence_json = __import__("json").dumps(
        evidence,
        ensure_ascii=False,
        indent=2,
        default=str,
    )

    deterministic_json = __import__("json").dumps(
        deterministic_findings or [],
        ensure_ascii=False,
        indent=2,
    )

    prompt = f"""
You are the independent academic quality evaluation engine of ResearchForge.

Evaluate the supplied generated academic section rigorously and objectively.

Your task is evaluation, not rewriting.

SECTION TITLE:
{section_title}

PROJECT EVIDENCE:
{evidence_json}

DETERMINISTIC AUDIT FINDINGS:
{deterministic_json}

GENERATED SECTION:
{content}

EVALUATION DIMENSIONS:

1. Technical depth:
   Evaluate whether technical concepts, mechanisms, methods and explanations
   are sufficiently detailed for the section's purpose.

2. Academic completeness:
   Identify important missing explanations, arguments or components.

3. Logical coherence:
   Evaluate organization, transitions, consistency and reasoning.

4. Relevance:
   Identify material that is irrelevant, repetitive or outside the
   selected section's purpose.

5. Factual consistency:
   Compare project-specific statements against the supplied project evidence.

6. Unsupported claims:
   Identify claims that appear stronger than the available evidence supports.

7. Numerical integrity:
   Examine measurements, percentages, calculations, units and experimental
   results. Do not assume that a number is fabricated merely because its
   supporting evidence is unavailable.

8. Citation integrity:
   Identify citation-related problems, unsupported attribution or references
   that require verification. Never invent or claim to have verified
   references that were not supplied.

9. Technical precision:
   Identify ambiguous terminology, unexplained abbreviations and vague
   technical statements.

10. Academic writing:
    Evaluate clarity, precision, formal language and unnecessary repetition.

STRICT EVALUATION RULES:

- Never invent project information, measurements, results or citations.
- Never assume an implementation was completed merely because it is described.
- Distinguish implemented, tested, proposed and future features.
- Do not treat missing evidence as proof that a statement is false.
- Do not penalize a section for information that is irrelevant to its purpose.
- Do not demand experimental results from sections that do not require them.
- Do not treat every missing detail as a serious problem.
- Avoid generic findings that do not identify a specific weakness.
- Do not repeat deterministic findings unless additional analysis is useful.
- Clearly distinguish confirmed inconsistencies from potential concerns.
- Do not rewrite, correct or generate replacement section content.
- Evaluate only the supplied content and evidence.
- Be rigorous, technically precise and evidence-conscious.

SEVERITY LEVELS:

critical: A serious contradiction, major integrity concern or fundamental
           problem that makes the section unreliable.

high: A substantial technical, factual or academic weakness.

medium: A meaningful weakness that should be reviewed.

low: A minor improvement or refinement.

Return valid JSON only, using exactly this structure:

{{
    "evaluation_status": "completed",
    "overall_score": 0,
    "score_explanation": "Brief explanation of the evaluation score.",
    "strengths": [
        "Specific strength identified in the section."
    ],
    "findings": [
        {{
            "category": "Technical depth",
            "severity": "medium",
            "location": "Specific paragraph or statement",
            "finding": "Specific problem identified.",
            "explanation": "Why this may affect academic quality.",
            "recommendation": "A practical improvement."
        }}
    ],
    "dimension_scores": {{
        "technical_depth": 0,
        "academic_completeness": 0,
        "logical_coherence": 0,
        "relevance": 0,
        "factual_consistency": 0,
        "numerical_integrity": 0,
        "academic_writing": 0
    }},
    "limitations": [
        "Important limitations of this evaluation."
    ]
}}

SCORING REQUIREMENTS:

- All scores must be integers between 0 and 100.
- overall_score represents the overall academic quality of this section.
- Dimension scores must reflect the actual section, not arbitrary defaults.
- A high score does not establish factual correctness.
- Missing evidence should reduce confidence, not automatically establish
  that a statement is false.
- Include empty arrays when no findings, strengths or limitations exist.
- Do not add fields outside the specified JSON structure.
- Do not use Markdown code fences.

Return the evaluation now.
"""

    client, model = create_gemini_client()

    result = generate_json_response(
        client=client,
        model=model,
        prompt=prompt,
        operation_name=f"QUALITY EVALUATION: {section_title}",
    )

    if not isinstance(result, dict):
        raise ValueError("AI quality evaluation must return a JSON object.")

    required_fields = {
        "evaluation_status",
        "overall_score",
        "score_explanation",
        "strengths",
        "findings",
        "dimension_scores",
        "limitations",
    }

    missing_fields = required_fields - result.keys()
    unexpected_fields = result.keys() - required_fields

    if unexpected_fields:
        raise ValueError(
            "AI quality evaluation returned unexpected fields: "
            + ", ".join(sorted(unexpected_fields))
        )

    if missing_fields:
        raise ValueError(
            "AI quality evaluation is missing required fields: "
            + ", ".join(sorted(missing_fields))
        )

    if result["evaluation_status"] != "completed":
        raise ValueError("AI quality evaluation did not complete successfully.")

    if (not isinstance(result["score_explanation"], str) or not result["score_explanation"].strip()):
        raise ValueError("AI quality evaluation returned an empty or invalid score explanation.")

    if (
        not isinstance(result["overall_score"], int)
        or isinstance(result["overall_score"], bool)
        or not 0 <= result["overall_score"] <= 100
    ):
        raise ValueError("AI quality evaluation returned an invalid overall score.")

    for field in ("strengths", "findings", "limitations"):
        if not isinstance(result[field], list):
            raise ValueError(
                f"AI quality evaluation returned an invalid '{field}' structure."
            )

    for finding in result["findings"]:
        if not isinstance(finding, dict):
            raise ValueError("AI quality evaluation returned an invalid finding.")

        finding_fields = {
            "category",
            "severity",
            "location",
            "finding",
            "explanation",
            "recommendation",
        }

        if finding_fields - finding.keys():
            raise ValueError("AI quality evaluation returned an incomplete finding.")

        if finding.keys() - finding_fields:
            raise ValueError("AI quality evaluation returned unexpected finding fields.")

        if not all(
            isinstance(finding[field], str) and finding[field].strip()
            for field in finding_fields
        ):
            raise ValueError("AI quality evaluation returned empty or invalid finding values.")

        if finding["severity"] not in {"critical", "high", "medium", "low"}:
            raise ValueError("AI quality evaluation returned an invalid severity.")

    dimension_scores = result["dimension_scores"]

    expected_dimensions = {
        "technical_depth",
        "academic_completeness",
        "logical_coherence",
        "relevance",
        "factual_consistency",
        "numerical_integrity",
        "academic_writing",
    }

    if not isinstance(dimension_scores, dict):
        raise ValueError("AI quality evaluation returned invalid dimension scores.")

    if expected_dimensions - dimension_scores.keys():
        raise ValueError("AI quality evaluation returned incomplete dimension scores.")

    if dimension_scores.keys() - expected_dimensions:
        raise ValueError("AI quality evaluation returned unexpected dimensions.")

    for dimension, score in dimension_scores.items():
        if (
            not isinstance(score, int)
            or isinstance(score, bool)
            or not 0 <= score <= 100
        ):
            raise ValueError(
                f"AI quality evaluation returned an invalid score for {dimension}."
            )

    for field in ("strengths", "limitations"):
        if not all(
            isinstance(item, str) and item.strip()
            for item in result[field]
        ):
            raise ValueError(
                f"AI quality evaluation returned invalid entries in '{field}'."
            )

    print(
        f"[QUALITY AUDITOR] AI evaluation completed | "
        f"Section: {section_title} | "
        f"Score: {result['overall_score']}/100 | "
        f"Findings: {len(result['findings'])}"
    )

    return result
