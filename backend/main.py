import json
import os
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Form, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import inspect, text

from database.database import engine, Base, SessionLocal
from database.models import Project
from ai.project_analyzer import analyze_project
from ai.document_planner import plan_document
from ai.document_generator import generate_document_section
from ai.full_document_generator import generate_full_document
from ai.output_quality_auditor import (
    audit_generated_section,
    summarize_quality_findings,
    evaluate_generated_section,
)

app = FastAPI(title="ResearchForge API")

UPLOAD_DIRECTORY = Path(__file__).resolve().parent / "uploads"
UPLOAD_DIRECTORY.mkdir(parents=True, exist_ok=True)

app.mount(
    "/uploads",
    StaticFiles(directory=str(UPLOAD_DIRECTORY)),
    name="uploads",
)

Base.metadata.create_all(bind=engine)

MIGRATIONS = {
    "document_type": "VARCHAR(50) NOT NULL DEFAULT 'project_report'",
    "format_style": "VARCHAR(50) NOT NULL DEFAULT 'standard_academic'",
    "author_name": "VARCHAR(300) NOT NULL DEFAULT ''",
    "institution": "VARCHAR(200) DEFAULT ''",
    "department": "VARCHAR(150) DEFAULT ''",
    "supervisor": "VARCHAR(200) DEFAULT ''",
    "problem_statement": "TEXT DEFAULT ''",
    "research_objectives": "TEXT DEFAULT ''",
    "research_notes": "TEXT DEFAULT ''",
    "document_sections": "TEXT DEFAULT '{}'",
    "document_figures": "TEXT DEFAULT '[]'",
    "document_tables": "TEXT DEFAULT ''[]''",
    "template_file_path": "VARCHAR(500) DEFAULT ''",
    "template_file_name": "VARCHAR(255) DEFAULT ''",
}

with engine.begin() as connection:
    inspector = inspect(connection)

    if "projects" in inspector.get_table_names():
        existing_columns = {
            column["name"] for column in inspector.get_columns("projects")
        }

        for column_name, column_definition in MIGRATIONS.items():
            if column_name not in existing_columns:
                connection.execute(
                    text(
                        f'ALTER TABLE projects ADD COLUMN "{column_name}" '
                        f"{column_definition}"
                    )
                )

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


VALID_FORMATS = {
    "project_report": {
        "college_template",
        "standard_academic",
        "custom_template",
    },
    "research_paper": {
        "ieee",
        "apa",
        "standard_academic",
        "custom_template",
    },
    "review_paper": {
        "ieee",
        "apa",
        "standard_academic",
        "custom_template",
    },
    "thesis": {
        "university_template",
        "standard_academic",
        "custom_template",
    },
    "academic_report": {
        "standard_academic",
        "apa",
        "custom_template",
    },
}


class ResearchData(BaseModel):
    problem_statement: str = ""
    research_objectives: str = ""
    research_notes: str = ""


class DocumentSectionsData(BaseModel):
    sections: dict[str, str] = Field(default_factory=dict)


class GenerateSectionData(BaseModel):
    section: dict[str, Any]
    document_plan: dict[str, Any] = Field(default_factory=dict)
    previous_sections: dict[str, str] = Field(default_factory=dict)
    generation_mode: str = "fill_empty"


class GenerateFullDocumentData(BaseModel):
    generation_mode: str = "fill_empty"


class FiguresData(BaseModel):
    figures: list[dict[str, Any]] = Field(default_factory=list)


class TablesData(BaseModel):
    tables: list[dict[str, Any]] = Field(default_factory=list)


def get_project_or_404(db, project_id: int):
    project = db.query(Project).filter(Project.id == project_id).first()

    if project is None:
        raise HTTPException(
            status_code=404,
            detail="Document not found.",
        )

    return project


def load_json(value: str | None, fallback):
    if not value:
        return fallback

    try:
        result = json.loads(value)
        return result
    except (json.JSONDecodeError, TypeError):
        return fallback


def project_summary(project):
    return {
        "id": project.id,
        "name": project.name,
        "document_type": project.document_type,
        "format_style": project.format_style,
        "author_name": project.author_name or "",
        "institution": project.institution or "",
        "department": project.department or "",
        "supervisor": project.supervisor or "",
        "template_file_path": project.template_file_path or "",
        "template_file_name": project.template_file_name or "",
    }


