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
    "document_tables": "TEXT DEFAULT '[]'",
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
    },
    "research_paper": {
        "ieee",
        "apa",
        "standard_academic",
    },
    "review_paper": {
        "ieee",
        "apa",
        "standard_academic",
    },
    "thesis": {
        "university_template",
        "standard_academic",
    },
    "academic_report": {
        "standard_academic",
        "apa",
    },
}


class ResearchData(BaseModel):
    problem_statement: str = ""
    research_objectives: str = ""
    research_notes: str = ""


class DocumentSectionsData(BaseModel):
    sections: dict[str, str] = Field(default_factory=dict)


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
):
    project_name = project_name.strip()
    author_name = author_name.strip()

    if not project_name:
        raise HTTPException(
            status_code=422,
            detail="Document title is required.",
        )

    if len(project_name) > 150:
        raise HTTPException(
            status_code=422,
            detail="Document titles cannot exceed 150 characters.",
        )

    if not author_name:
        raise HTTPException(
            status_code=422,
            detail="At least one author name is required.",
        )

    if document_type not in VALID_FORMATS:
        raise HTTPException(
            status_code=422,
            detail="Invalid document type.",
        )

    if format_style not in VALID_FORMATS[document_type]:
        raise HTTPException(
            status_code=422,
            detail="The selected formatting style is not valid for this document type.",
        )

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
        }

    except Exception:
        db.rollback()
        raise

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
            valid_image = (
                image_data.startswith(b"RIFF")
                and image_data[8:12] == b"WEBP"
            )
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

