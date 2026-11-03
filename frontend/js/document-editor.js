(() => {
    const API_BASE_URL = "http://127.0.0.1:8000";
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get("id");

    let sections = {};
    let project = {};
    let figures = [];
    let tables = [];
    let saving = false;
    let dirty = false;

    const elements = {};

    function initializeElements() {
        elements.title = document.getElementById("document-project-title");
        elements.meta = document.getElementById("document-project-meta");
        elements.status = document.getElementById("document-save-status");
        elements.saveButton = document.getElementById("save-document-btn");
        elements.exportButton = document.getElementById("export-document-pdf-btn");
        elements.preview = document.getElementById("document-preview");
        elements.outline = document.getElementById("document-outline-list");
        elements.count = document.getElementById("document-section-count");
        elements.back = document.getElementById("back-to-workspace");
    }

    async function apiRequest(url, options = {}) {
        const response = await fetch(url, options);

        if (!response.ok) {
            const message = await response.text();
            throw new Error(message || `Request failed (${response.status})`);
        }

        return response.json();
    }

    function setStatus(message, type = "info") {
        elements.status.textContent = message;
        elements.status.dataset.state = type;
    }

    function getProjectName(data) {
        return data.project_name || data.name || data.title || "Untitled Project";
    }

    function extractSections(data) {
        return data.sections || data.document_sections || data;
    }

    function normalizeSections(data) {
        const result = {};

        if (Array.isArray(data)) {
            for (const item of data) {
                if (item && item.name) {
                    result[item.name] = item.content || "";
                }
            }

            return result;
        }

        if (data && typeof data === "object") {
            for (const [name, content] of Object.entries(data)) {
                if (typeof content === "string") {
                    result[name] = content;
                } else if (content && typeof content === "object") {
                    result[name] = content.content || "";
                }
            }
        }

        return result;
    }

    function renderClassicDocument() {
        elements.preview.replaceChildren();
        elements.outline.replaceChildren();

        const sectionNames = Object.keys(sections);

        sectionNames.forEach((name, index) => {
            const sectionId = `document-section-${index}`;
            const card = document.createElement("article");
            card.className = "document-section-card";
            card.id = sectionId;

            const heading = document.createElement("h2");
            heading.className = "document-section-heading";
            heading.textContent = name;

            const editor = document.createElement("textarea");
            editor.className = "document-section-content";
            editor.value = sections[name];
            editor.dataset.section = name;
            editor.setAttribute("aria-label", `Edit ${name}`);
            editor.spellcheck = true;

            editor.addEventListener("input", () => {
                sections[name] = editor.value;
                dirty = true;
                setStatus("Unsaved changes", "warning");
            });

            card.append(heading, editor);
            elements.preview.appendChild(card);

            const link = document.createElement("a");
            link.className = "document-outline-link";
            link.href = `#${sectionId}`;
            link.textContent = name;
            elements.outline.appendChild(link);
        });
    }

    function renderDocument() {
        if (String(project.format_style || "").toLowerCase() === "ieee") {
            const renderer = window.ResearchForgeIEEERenderer;

            if (!renderer || typeof renderer.render !== "function") {
                throw new Error("The IEEE document renderer did not load.");
            }

            const result = renderer.render({
                preview: elements.preview,
                outline: elements.outline,
                project,
                sections,
                figures,
                tables,
                onInput: (name, value) => {
                    sections[name] = value;
                    dirty = true;
                    setStatus("Unsaved changes", "warning");
                }
            });

            elements.count.textContent =
                `${result.sectionCount} sections • ${figures.length} figures • ${tables.length} tables`;

            return;
        }

        renderClassicDocument();
        elements.count.textContent =
            `${Object.keys(sections).length} sections`;
    }

    async function loadDocument() {
        if (!projectId || !/^\d+$/.test(projectId)) {
            throw new Error("A valid project ID was not provided.");
        }

        const [projectResponse, sectionsResponse] = await Promise.all([
            apiRequest(`${API_BASE_URL}/projects/${projectId}/research`),
            apiRequest(`${API_BASE_URL}/projects/${projectId}/sections`)
        ]);

        project = projectResponse.project || projectResponse;

        sections = normalizeSections(extractSections(sectionsResponse));

        if (!Object.keys(sections).length && project.document_sections) {
            sections = normalizeSections(project.document_sections);
        }

        if (String(project.format_style || "").toLowerCase() === "ieee") {
            const [figureResponse, tableResponse] = await Promise.all([
                apiRequest(`${API_BASE_URL}/projects/${projectId}/figures`),
                apiRequest(`${API_BASE_URL}/projects/${projectId}/tables`)
            ]);

            figures = Array.isArray(figureResponse.figures)
                ? figureResponse.figures
                : [];

            tables = Array.isArray(tableResponse.tables)
                ? tableResponse.tables
                : [];
        }

        elements.title.textContent = getProjectName(project);

        const metadata = [
            project.document_type,
            project.format_style,
            project.author_name,
            project.institution
        ].filter(Boolean);

        elements.meta.textContent = metadata.join(" • ");
        elements.back.href = `workspace.html?id=${encodeURIComponent(projectId)}`;

        renderDocument();
        setStatus("All changes saved", "success");
    }

    async function saveDocument() {
        if (saving || !dirty) return;

        saving = true;
        elements.saveButton.disabled = true;
        setStatus("Saving document...", "info");

        const snapshot = { ...sections };

        try {
            await apiRequest(
                `${API_BASE_URL}/projects/${projectId}/sections`,
                {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ sections: snapshot })
                }
            );

            const changedDuringSave = Object.keys(sections).some(
                name => sections[name] !== snapshot[name]
            );

            dirty = changedDuringSave;

            setStatus(
                dirty ? "New edits remain unsaved" : "All changes saved",
                dirty ? "warning" : "success"
            );
        } catch (error) {
            console.error("Document save failed:", error);
            setStatus(error.message || "Unable to save document", "error");
        } finally {
            saving = false;
            elements.saveButton.disabled = false;
        }
    }

    function bindEvents() {
        elements.saveButton.addEventListener("click", saveDocument);

        elements.exportButton.addEventListener("click", async () => {
            if (saving) return;

            if (dirty) {
                await saveDocument();
            }

            if (dirty || saving) {
                setStatus("Save your changes successfully before exporting.", "error");
                return;
            }

            window.print();
        });

        window.addEventListener("beforeunload", event => {
            if (dirty || saving) {
                event.preventDefault();
                event.returnValue = "";
            }
        });

        window.addEventListener("keydown", event => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
                event.preventDefault();
                saveDocument();
            }
        });
    }

    document.addEventListener("DOMContentLoaded", async () => {
        initializeElements();
        bindEvents();

        try {
            await loadDocument();
        } catch (error) {
            console.error("Unable to load document:", error);
            elements.preview.replaceChildren();

            const message = document.createElement("div");
            message.className = "document-error";
            message.textContent = error.message || "Unable to load the document.";

            elements.preview.appendChild(message);
            setStatus("Document loading failed", "error");
        }
    });
})();

