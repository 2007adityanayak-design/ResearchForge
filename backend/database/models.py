from sqlalchemy import Column, Integer, String, Text
from database.database import Base


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    document_type = Column(
        String(50),
        nullable=False,
        default="project_report"
    )
    format_style = Column(
        String(50),
        nullable=False,
        default="standard_academic"
    )
    author_name = Column(String(300), nullable=False, default="")
    institution = Column(String(200), default="")
    department = Column(String(150), default="")
    supervisor = Column(String(200), default="")

    problem_statement = Column(Text, default="")
    research_objectives = Column(Text, default="")
    research_notes = Column(Text, default="")

    document_sections = Column(Text, default="{}")
    document_figures = Column(Text, default="[]")
    document_tables = Column(Text, default="[]")