@app.get("/")
def home():
    return {
        "message": "ResearchForge backend is running!",
        "status": "online",
    }


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "application": "ResearchForge",
    }


@app.post("/projects")
def create_project(
    project_name: str = Form(...),
    document_type: str = Form(...),
    format_style: str = Form(...),
    author_name: str = Form(...),
    institution: str = Form(""),
    department: str = Form(""),
    supervisor: str = Form(""),
    template_file: UploadFile | None = File(None),
):
    project_name = project_name.strip()
    author_name = author_name.strip()

    if not project_name:
        raise HTTPException(status_code=422, detail="Document title is required.")

    if len(project_name) > 150:
        raise HTTPException(status_code=422, detail="Document titles cannot exceed 150 characters.")

    if not author_name:
        raise HTTPException(status_code=422, detail="At least one author name is required.")

    if document_type not in VALID_FORMATS:
        raise HTTPException(status_code=422, detail="Invalid document type.")

    if format_style not in VALID_FORMATS[document_type]:
        raise HTTPException(
            status_code=422,
            detail="The selected formatting style is not valid for this document type.",
        )

    template_path = ""
    template_name = ""
    stored_path = None

    if template_file and template_file.filename:
        extension = Path(template_file.filename).suffix.lower()
        allowed_extensions = {".pdf", ".docx", ".doc"}

        if extension not in allowed_extensions:
            raise HTTPException(
                status_code=422,
                detail="Only PDF, DOCX, and DOC templates are supported.",
            )

        file_data = template_file.file.read()

        if len(file_data) > 15 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Template file cannot exceed 15 MB.")

        signatures = {
            ".pdf": file_data.startswith(b"%PDF-"),
            ".docx": file_data.startswith(b"PK"),
            ".doc": file_data.startswith(bytes.fromhex("D0CF11E0A1B11AE1")),
        }

        if not signatures[extension]:
            raise HTTPException(
                status_code=422,
                detail="The uploaded file does not match its file extension.",
            )

        template_directory = UPLOAD_DIRECTORY / "templates"
        template_directory.mkdir(parents=True, exist_ok=True)

        stored_name = f"{uuid.uuid4().hex}{extension}"
        stored_path = template_directory / stored_name
        stored_path.write_bytes(file_data)

        template_path = f"templates/{stored_name}"
        template_name = Path(template_file.filename).name

    db = SessionLocal()

    try:
        new_project = Project(
            name=project_name,
            document_type=document_type,
            format_style=format_style,
            author_name=author_name,
            institution=institution.strip(),
            department=department.strip(),
            supervisor=supervisor.strip(),
            problem_statement="",
            research_objectives="",
            research_notes="",
            document_sections="{}",
            document_figures="[]",
            document_tables="[]",
            template_file_path=template_path,
            template_file_name=template_name,
        )

        db.add(new_project)
        db.commit()
        db.refresh(new_project)

        return {
            "message": "Document created successfully!",
            "project_id": new_project.id,
            "project_name": new_project.name,
            "document_type": new_project.document_type,
            "format_style": new_project.format_style,
            "template_file_name": new_project.template_file_name,
        }

    except Exception:
        db.rollback()
        if stored_path:
            stored_path.unlink(missing_ok=True)
        raise

    finally:
        db.close()


def get_safe_template_path(relative_path: str):
    if not relative_path:
        return None

    template_directory = (UPLOAD_DIRECTORY / "templates").resolve()
    candidate = (UPLOAD_DIRECTORY / relative_path).resolve()

    if candidate.parent != template_directory:
        return None

    return candidate


@app.post("/projects/{project_id}/template")
def replace_project_template(
    project_id: int,
    template_file: UploadFile = File(...),
):
    extension = Path(template_file.filename or "").suffix.lower()

    if extension not in {".pdf", ".docx", ".doc"}:
        raise HTTPException(
            status_code=422,
            detail="Only PDF, DOCX, and DOC templates are supported.",
        )

    file_data = template_file.file.read()

    if not file_data:
        raise HTTPException(status_code=422, detail="The template file is empty.")

    if len(file_data) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Template file cannot exceed 15 MB.")

    signatures = {
        ".pdf": file_data.startswith(b"%PDF-"),
        ".docx": file_data.startswith(b"PK"),
        ".doc": file_data.startswith(bytes.fromhex("D0CF11E0A1B11AE1")),
    }

    if not signatures[extension]:
        raise HTTPException(
            status_code=422,
            detail="The uploaded file does not match its file extension.",
        )

    template_directory = UPLOAD_DIRECTORY / "templates"
    template_directory.mkdir(parents=True, exist_ok=True)

    stored_name = f"{uuid.uuid4().hex}{extension}"
    stored_path = template_directory / stored_name
    stored_path.write_bytes(file_data)

    db = SessionLocal()
    old_path = None

    try:
        project = get_project_or_404(db, project_id)
        old_path = get_safe_template_path(project.template_file_path or "")

        project.template_file_path = f"templates/{stored_name}"
        project.template_file_name = Path(template_file.filename).name

        db.commit()
        db.refresh(project)

        if old_path and old_path != stored_path.resolve():
            old_path.unlink(missing_ok=True)

        return {
            "message": "Formatting template uploaded successfully.",
            "template_file_path": project.template_file_path,
            "template_file_name": project.template_file_name,
        }

    except Exception:
        db.rollback()
        stored_path.unlink(missing_ok=True)
        raise

    finally:
        db.close()


@app.delete("/projects/{project_id}/template")
def remove_project_template(project_id: int):
    db = SessionLocal()

    try:
        project = get_project_or_404(db, project_id)
        old_path = get_safe_template_path(project.template_file_path or "")

        project.template_file_path = ""
        project.template_file_name = ""

        db.commit()

        if old_path:
            old_path.unlink(missing_ok=True)

        return {"message": "Formatting template removed successfully."}

    finally:
        db.close()

@app.get("/projects")
def get_projects():
    db = SessionLocal()

    try:
        projects = db.query(Project).order_by(Project.id.desc()).all()

        return [project_summary(project) for project in projects]

    finally:
        db.close()


@app.get("/projects/{project_id}")
def get_project(project_id: int):
    db = SessionLocal()

    try:
        project = get_project_or_404(db, project_id)
        return project_summary(project)

    finally:
        db.close()


@app.delete("/projects/{project_id}")
def delete_project(project_id: int):
    db = SessionLocal()

    try:
        project = get_project_or_404(db, project_id)

        db.delete(project)
        db.commit()

        return {
            "message": "Document deleted successfully.",
            "project_id": project_id,
        }

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()


@app.get("/projects/{project_id}/research")
def get_research(project_id: int):
    db = SessionLocal()

    try:
        project = get_project_or_404(db, project_id)

        return {
            "project_id": project.id,
            "project_name": project.name,
            "document_type": project.document_type,
            "format_style": project.format_style,
            "author_name": project.author_name or "",
            "institution": project.institution or "",
            "department": project.department or "",
            "supervisor": project.supervisor or "",
        "template_file_path": project.template_file_path or "",
        "template_file_name": project.template_file_name or "",
            "problem_statement": project.problem_statement or "",
            "research_objectives": project.research_objectives or "",
            "research_notes": project.research_notes or "",
        }

    finally:
        db.close()


@app.put("/projects/{project_id}/research")
def save_research(
    project_id: int,
    research: ResearchData,
):
    db = SessionLocal()

    try:
        project = get_project_or_404(db, project_id)

        project.problem_statement = research.problem_statement
        project.research_objectives = research.research_objectives
        project.research_notes = research.research_notes

        db.commit()

        return {
            "message": "Research information saved successfully.",
            "project_id": project.id,
        }

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()


@app.get("/projects/{project_id}/sections")
def get_document_sections(project_id: int):
    db = SessionLocal()

    try:
        project = get_project_or_404(db, project_id)

        sections = load_json(
            project.document_sections,
            {},
        )

        return {
            "project_id": project.id,
            "project_name": project.name,
            "document_type": project.document_type,
            "sections": sections,
        }

    finally:
        db.close()


@app.put("/projects/{project_id}/sections")
def save_document_sections(
    project_id: int,
    section_data: DocumentSectionsData,
):
    db = SessionLocal()

    try:
        project = get_project_or_404(db, project_id)

        existing_sections = load_json(
            project.document_sections,
            {},
        )

        existing_sections.update(section_data.sections)

        project.document_sections = json.dumps(
            existing_sections,
            ensure_ascii=False,
        )

        db.commit()

        return {
            "message": "Document sections saved successfully.",
            "project_id": project.id,
            "sections": existing_sections,
        }

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()


@app.get("/projects/{project_id}/figures")
def get_document_figures(project_id: int):
    db = SessionLocal()

    try:
        project = get_project_or_404(db, project_id)

        figures = load_json(
            project.document_figures,
            [],
        )

        return {
            "project_id": project.id,
            "figures": figures,
        }

    finally:
        db.close()


@app.put("/projects/{project_id}/figures")
def save_document_figures(
    project_id: int,
    figure_data: FiguresData,
):
    db = SessionLocal()

    try:
        project = get_project_or_404(db, project_id)

        project.document_figures = json.dumps(
            figure_data.figures,
            ensure_ascii=False,
        )

        db.commit()

        return {
            "message": "Figures saved successfully.",
            "project_id": project.id,
            "figures": figure_data.figures,
        }

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()


@app.get("/projects/{project_id}/tables")
def get_document_tables(project_id: int):
    db = SessionLocal()

    try:
        project = get_project_or_404(db, project_id)

        tables = load_json(
            project.document_tables,
            [],
        )

        return {
            "project_id": project.id,
            "tables": tables,
        }

    finally:
        db.close()


@app.put("/projects/{project_id}/tables")
def save_document_tables(
    project_id: int,
    table_data: TablesData,
):
    db = SessionLocal()

    try:
        project = get_project_or_404(db, project_id)

        project.document_tables = json.dumps(
            table_data.tables,
            ensure_ascii=False,
        )

        db.commit()

        return {
            "message": "Tables saved successfully.",
            "project_id": project.id,
            "tables": table_data.tables,
        }

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()


ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}

MAX_IMAGE_SIZE = 5 * 1024 * 1024


@app.post("/projects/{project_id}/figures/upload")
async def upload_figure_image(
    project_id: int,
    image: UploadFile = File(...),
):
    content_type = (image.content_type or "").lower()

    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Only JPG, PNG, WEBP, and GIF images are allowed.",
        )

    db = SessionLocal()

    try:
        get_project_or_404(db, project_id)

        image_data = await image.read(MAX_IMAGE_SIZE + 1)

        if not image_data:
            raise HTTPException(
                status_code=400,
                detail="The uploaded image is empty.",
            )

        if len(image_data) > MAX_IMAGE_SIZE:
            raise HTTPException(
                status_code=413,
                detail="Image size cannot exceed 5 MB.",
            )

        if content_type == "image/jpeg":
            valid_image = image_data.startswith(b"\xff\xd8\xff")
        elif content_type == "image/png":
            valid_image = image_data.startswith(b"\x89PNG\r\n\x1a\n")
        elif content_type == "image/webp":
            valid_image = image_data.startswith(b"RIFF") and image_data[8:12] == b"WEBP"
        else:
            valid_image = image_data.startswith((b"GIF87a", b"GIF89a"))

        if not valid_image:
            raise HTTPException(
                status_code=400,
                detail="The uploaded file does not appear to be a valid image.",
            )

        filename = f"{uuid.uuid4().hex}{ALLOWED_IMAGE_TYPES[content_type]}"
        file_path = UPLOAD_DIRECTORY / filename

        with file_path.open("wb") as uploaded_file:
            uploaded_file.write(image_data)

        return {
            "message": "Image uploaded successfully.",
            "image_url": f"http://127.0.0.1:8000/uploads/{filename}",
            "filename": filename,
        }

    finally:
        await image.close()
        db.close()


@app.post("/projects/{project_id}/analyze")
def analyze_saved_project(project_id: int):
    db = SessionLocal()

    try:
        project = get_project_or_404(db, project_id)

        project_data = {
            "id": project.id,
            "name": project.name,
            "document_type": project.document_type,
            "format_style": project.format_style,
            "author_name": project.author_name or "",
            "institution": project.institution or "",
            "department": project.department or "",
            "supervisor": project.supervisor or "",
        "template_file_path": project.template_file_path or "",
        "template_file_name": project.template_file_name or "",
            "problem_statement": project.problem_statement or "",
            "research_objectives": project.research_objectives or "",
            "research_notes": project.research_notes or "",
            "sections": load_json(project.document_sections, {}),
            "figures": load_json(project.document_figures, []),
            "tables": load_json(project.document_tables, []),
        }

        try:
            analysis = analyze_project(project_data)
        except ValueError as exc:
            raise HTTPException(
                status_code=502,
                detail=str(exc),
            ) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail="The AI analysis service is temporarily unavailable.",
            ) from exc

        return {
            "project_id": project.id,
            "project_name": project.name,
            "analysis": analysis,
        }

    finally:
        db.close()

@app.post("/projects/{project_id}/plan")
def plan_saved_document(project_id: int):
    db = SessionLocal()

    try:
        project = get_project_or_404(db, project_id)

        project_data = {
            "id": project.id,
            "name": project.name,
            "document_type": project.document_type,
            "format_style": project.format_style,
            "author_name": project.author_name or "",
            "institution": project.institution or "",
            "department": project.department or "",
            "supervisor": project.supervisor or "",
        "template_file_path": project.template_file_path or "",
        "template_file_name": project.template_file_name or "",
            "problem_statement": project.problem_statement or "",
            "research_objectives": project.research_objectives or "",
            "research_notes": project.research_notes or "",
            "sections": load_json(project.document_sections, {}),
            "figures": load_json(project.document_figures, []),
            "tables": load_json(project.document_tables, []),
        }

        try:
            plan = plan_document(project_data)

        except ValueError as exc:
            raise HTTPException(
                status_code=502,
                detail=str(exc),
            ) from exc

        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail="The AI document planning service is temporarily unavailable.",
            ) from exc

        return {
            "project_id": project.id,
            "project_name": project.name,
            "plan": plan,
        }

    finally:
        db.close()


@app.post("/projects/{project_id}/generate-full-document")
def generate_project_full_document(
    project_id: int,
    request: GenerateFullDocumentData,
):
    db = SessionLocal()

    try:
        project = get_project_or_404(db, project_id)

        if request.generation_mode not in ("fill_empty", "regenerate"):
            raise HTTPException(
                status_code=400,
                detail="Invalid generation mode.",
            )

        current_sections = load_json(
            project.document_sections,
            {},
        )

        if not isinstance(current_sections, dict):
            raise HTTPException(
                status_code=500,
                detail="Stored document sections have an invalid format.",
            )

        project_data = {
            "id": project.id,
            "name": project.name,
            "document_type": project.document_type,
            "format_style": project.format_style,
            "author_name": project.author_name or "",
            "institution": project.institution or "",
            "department": project.department or "",
            "supervisor": project.supervisor or "",
        "template_file_path": project.template_file_path or "",
        "template_file_name": project.template_file_name or "",
            "problem_statement": project.problem_statement or "",
            "research_objectives": project.research_objectives or "",
            "research_notes": project.research_notes or "",
            "sections": current_sections.copy(),
            "figures": load_json(project.document_figures, []),
            "tables": load_json(project.document_tables, []),
        }

        try:
            generation = generate_full_document(
                project_data=project_data,
                generation_mode=request.generation_mode,
            )

        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=str(exc),
            ) from exc

        except Exception as exc:
            print(
                f"[FULL DOCUMENT GENERATOR] Project {project_id} failed: {exc}"
            )
            raise HTTPException(
                status_code=502,
                detail="The AI full-document generation service is temporarily unavailable.",
            ) from exc

        generated_sections = generation.get("generated_sections", [])
        generated_content = {}
        protected_sections = []

        accepted_generated_sections = []

        for section in generated_sections:
            section_id = section.get("section_id")
            content = section.get("content")
            existing_key = section.get("existing_section_key")
            section_title = section.get("section_title") or section.get("title")

            if (
                isinstance(section_id, str)
                and section_id.strip()
                and isinstance(content, str)
                and content.strip()
            ):
                target_key = (
                    existing_key
                    if isinstance(existing_key, str)
                    and existing_key in current_sections
                    else (
                        section_title.strip()
                        if isinstance(section_title, str)
                        and section_title.strip()
                        else section_id
                    )
                )
                # Independently protect populated template sections at the API
                # boundary, even if the generator mistakenly returns them.
                if (
                    request.generation_mode == "fill_empty"
                    and target_key in current_sections
                    and isinstance(current_sections[target_key], str)
                    and current_sections[target_key].strip()
                ):
                    protected_sections.append({
                        "section_id": section_id,
                        "section_title": section_title or target_key,
                        "existing_section_key": target_key,
                        "skip_reason": (
                            "API safeguard: existing section already contains "
                            "content; it was not overwritten."
                        ),
                    })
                    continue

                generated_content[target_key] = content
                accepted_generated_sections.append(section)

        generated_sections = accepted_generated_sections

        # Run independent quality checks before saving.
        quality_reports = {}
        quality_audit_errors = {}

        for section in generated_sections:
            section_id = section.get("section_id")
            title = section.get("section_title", section.get("title", "Untitled"))
            content = section.get("content", "")

            if not section_id or not content:
                continue

            deterministic_findings = []
            deterministic_error = None
            ai_evaluation = None
            ai_error = None

            try:
                deterministic_findings = audit_generated_section(
                    content=content,
                    section_title=title,
                    project_data=project_data,
                )
            except Exception as audit_exc:
                deterministic_error = str(audit_exc)
                print(
                    f"[QUALITY AUDITOR] Deterministic audit failed "
                    f"for project {project_id}, section {section_id}: {audit_exc}"
                )

            combined_findings = list(deterministic_findings)

            try:
                ai_evaluation = evaluate_generated_section(
                    content=content,
                    section_title=title,
                    project_data=project_data,
                    deterministic_findings=deterministic_findings,
                )
                combined_findings.extend(ai_evaluation["findings"])

            except Exception as audit_exc:
                ai_error = str(audit_exc)
                print(
                    f"[QUALITY AUDITOR] AI evaluation failed "
                    f"for project {project_id}, section {section_id}: {audit_exc}"
                )

            quality_reports[section_id] = {
                "audit_status": (
                    "completed"
                    if ai_evaluation is not None and deterministic_error is None
                    else "partial"
                ),
                "deterministic_findings": deterministic_findings,
                "deterministic_audit_error": (
                    "Deterministic audit could not be completed."
                    if deterministic_error else None
                ),
                "ai_evaluation": ai_evaluation,
                "findings": combined_findings,
                "summary": summarize_quality_findings(combined_findings),
                "ai_audit_error": (
                    "AI evaluation could not be completed."
                    if ai_error else None
                ),
            }

        # Preserve existing sections and save only successfully generated content.
        updated_sections = current_sections.copy()
        updated_sections.update(generated_content)

        if generated_content:
            project.document_sections = json.dumps(
                updated_sections,
                ensure_ascii=False,
            )
            db.commit()

        return {
            "project_id": project.id,
            "project_name": project.name,
            "generation_complete": (
                generation.get("generation_complete", False)
                and not protected_sections
                and not generation.get("failed_sections", [])
            ),
            "generated_sections": generated_sections,
            "skipped_sections": (
                generation.get("skipped_sections", []) + protected_sections
            ),
            "failed_sections": generation.get("failed_sections", []),
            "all_sections": updated_sections,
            "evidence_findings": generation.get("evidence_findings", []),
            "quality_reports": quality_reports,
            "message": (
                "Full document generated and saved successfully."
                if generation.get("generation_complete")
                else "Full-document generation finished with some incomplete sections. Successfully generated sections were saved."
            ),
        }

    except HTTPException:
        db.rollback()
        raise

    except Exception as exc:
        db.rollback()
        print(f"[FULL DOCUMENT GENERATOR] Database error: {exc}")
        raise HTTPException(
            status_code=500,
            detail="Unable to save the generated document.",
        ) from exc

    finally:
        db.close()

@app.post("/projects/{project_id}/generate-section")
def generate_project_section(
    project_id: int,
    request: GenerateSectionData,
):
    db = SessionLocal()

    try:
        project = get_project_or_404(db, project_id)

        project_data = {
            "id": project.id,
            "name": project.name,
            "document_type": project.document_type,
            "format_style": project.format_style,
            "author_name": project.author_name or "",
            "institution": project.institution or "",
            "department": project.department or "",
            "supervisor": project.supervisor or "",
        "template_file_path": project.template_file_path or "",
        "template_file_name": project.template_file_name or "",
            "problem_statement": project.problem_statement or "",
            "research_objectives": project.research_objectives or "",
            "research_notes": project.research_notes or "",
            "sections": load_json(project.document_sections, {}),
            "figures": load_json(project.document_figures, []),
            "tables": load_json(project.document_tables, []),
        }

        section = request.section
        section_id = section.get("section_id", "").strip()

        if not section_id:
            raise HTTPException(
                status_code=400,
                detail="A valid section ID is required.",
            )

        try:
            generated = generate_document_section(
                project_data=project_data,
                section=section,
                document_plan=request.document_plan,
                previous_sections=request.previous_sections,
                generation_mode=request.generation_mode,
            )

        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=str(exc),
            ) from exc

        except Exception as exc:
            print(
                f"[SECTION GENERATOR] Project {project_id} failed: {exc}"
            )
            raise HTTPException(
                status_code=502,
                detail="The AI section-generation service is temporarily unavailable.",
            ) from exc

        current_sections = load_json(
            project.document_sections,
            {},
        )

        current_content = current_sections.get(section_id, "")

        if request.generation_mode == "fill_empty" and current_content.strip():
            raise HTTPException(
                status_code=409,
                detail="This section already contains content. Reload it before generating.",
            )

        if request.generation_mode == "regenerate" and not current_content.strip():
            raise HTTPException(
                status_code=409,
                detail="This section is now empty. Reload it before regenerating.",
            )

        # Run independent quality checks without modifying generated content.
        deterministic_audit_error = None

        try:
            deterministic_findings = audit_generated_section(
                content=generated["content"],
                section_title=generated["section_title"],
                project_data=project_data,
            )
        except Exception as audit_exc:
            deterministic_findings = []
            deterministic_audit_error = str(audit_exc)
            print(
                f"[QUALITY AUDITOR] Deterministic audit failed for "
                f"project {project_id}: {audit_exc}"
            )

        ai_evaluation = None
        ai_audit_error = None
        combined_findings = list(deterministic_findings)

        try:
            ai_evaluation = evaluate_generated_section(
                content=generated["content"],
                section_title=generated["section_title"],
                project_data=project_data,
                deterministic_findings=deterministic_findings,
            )

            combined_findings.extend(ai_evaluation["findings"])

        except Exception as audit_exc:
            ai_audit_error = str(audit_exc)
            print(
                f"[QUALITY AUDITOR] AI evaluation failed for "
                f"project {project_id}: {audit_exc}"
            )

        quality_summary = summarize_quality_findings(
            combined_findings
        )

        quality_audit = {
            "audit_status": (
                "completed" if ai_evaluation is not None and deterministic_audit_error is None
                else "partial"
            ),
            "deterministic_findings": deterministic_findings,
            "deterministic_audit_error": ("Deterministic audit could not be completed." if deterministic_audit_error else None),
            "ai_evaluation": ai_evaluation,
            "findings": combined_findings,
            "summary": quality_summary,
            "ai_audit_error": (
                "AI evaluation could not be completed."
                if ai_audit_error else None
            ),
        }

        current_sections[section_id] = generated["content"]

        project.document_sections = json.dumps(
            current_sections,
            ensure_ascii=False,
        )

        db.commit()

        return {
            "project_id": project.id,
            "section_id": section_id,
            "section_title": generated["section_title"],
            "content": generated["content"],
            "background_context": generated["background_context"],
            "information_gaps": generated["information_gaps"],
            "integrity_notes": generated["integrity_notes"],
            "quality_audit": quality_audit,
            "sections": current_sections,
            "message": "Document section generated and saved successfully.",
        }

    except HTTPException:
        db.rollback()
        raise

    except Exception as exc:
        db.rollback()
        print(f"[SECTION GENERATOR] Database error: {exc}")
        raise HTTPException(
            status_code=500,
            detail="Unable to save the generated document section.",
        ) from exc

    finally:
        db.close()






