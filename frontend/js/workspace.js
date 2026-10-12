console.log("ResearchForge workspace.js loaded");

const API_BASE_URL = "http://127.0.0.1:8000";
const REQUEST_TIMEOUT = 15000;
const AUTOSAVE_DELAY = 1500;
const RETRY_DELAY = 3000;
const MAX_RETRY_DELAY = 30000;

const projectName = document.getElementById("workspace-project-name");
const projectId = document.getElementById("workspace-project-id");
const workspaceError = document.getElementById("workspace-error");
const workspaceErrorMessage = document.getElementById("workspace-error-message");

const documentTypeElement = document.getElementById("workspace-document-type");
const formatStyleElement = document.getElementById("workspace-format-style");
const authorNameElement = document.getElementById("workspace-author-name");
const institutionElement = document.getElementById("workspace-institution");
const departmentElement = document.getElementById("workspace-department");
const supervisorElement = document.getElementById("workspace-supervisor");

const welcomeHeading = document.getElementById("workspace-welcome-heading");
const welcomeDescription = document.getElementById("workspace-welcome-description");
const documentLabel = document.getElementById("workspace-document-label");
const structureHeading = document.getElementById("document-structure-heading");
const structureDescription = document.getElementById("document-structure-description");

const documentSectionsContainer = document.getElementById("document-sections-container");
const sectionWorkspaceLayout = document.getElementById("document-section-workspace-layout");
const sectionSidebar = document.getElementById("document-section-sidebar");
const sectionSidebarList = document.getElementById("document-section-sidebar-list");
const sectionEditorContainer = document.getElementById("document-section-editor-container");

const figuresButton = document.getElementById("open-figures-btn");
const tablesButton = document.getElementById("open-tables-btn");
const figuresSummary = document.getElementById("figures-summary");
const tablesSummary = document.getElementById("tables-summary");
const existingMaterialSection = document.getElementById("existing-material-section");
const workspaceSaveStatus = document.getElementById("workspace-save-status");

let currentProjectId = null;
let currentDocumentType = null;

let documentSections = {};
let sectionSaveTimers = {};
let sectionRetryTimers = {};
let sectionSaving = {};
let sectionVersions = {};
let sectionSavedVersions = {};
let sectionSaveErrors = {};
let sectionRetryAttempts = {};
let sectionSavePromises = {};

let documentFigures = [];
let documentTables = [];

let currentSectionEditor = null;
let currentEditorElements = null;
let navigationInProgress = false;
let workspaceInitialized = false;
let workspaceLoading = false;
let workspaceLoadFailed = false;

const documentConfigurations = {
    project_report: {
        name: "Project Report",
        description: "Develop your project report section by section.",
        sections: [
            "Title Page",
            "Certificate",
            "Declaration",
            "Acknowledgements",
            "Abstract",
            "Table of Contents",
            "List of Tables",
            "Introduction",
            "Problem Statement",
            "Objectives",
            "Literature Review",
            "Methodology",
            "System Design and Architecture",
            "Implementation",
            "Results and Discussion",
            "Conclusion",
            "Future Scope",
            "References",
            "Appendices"
        ]
    },

    research_paper: {
        name: "Research Paper",
        description: "Develop a research paper using a structured academic format.",
        sections: [
            "Title and Authors",
            "Abstract",
            "Keywords",
            "Introduction",
            "Related Work",
            "Methodology",
            "Proposed Approach",
            "Experimental Setup",
            "Results and Discussion",
            "Conclusion",
            "References"
        ]
    },

    review_paper: {
        name: "Review Paper",
        description: "Organize existing research, compare findings, and identify research gaps.",
        sections: [
            "Title and Authors",
            "Abstract",
            "Keywords",
            "Introduction",
            "Review Scope and Methodology",
            "Literature Classification",
            "Comparative Analysis",
            "Research Gaps",
            "Challenges and Open Problems",
            "Future Research Directions",
            "Conclusion",
            "References"
        ]
    },

    thesis: {
        name: "Thesis / Dissertation",
        description: "Build a comprehensive academic thesis or dissertation.",
        sections: [
            "Title Page",
            "Certificate",
            "Declaration",
            "Acknowledgements",
            "Abstract",
            "Table of Contents",
            "List of Tables",
            "Introduction",
            "Literature Review",
            "Research Problem and Objectives",
            "Research Questions or Hypotheses",
            "Research Methodology",
            "Results and Analysis",
            "Discussion",
            "Conclusion",
            "Limitations",
            "Future Scope",
            "References",
            "Appendices"
        ]
    },

    academic_report: {
        name: "General Academic Report",
        description: "Organize your academic report into clear, structured sections.",
        sections: [
            "Title Page",
            "Abstract or Executive Summary",
            "Introduction",
            "Background",
            "Objectives",
            "Main Content",
            "Analysis and Discussion",
            "Conclusion",
            "Recommendations",
            "References",
            "Appendices"
        ]
    }
};

const formatNames = {
    college_template: "College Template",
    standard_academic: "Standard Academic",
    ieee: "IEEE",
    apa: "APA",
    university_template: "University Template"
};

document.addEventListener("DOMContentLoaded", initializeWorkspace);

window.addEventListener("online", handleConnectionRestored);

window.addEventListener("offline", () => {
    if (workspaceSaveStatus) {
        workspaceSaveStatus.textContent = "Offline — pending changes will retry automatically.";
    }

    updateCurrentEditorStatus(
        "Connection lost. Your changes are preserved in this browser.",
        "research-save-error"
    );
});

window.addEventListener("error", event => {
    console.error("ResearchForge workspace error:", event.error || event.message);
});

window.addEventListener("unhandledrejection", event => {
    console.error("ResearchForge unhandled promise rejection:", event.reason);
});

function initializeWorkspace() {
    if (workspaceInitialized) {
        return;
    }

    workspaceInitialized = true;

    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");

    if (!id || !/^\d+$/.test(id) || Number(id) < 1 || !Number.isSafeInteger(Number(id))) {
        showError("No valid document ID was provided. Open a document from your ResearchForge dashboard.");
        return;
    }

    currentProjectId = Number(id);

    if (tablesButton) {
        tablesButton.addEventListener("click", () => {
            if (!currentProjectId) {
                alert("No document is selected.");
                return;
            }

            window.location.href = `table-studio.html?id=${encodeURIComponent(currentProjectId)}`;
        });
    }
    loadResearch();
}

async function apiRequest(url, options = {}, timeout = REQUEST_TIMEOUT) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });

        const rawText = await response.text();
        let data = {};

        if (rawText) {
            try {
                data = JSON.parse(rawText);
            } catch {
                if (response.ok) {
                    throw new Error("The server returned an invalid response. Please try again.");
                }
            }
        }

        if (!response.ok) {
            const detail = typeof data.detail === "string"
                ? data.detail
                : Array.isArray(data.detail)
                    ? data.detail.map(item => item.msg || "Invalid request").join("; ")
                    : "";

            const error = new Error(detail || getHttpErrorMessage(response.status));
            error.status = response.status;
            throw error;
        }

        return data;
    } catch (error) {
        if (error.name === "AbortError") {
            throw new Error("The request timed out. Check your connection and try again.");
        }

        if (error instanceof TypeError) {
            throw new Error("Unable to connect to ResearchForge. Check that the backend is running.");
        }

        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

function getHttpErrorMessage(status) {
    const messages = {
        400: "The request was invalid. Check your input and try again.",
        401: "Authentication is required to complete this request.",
        403: "You do not have permission to complete this request.",
        404: "The requested document or resource could not be found.",
        408: "The server timed out while processing the request.",
        409: "The request conflicts with the current document state.",
        413: "The submitted content is too large.",
        422: "Some submitted information is invalid. Check your input.",
        429: "Too many requests were sent. Please wait and try again.",
        500: "A server error occurred. Please try again.",
        502: "The backend gateway returned an error.",
        503: "The backend is temporarily unavailable.",
        504: "The backend took too long to respond."
    };

    return messages[status] || `The request failed with status ${status}. Please try again.`;
}

async function loadResearch() {
    if (workspaceLoading || !currentProjectId) {
        return;
    }

    workspaceLoading = true;
    workspaceLoadFailed = false;

    if (workspaceSaveStatus) {
        workspaceSaveStatus.textContent = "Loading document...";
    }

    if (documentSectionsContainer) {
        documentSectionsContainer.hidden = false;
        documentSectionsContainer.replaceChildren();

        const message = document.createElement("p");
        message.textContent = "Loading document sections...";
        documentSectionsContainer.appendChild(message);
    }

    if (sectionWorkspaceLayout) {
        sectionWorkspaceLayout.hidden = true;
        sectionWorkspaceLayout.style.display = "none";
    }

    try {
        const data = await apiRequest(
            `${API_BASE_URL}/projects/${currentProjectId}/research`
        );

        if (!data || typeof data !== "object" || !data.project_id) {
            throw new Error("The server returned incomplete document information.");
        }

        if (Number(data.project_id) !== currentProjectId) {
            throw new Error("The returned document ID does not match the requested document.");
        }

        if (projectName) {
            projectName.textContent = data.project_name || "Untitled Document";
        }

        if (projectId) {
            projectId.textContent = `Document ID: ${data.project_id}`;
        }

        document.title = `${data.project_name || "Document"} | ResearchForge`;
        currentDocumentType = data.document_type;

        displayDocumentInformation(data);

        const conversionKey = `researchforge-conversion-${currentProjectId}`;

        if (
            existingMaterialSection &&
            sessionStorage.getItem(conversionKey) === "pending"
        ) {
            existingMaterialSection.hidden = false;
        }

        await loadDocumentSections(currentDocumentType);
        await loadFigures();
        await loadTables();

        workspaceLoadFailed = false;

        if (workspaceSaveStatus) {
            workspaceSaveStatus.textContent = "Document loaded";
        }
    } catch (error) {
        workspaceLoadFailed = true;
        console.error("Unable to load document:", error);

        showError(error.message || "Unable to load this document.");
    } finally {
        workspaceLoading = false;
    }
}

function displayDocumentInformation(data) {
    const configuration = documentConfigurations[data.document_type];

    if (documentTypeElement) {
        documentTypeElement.textContent = configuration
            ? configuration.name
            : "Unknown Document Type";
    }

    if (formatStyleElement) {
        formatStyleElement.textContent =
            formatNames[data.format_style] || data.format_style || "Not specified";
    }

    if (authorNameElement) {
        authorNameElement.textContent = data.author_name || "Not provided";
    }

    if (institutionElement) {
        institutionElement.textContent = data.institution || "Not provided";
    }

    if (departmentElement) {
        departmentElement.textContent = data.department || "Not provided";
    }

    if (supervisorElement) {
        supervisorElement.textContent = data.supervisor || "Not provided";
    }

    if (documentLabel) {
        documentLabel.textContent = configuration
            ? `${configuration.name.toUpperCase()} WORKSPACE`
            : "DOCUMENT WORKSPACE";
    }

    if (welcomeHeading) {
        welcomeHeading.textContent = configuration
            ? `Your ${configuration.name} workspace`
            : "Your document workspace";
    }

    if (welcomeDescription) {
        welcomeDescription.textContent = configuration
            ? configuration.description
            : "Organize and develop your academic document.";
    }
}

async function loadDocumentSections(documentType) {
    const configuration = documentConfigurations[documentType];

    if (!configuration) {
        throw new Error("The structure for this document type is unavailable.");
    }

    const data = await apiRequest(
        `${API_BASE_URL}/projects/${currentProjectId}/sections`
    );

    if (!data || typeof data.sections !== "object" || Array.isArray(data.sections) || data.sections === null) {
        throw new Error("The server returned invalid document sections.");
    }

    const savedSections = data.sections;
    const recovery = loadLocalRecovery();

    documentSections = { ...savedSections };

    sectionVersions = {};
    sectionSavedVersions = {};
    sectionSaveErrors = {};
    sectionSaving = {};
    sectionSaveTimers = {};
    sectionRetryTimers = {};
    sectionRetryAttempts = {};
    sectionSavePromises = {};

    configuration.sections.forEach(section => {
        if (typeof documentSections[section] !== "string") {
            documentSections[section] = "";
        }

        sectionVersions[section] = 0;
        sectionSavedVersions[section] = 0;
        sectionSaving[section] = false;
        sectionRetryAttempts[section] = 0;
    });

    if (recovery && recovery.sections) {
        Object.entries(recovery.sections).forEach(([section, content]) => {
            if (
                configuration.sections.includes(section) &&
                typeof content === "string" &&
                content !== documentSections[section]
            ) {
                documentSections[section] = content;
                sectionVersions[section] = 1;
                sectionSavedVersions[section] = 0;
                sectionSaveErrors[section] = true;
            }
        });
    }

    renderSectionSidebar(configuration.sections);
    displayDocumentStructure(documentType);

    const recoveredSections = Object.keys(sectionSaveErrors);

    if (recoveredSections.length && workspaceSaveStatus) {
        workspaceSaveStatus.textContent =
            `Recovered unsaved changes in ${recoveredSections.length} section(s). Saving...`;
    }

    recoveredSections.forEach(section => {
        scheduleSectionRetry(section);
    });
}

function getRecoveryStorageKey() {
    return `researchforge-unsaved-${currentProjectId}`;
}

function loadLocalRecovery() {
    if (!currentProjectId) {
        return null;
    }

    try {
        const raw = localStorage.getItem(getRecoveryStorageKey());

        if (!raw) {
            return null;
        }

        const data = JSON.parse(raw);

        if (!data || typeof data.sections !== "object" || Array.isArray(data.sections)) {
            return null;
        }

        return data;
    } catch (error) {
        console.error("Unable to read local recovery data:", error);
        return null;
    }
}

function saveLocalRecovery() {
    if (!currentProjectId) {
        return false;
    }

    const unsavedSections = {};

    Object.keys(documentSections).forEach(section => {
        const isUnsaved =
            (sectionVersions[section] || 0) !==
            (sectionSavedVersions[section] || 0);

        if (isUnsaved || sectionSaveErrors[section]) {
            unsavedSections[section] = documentSections[section];
        }
    });

    const key = getRecoveryStorageKey();

    try {
        if (Object.keys(unsavedSections).length === 0) {
            localStorage.removeItem(key);
            return true;
        }

        localStorage.setItem(
            key,
            JSON.stringify({
                projectId: currentProjectId,
                updatedAt: new Date().toISOString(),
                sections: unsavedSections
            })
        );

        return true;
    } catch (error) {
        console.error("Unable to preserve unsaved changes:", error);

        if (workspaceSaveStatus) {
            workspaceSaveStatus.textContent =
                "Warning: browser recovery storage is unavailable.";
        }

        return false;
    }
}

function clearLocalRecoveryIfSaved() {
    if (!currentProjectId) {
        return;
    }

    const hasUnsaved = Object.keys(documentSections).some(section =>
        (sectionVersions[section] || 0) !==
        (sectionSavedVersions[section] || 0) ||
        Boolean(sectionSaveErrors[section])
    );

    if (!hasUnsaved) {
        try {
            localStorage.removeItem(getRecoveryStorageKey());
        } catch (error) {
            console.error("Unable to clear recovery data:", error);
        }
    } else {
        saveLocalRecovery();
    }
}

function hasUnsavedChanges() {
    return Object.keys(documentSections).some(section =>
        (sectionVersions[section] || 0) !==
        (sectionSavedVersions[section] || 0) ||
        Boolean(sectionSaveErrors[section])
    );
}

function renderSectionSidebar(allSections) {
    if (!sectionSidebarList) {
        return;
    }

    sectionSidebarList.replaceChildren();

    allSections.forEach((section, index) => {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "document-section-sidebar-item";
        button.dataset.section = section;
        button.setAttribute("aria-label", `Open section ${section}`);

        const number = document.createElement("span");
        number.className = "document-section-sidebar-number";
        number.textContent = String(index + 1).padStart(2, "0");

        const titleContainer = document.createElement("span");
        titleContainer.className = "document-section-sidebar-title";

        const title = document.createElement("span");
        title.textContent = section;

        const status = document.createElement("span");
        status.className = "document-section-sidebar-status";
        status.dataset.statusSection = section;

        titleContainer.append(title, status);
        button.append(number, titleContainer);

        button.addEventListener("click", async () => {
            if (navigationInProgress || section === currentSectionEditor) {
                return;
            }

            await navigateToSection(section);
        });

        sectionSidebarList.appendChild(button);
    });

    updateSidebarContentIndicators();
    updateActiveSidebarSection();
}

function updateSidebarContentIndicators() {
    if (!sectionSidebarList) {
        return;
    }

    sectionSidebarList.querySelectorAll("[data-status-section]").forEach(status => {
        const section = status.dataset.statusSection;
        const hasContent = Boolean((documentSections[section] || "").trim());

        status.textContent = hasContent ? "Content added" : "Empty";
        status.classList.toggle("has-content", hasContent);
    });
}

function updateActiveSidebarSection() {
    if (!sectionSidebarList) {
        return;
    }

    sectionSidebarList
        .querySelectorAll(".document-section-sidebar-item")
        .forEach(button => {
            const isActive = button.dataset.section === currentSectionEditor;

            button.classList.toggle("is-active", isActive);

            if (isActive) {
                button.setAttribute("aria-current", "step");
            } else {
                button.removeAttribute("aria-current");
            }
        });
}

function displayDocumentStructure(documentType) {
    console.trace("ALL SECTIONS VIEW TRIGGERED");
    if (window.figureUploadInProgress) {
        return;
    }
    if (!documentSectionsContainer || !sectionWorkspaceLayout) {
        return;
    }

    const configuration = documentConfigurations[documentType];

    documentSectionsContainer.replaceChildren();
    documentSectionsContainer.hidden = false;
    documentSectionsContainer.style.display = "";
    sectionWorkspaceLayout.hidden = true;
    sectionWorkspaceLayout.style.display = "none";

    if (structureHeading) {
        structureHeading.hidden = false;
    }

    if (structureDescription) {
        structureDescription.hidden = false;
    }

    currentSectionEditor = null;
    currentEditorElements = null;
    navigationInProgress = false;

    updateActiveSidebarSection();

    if (!configuration) {
        if (structureHeading) {
            structureHeading.textContent = "Document Structure";
        }

        if (structureDescription) {
            structureDescription.textContent =
                "The structure for this document type is unavailable.";
        }

        const message = document.createElement("p");
        message.textContent =
            "Please check the document type saved in the database.";

        documentSectionsContainer.appendChild(message);
        return;
    }

    if (structureHeading) {
        structureHeading.textContent = `${configuration.name} Sections`;
    }

    if (structureDescription) {
        structureDescription.textContent =
            "Select a section card to open its editor.";
    }

    const grid = document.createElement("div");
    grid.className = "document-section-grid";

    configuration.sections.forEach((section, index) => {
        const content = documentSections[section] || "";
        const hasContent = content.trim().length > 0;

        const card = document.createElement("button");
        card.type = "button";
        card.className = "document-section-card";
        card.dataset.section = section;
        card.setAttribute("aria-label", `Edit ${section}`);

        const number = document.createElement("span");
        number.className = "document-section-number";
        number.textContent = String(index + 1).padStart(2, "0");

        const title = document.createElement("h3");
        title.className = "document-section-title";
        title.textContent = section;

        const preview = document.createElement("p");
        preview.className = "document-section-preview";
        preview.textContent = hasContent
            ? getSectionPreview(content)
            : "No content added yet.";

        const status = document.createElement("span");
        status.className = hasContent
            ? "document-section-status research-save-success"
            : "document-section-status";
        status.textContent = hasContent ? "Content added" : "Not written yet";

        const action = document.createElement("span");
        action.className = "document-section-open";
        action.textContent = "Open editor →";

        card.append(number, title, preview, status, action);

        card.addEventListener("click", () => {
            openSectionEditor(section, configuration.sections);
        });

        grid.appendChild(card);
    });

    documentSectionsContainer.appendChild(grid);
}

function getSectionPreview(content) {
    const normalized = content.trim().replace(/\s+/g, " ");

    return normalized.length > 110
        ? `${normalized.slice(0, 110)}…`
        : normalized;
}

function openSectionEditor(section, allSections) {
    if (!sectionWorkspaceLayout || !sectionEditorContainer) {
        return;
    }

    if (!allSections.includes(section)) {
        showWorkspaceNotice("This section is not part of the current document structure.");
        return;
    }

    if (currentSectionEditor && currentSectionEditor !== section && hasUnsavedChanges()) {
        showWorkspaceNotice("Save your current changes before opening another section.");
        return;
    }

    clearTimeout(sectionSaveTimers[section]);

    currentSectionEditor = section;

    documentSectionsContainer.hidden = true;
    documentSectionsContainer.style.display = "none";
    sectionWorkspaceLayout.hidden = false;
    sectionWorkspaceLayout.style.display = "grid";

    if (structureHeading) {
        structureHeading.hidden = true;
    }

    if (structureDescription) {
        structureDescription.hidden = true;
    }

    sectionEditorContainer.replaceChildren();

    const editorView = document.createElement("div");
    editorView.className = "document-section-editor-view";

    const toolbar = document.createElement("div");
    toolbar.className = "document-section-editor-toolbar";

    const backButton = document.createElement("button");
    backButton.type = "button";
    backButton.className = "workspace-action-btn";
    backButton.textContent = "← All Sections";
    backButton.addEventListener("click", closeSectionEditor);

    const counter = document.createElement("span");
    counter.className = "document-section-counter";

    const index = allSections.indexOf(section);
    counter.textContent = `Section ${index + 1} of ${allSections.length}`;

    toolbar.append(backButton, counter);

    const title = document.createElement("h2");
    title.className = "document-section-editor-title";
    title.textContent = section;

    const description = document.createElement("p");
    description.className = "document-section-editor-description";
    description.textContent =
        `Write and edit the content for ${section.toLowerCase()}. Your changes will save automatically.`;

    const editor = document.createElement("textarea");
    editor.className = "document-section-editor";
    editor.dataset.section = section;
    editor.value = documentSections[section] || "";
    editor.placeholder = `Start writing your ${section.toLowerCase()} here...`;
    editor.rows = 18;
    editor.setAttribute("aria-label", `${section} content`);

    const footer = document.createElement("div");
    footer.className = "document-section-editor-footer";

    const wordCounter = document.createElement("span");
    wordCounter.className = "document-section-word-counter";

    const saveStatus = document.createElement("p");
    saveStatus.className = "document-section-status";
    saveStatus.setAttribute("role", "status");
    saveStatus.setAttribute("aria-live", "polite");

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "workspace-action-btn";
    saveButton.textContent = "Save Section";

    const updateWordCounter = () => {
        const text = editor.value.trim();
        const words = text ? text.split(/\s+/).length : 0;

        wordCounter.textContent =
            `${words} words · ${editor.value.length} characters`;
    };

    const updateSaveStatus = () => {
        if (sectionSaving[section]) {
            saveStatus.textContent = "Saving your changes...";
            saveStatus.className =
                "document-section-status research-save-warning";
            return;
        }

        if (sectionSaveErrors[section]) {
            saveStatus.textContent =
                "Changes are preserved locally. Retrying automatically...";
            saveStatus.className =
                "document-section-status research-save-error";
            return;
        }

        const saved =
            (sectionVersions[section] || 0) ===
            (sectionSavedVersions[section] || 0);

        if (saved) {
            saveStatus.textContent = "All changes saved ✓";
            saveStatus.className =
                "document-section-status research-save-success";
        } else {
            saveStatus.textContent = "Unsaved changes";
            saveStatus.className =
                "document-section-status research-save-warning";
        }
    };

    updateWordCounter();
    updateSaveStatus();

    editor.addEventListener("input", () => {
        documentSections[section] = editor.value;
        sectionVersions[section] = (sectionVersions[section] || 0) + 1;

        delete sectionSaveErrors[section];
        sectionRetryAttempts[section] = 0;

        clearTimeout(sectionRetryTimers[section]);
        delete sectionRetryTimers[section];

        saveLocalRecovery();
        updateWordCounter();
        updateSaveStatus();
        updateSidebarContentIndicators();

        if (workspaceSaveStatus) {
            workspaceSaveStatus.textContent = "Unsaved changes";
        }

        clearTimeout(sectionSaveTimers[section]);

        sectionSaveTimers[section] = setTimeout(() => {
            saveDocumentSection(section, editor, saveStatus);
        }, AUTOSAVE_DELAY);
    });

    saveButton.addEventListener("click", async () => {
        saveButton.disabled = true;

        try {
            await saveSectionAndWait(section, editor, saveStatus);
        } catch (error) {
            console.error("Manual section save failed:", error);
            showWorkspaceNotice(error.message || "Unable to save this section.");
        } finally {
            saveButton.disabled = false;
            updateSaveStatus();
        }
    });

    footer.append(wordCounter, saveStatus, saveButton);

    const navigation = document.createElement("div");
    navigation.className = "document-section-navigation";

    const navigationGroup = document.createElement("div");
    navigationGroup.className = "document-section-navigation-group";

    const previousButton = document.createElement("button");
    previousButton.type = "button";
    previousButton.textContent = "← Previous Section";
    previousButton.disabled = index === 0;

    previousButton.addEventListener("click", async () => {
        if (index > 0) {
            await navigateToSection(allSections[index - 1]);
        }
    });

    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className = "document-section-next";
    nextButton.textContent = "Next Section →";
    nextButton.disabled = index === allSections.length - 1;

    nextButton.addEventListener("click", async () => {
        if (index < allSections.length - 1) {
            await navigateToSection(allSections[index + 1]);
        }
    });

    navigationGroup.append(previousButton, nextButton);
    navigation.appendChild(navigationGroup);

    editorView.append(
        toolbar,
        title,
        description,
        editor,
        footer,
        navigation
    );

    sectionEditorContainer.appendChild(editorView);

    currentEditorElements = {
        editor,
        saveStatus,
        saveButton,
        backButton,
        navigationButtons: [previousButton, nextButton],
        updateSaveStatus
    };

    updateActiveSidebarSection();
    updateSidebarContentIndicators();

    editor.focus();
}

async function navigateToSection(targetSection) {
    const configuration = documentConfigurations[currentDocumentType];

    if (
        !configuration ||
        !configuration.sections.includes(targetSection) ||
        navigationInProgress
    ) {
        return false;
    }

    if (targetSection === currentSectionEditor) {
        return true;
    }

    if (!currentSectionEditor || !currentEditorElements) {
        openSectionEditor(targetSection, configuration.sections);
        return true;
    }

    navigationInProgress = true;

    const sourceSection = currentSectionEditor;
    const { editor, saveStatus, saveButton, backButton, navigationButtons } =
        currentEditorElements;

    saveButton.disabled = true;
    backButton.disabled = true;

    navigationButtons.forEach(button => {
        button.disabled = true;
    });

    if (sectionSidebarList) {
        sectionSidebarList.querySelectorAll("button").forEach(button => {
            button.disabled = true;
        });
    }

    try {
        const saved = await saveSectionAndWait(
            sourceSection,
            editor,
            saveStatus
        );

        if (!saved) {
            showWorkspaceNotice(
                "Your changes have not reached the server yet. They are preserved in this browser. Navigation is paused to prevent data loss."
            );
            return false;
        }

        openSectionEditor(targetSection, configuration.sections);
        return true;
    } catch (error) {
        console.error("Section navigation failed:", error);
        showWorkspaceNotice(error.message || "Unable to change sections.");
        return false;
    } finally {
        navigationInProgress = false;

        if (currentEditorElements) {
            currentEditorElements.saveButton.disabled = false;
            currentEditorElements.backButton.disabled = false;

            const newIndex = configuration.sections.indexOf(currentSectionEditor);

            currentEditorElements.navigationButtons[0].disabled = newIndex === 0;
            currentEditorElements.navigationButtons[1].disabled =
                newIndex === configuration.sections.length - 1;
        }

        if (sectionSidebarList) {
            sectionSidebarList.querySelectorAll("button").forEach(button => {
                button.disabled = false;
            });
        }
    }
}

async function closeSectionEditor() {
    if (
        navigationInProgress ||
        !currentSectionEditor ||
        !currentEditorElements
    ) {
        return;
    }

    navigationInProgress = true;

    const section = currentSectionEditor;
    const { editor, saveStatus, saveButton, backButton, navigationButtons } =
        currentEditorElements;

    saveButton.disabled = true;
    backButton.disabled = true;

    navigationButtons.forEach(button => {
        button.disabled = true;
    });

    try {
        const saved = await saveSectionAndWait(section, editor, saveStatus);

        if (!saved) {
            showWorkspaceNotice(
                "Unable to return to all sections because saving failed. Your changes remain in this browser. Try again when the backend is available."
            );
            return;
        }

        displayDocumentStructure(currentDocumentType);
    } catch (error) {
        console.error("Unable to close section editor:", error);
        showWorkspaceNotice(error.message || "Unable to close the editor.");
    } finally {
        navigationInProgress = false;

        if (currentEditorElements) {
            currentEditorElements.saveButton.disabled = false;
            currentEditorElements.backButton.disabled = false;

            const configuration = documentConfigurations[currentDocumentType];
            const index = configuration.sections.indexOf(currentSectionEditor);

            currentEditorElements.navigationButtons[0].disabled = index === 0;
            currentEditorElements.navigationButtons[1].disabled =
                index === configuration.sections.length - 1;
        }
    }
}

async function saveSectionAndWait(section, editor, statusElement) {
    if (!editor || !currentProjectId) {
        return false;
    }

    clearTimeout(sectionSaveTimers[section]);
    delete sectionSaveTimers[section];

    if (
        (sectionVersions[section] || 0) ===
        (sectionSavedVersions[section] || 0) &&
        !sectionSaveErrors[section]
    ) {
        return true;
    }

    return saveDocumentSection(section, editor, statusElement);
}

async function saveDocumentSection(section, editor, statusElement) {
    clearTimeout(sectionSaveTimers[section]);
    delete sectionSaveTimers[section];

    if (!currentProjectId || !editor) {
        return false;
    }

    if (sectionSaving[section]) {
        const pendingSave = sectionSavePromises[section];

        if (pendingSave) {
            await pendingSave;
        }

        if (
            (sectionVersions[section] || 0) !==
            (sectionSavedVersions[section] || 0) ||
            sectionSaveErrors[section]
        ) {
            return saveDocumentSection(section, editor, statusElement);
        }

        return true;
    }

    clearTimeout(sectionRetryTimers[section]);
    delete sectionRetryTimers[section];

    const versionBeingSaved = sectionVersions[section] || 0;
    const contentBeingSaved = editor.value;

    sectionSaving[section] = true;
    delete sectionSaveErrors[section];

    if (statusElement) {
        statusElement.textContent = "Saving your changes...";
        statusElement.className =
            "document-section-status research-save-warning";
    }

    if (workspaceSaveStatus) {
        workspaceSaveStatus.textContent = `Saving ${section}...`;
    }

    const savePromise = (async () => {
        let savedSuccessfully = false;

        try {
            await apiRequest(
                `${API_BASE_URL}/projects/${currentProjectId}/sections`,
                {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        sections: {
                            [section]: contentBeingSaved
                        }
                    })
                }
            );

            sectionSavedVersions[section] = versionBeingSaved;
            sectionRetryAttempts[section] = 0;
            savedSuccessfully = true;
        } catch (error) {
            sectionSaveErrors[section] = true;

            console.error(`Unable to save section "${section}":`, error);

            if (statusElement) {
                statusElement.textContent =
                    "Save unsuccessful. Your changes are preserved locally. Retrying automatically...";
                statusElement.className =
                    "document-section-status research-save-error";
            }

            if (workspaceSaveStatus) {
                workspaceSaveStatus.textContent =
                    "Save unsuccessful — retrying automatically...";
            }
        } finally {
            sectionSaving[section] = false;
            delete sectionSavePromises[section];
        }

        const moreChangesExist =
            (sectionVersions[section] || 0) !==
            (sectionSavedVersions[section] || 0);

        if (savedSuccessfully && moreChangesExist) {
            return saveDocumentSection(section, editor, statusElement);
        }

        if (savedSuccessfully) {
            delete sectionSaveErrors[section];

            if (statusElement) {
                statusElement.textContent = "All changes saved ✓";
                statusElement.className =
                    "document-section-status research-save-success";
            }

            if (workspaceSaveStatus) {
                workspaceSaveStatus.textContent = "All changes saved ✓";
            }

            clearLocalRecoveryIfSaved();
            return true;
        }

        saveLocalRecovery();
        scheduleSectionRetry(section, editor, statusElement);

        return false;
    })();

    sectionSavePromises[section] = savePromise;

    return savePromise;
}

function scheduleSectionRetry(section, editor = null, statusElement = null) {
    if (!currentProjectId) {
        return;
    }

    if (
        sectionRetryTimers[section] ||
        (
            !sectionSaveErrors[section] &&
            (sectionVersions[section] || 0) ===
            (sectionSavedVersions[section] || 0)
        )
    ) {
        return;
    }

    const attempt = sectionRetryAttempts[section] || 0;
    const delay = Math.min(
        RETRY_DELAY * Math.pow(2, Math.min(attempt, 4)),
        MAX_RETRY_DELAY
    );

    sectionRetryAttempts[section] = attempt + 1;

    if (workspaceSaveStatus) {
        workspaceSaveStatus.textContent =
            `Changes pending — next save attempt in ${Math.ceil(delay / 1000)} seconds.`;
    }

    sectionRetryTimers[section] = setTimeout(async () => {
        delete sectionRetryTimers[section];

        if (
            !currentProjectId ||
            (
                !sectionSaveErrors[section] &&
                (sectionVersions[section] || 0) ===
                (sectionSavedVersions[section] || 0)
            )
        ) {
            return;
        }

        let activeEditor = editor;
        let activeStatus = statusElement;

        if (!activeEditor || !activeEditor.isConnected) {
            const current = currentEditorElements;

            if (
                currentSectionEditor === section &&
                current &&
                current.editor &&
                current.editor.isConnected
            ) {
                activeEditor = current.editor;
                activeStatus = current.saveStatus;
            }
        }

        if (activeEditor && activeEditor.isConnected) {
            await saveDocumentSection(section, activeEditor, activeStatus);
            return;
        }

        await retrySaveUsingStoredContent(section);
    }, delay);
}

async function retrySaveUsingStoredContent(section) {
    if (
        !currentProjectId ||
        (
            !sectionSaveErrors[section] &&
            (sectionVersions[section] || 0) ===
            (sectionSavedVersions[section] || 0)
        )
    ) {
        return;
    }

    const content = documentSections[section];

    try {
        await apiRequest(
            `${API_BASE_URL}/projects/${currentProjectId}/sections`,
            {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    sections: {
                        [section]: content
                    }
                })
            }
        );

        sectionSavedVersions[section] = sectionVersions[section] || 0;
        delete sectionSaveErrors[section];
        sectionRetryAttempts[section] = 0;

        clearLocalRecoveryIfSaved();

        if (workspaceSaveStatus) {
            workspaceSaveStatus.textContent = "All changes saved ✓";
        }
    } catch (error) {
        sectionSaveErrors[section] = true;

        console.error(`Automatic retry failed for "${section}":`, error);

        saveLocalRecovery();
        scheduleSectionRetry(section);
    }
}

function waitForSectionSave(section) {
    return new Promise(resolve => {
        const check = () => {
            if (!sectionSaving[section]) {
                resolve(!sectionSaveErrors[section]);
                return;
            }

            setTimeout(check, 50);
        };

        check();
    });
}

async function handleConnectionRestored() {
    if (!currentProjectId) {
        return;
    }

    if (workspaceSaveStatus) {
        workspaceSaveStatus.textContent =
            "Connection restored — checking pending changes...";
    }

    Object.keys(sectionSaveErrors).forEach(section => {
        clearTimeout(sectionRetryTimers[section]);
        delete sectionRetryTimers[section];
        sectionRetryAttempts[section] = 0;

        const current = currentEditorElements;

        if (
            currentSectionEditor === section &&
            current &&
            current.editor &&
            current.editor.isConnected
        ) {
            saveDocumentSection(section, current.editor, current.saveStatus);
        } else {
            scheduleSectionRetry(section);
        }
    });

    if (workspaceLoadFailed) {
        await loadResearch();
    }
}

function updateCurrentEditorStatus(message, className) {
    if (!currentEditorElements || !currentEditorElements.saveStatus) {
        return;
    }

    currentEditorElements.saveStatus.textContent = message;
    currentEditorElements.saveStatus.className =
        `document-section-status ${className}`;
}

function showWorkspaceNotice(message) {
    console.warn("ResearchForge:", message);

    if (workspaceSaveStatus) {
        workspaceSaveStatus.textContent = message;
    }
}

async function loadFigures() {
    try {
        const data = await apiRequest(
            `${API_BASE_URL}/projects/${currentProjectId}/figures`
        );

        if (!data || !Array.isArray(data.figures)) {
            throw new Error("The server returned invalid figure data.");
        }

        documentFigures = data.figures.filter(
            figure => figure && typeof figure === "object" && !Array.isArray(figure)
        );

        updateFiguresSummary();
    } catch (error) {
        console.error("Unable to load figures:", error);

        if (figuresSummary) {
            figuresSummary.textContent = "Unable to load figures. Please retry.";
        }
    }
}

async function loadTables() {
    try {
        const data = await apiRequest(
            `${API_BASE_URL}/projects/${currentProjectId}/tables`
        );

        if (!data || !Array.isArray(data.tables)) {
            throw new Error("The server returned invalid table data.");
        }

        documentTables = data.tables.filter(
            table => table && typeof table === "object" && !Array.isArray(table)
        );

        updateTablesSummary();
    } catch (error) {
        console.error("Unable to load tables:", error);

        if (tablesSummary) {
            tablesSummary.textContent = "Unable to load tables. Please retry.";
        }
    }
}

function updateFiguresSummary() {
    if (!figuresSummary) {
        return;
    }

    figuresSummary.textContent = documentFigures.length
        ? `${documentFigures.length} figure${documentFigures.length === 1 ? "" : "s"} added.`
        : "No figures added yet.";
}

function updateTablesSummary() {
    if (!tablesSummary) {
        return;
    }

    tablesSummary.textContent = documentTables.length
        ? `${documentTables.length} table${documentTables.length === 1 ? "" : "s"} added.`
        : "No tables added yet.";
}

async function manageFigures() {
    if (!currentProjectId || workspaceLoading) {
        showWorkspaceNotice("The document is not ready. Please wait and try again.");
        return;
    }

    const action = prompt(
        "Figure Manager\n\n1. Add a figure\n2. View figures\n3. Delete a figure\n\nEnter 1, 2, or 3:"
    );

    if (action === null) {
        return;
    }

    if (action === "1") {
        const caption = prompt("Enter the figure caption:");

        if (caption === null || !caption.trim()) {
            return;
        }

        const imageUrl = prompt(
            "Enter an image URL if available, or leave blank to add it later:"
        );

        if (imageUrl === null) {
            return;
        }

        const section = prompt(
            `Enter the document section for this figure:\n\n${getSectionNames().join("\n")}`
        );

        if (section === null) {
            return;
        }

        documentFigures.push({
            id: createItemId(),
            caption: caption.trim(),
            image_url: imageUrl.trim(),
            section: isValidSection(section.trim()) ? section.trim() : ""
        });

        await saveFigures();
        return;
    }

    if (action === "2") {
        alert(
            documentFigures.length
                ? documentFigures
                    .map(
                        (figure, index) =>
                            `${index + 1}. ${figure.caption || "Untitled figure"}\nSection: ${figure.section || "Not assigned"}`
                    )
                    .join("\n\n")
                : "No figures have been added."
        );

        return;
    }

    if (action === "3") {
        if (!documentFigures.length) {
            alert("There are no figures to delete.");
            return;
        }

        const index = prompt(
            `Enter the number of the figure to delete:\n\n${documentFigures.map((figure, i) => `${i + 1}. ${figure.caption || "Untitled figure"}`).join("\n")}`
        );

        if (index === null || !index.trim()) {
            return;
        }

        const figureIndex = Number(index) - 1;

        if (
            !Number.isInteger(figureIndex) ||
            figureIndex < 0 ||
            figureIndex >= documentFigures.length
        ) {
            alert("Please enter a valid figure number.");
            return;
        }

        if (!confirm("Are you sure you want to delete this figure?")) {
            return;
        }

        const previousFigures = [...documentFigures];
        documentFigures.splice(figureIndex, 1);

        const saved = await saveFigures();

        if (!saved) {
            documentFigures = previousFigures;
            updateFiguresSummary();
        }
    } else {
        alert("Invalid choice. Enter 1, 2, or 3.");
    }
}

function manageTables() {
    const container = document.getElementById("tables-manager-container");

    if (!container) {
        return;
    }

    if (container.style.display === "block") {
        container.style.display = "none";
        return;
    }

    container.style.display = "block";

    const escapeHTML = value =>
        String(value ?? "").replace(/[&<>"']/g, character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[character]);

    const sections = getSectionNames();

    let draftRows = [
        ["Column 1", "Column 2", "Column 3"],
        ["", "", ""],
        ["", "", ""]
    ];

    let editingTableId = null;

    container.innerHTML = `
        <div class="table-manager-panel">
            <div class="table-manager-header">
                <div>
                    <h3>Table Studio</h3>
                    <p>Create, preview, and organize research tables.</p>
                </div>
                <button type="button" class="table-manager-close" id="close-table-manager">×</button>
            </div>

            <div class="table-manager-layout">
                <div class="table-manager-form">
                    <h3>Create Your Table</h3>

                    <div class="table-manager-field">
                        <label for="table-description">Describe Your Table</label>
                        <textarea id="table-description" placeholder="Describe the data, columns, and information your table should contain..." rows="4"></textarea>
                        <small>AI table generation will be connected in a later step.</small>
                    </div>

                    <div class="table-manager-field">
                        <label for="table-caption">Table Caption</label>
                        <input type="text" id="table-caption" maxlength="250" placeholder="Enter table caption" required>
                    </div>

                    <div class="table-manager-field">
                        <label for="table-section">Document Section</label>
                        <select id="table-section">
                            <option value="">General / Unassigned</option>
                            ${sections.map(section => `
                                <option value="${escapeHTML(section)}">${escapeHTML(section)}</option>
                            `).join("")}
                        </select>
                    </div>

                    <div class="table-manager-actions">
                        <button type="button" class="workspace-action-btn" id="generate-table-preview-btn">Create Preview</button>
                        <button type="button" class="workspace-action-btn" id="save-table-btn">Save Table</button>
                        <button type="button" class="workspace-action-btn" id="reset-table-btn">Clear</button>
                    </div>

                    <p class="table-manager-message" id="table-manager-message" role="status" aria-live="polite"></p>
                </div>

                <div class="table-manager-preview-panel">
                    <div class="table-manager-header">
                        <div>
                            <h3>Table Preview</h3>
                            <p>Edit the cells directly before saving.</p>
                        </div>
                    </div>

                    <div class="table-manager-actions">
                        <button type="button" class="workspace-action-btn" id="add-table-row-btn">+ Add Row</button>
                        <button type="button" class="workspace-action-btn" id="add-table-column-btn">+ Add Column</button>
                        <button type="button" class="workspace-action-btn" id="remove-table-row-btn">− Remove Row</button>
                        <button type="button" class="workspace-action-btn" id="remove-table-column-btn">− Remove Column</button>
                    </div>

                    <div class="table-manager-preview-scroll" id="table-preview-container"></div>
                </div>
            </div>

            <div class="table-manager-existing">
                <div class="table-manager-header">
                    <div>
                        <h3>Existing Tables</h3>
                        <p>Tables already saved to this document.</p>
                    </div>
                    <span id="table-manager-count">${documentTables.length} tables</span>
                </div>

                <div class="table-manager-list" id="tables-manager-list"></div>
            </div>
        </div>
    `;

    const message = document.getElementById("table-manager-message");
    const previewContainer = document.getElementById("table-preview-container");
    const captionInput = document.getElementById("table-caption");
    const sectionInput = document.getElementById("table-section");
    const descriptionInput = document.getElementById("table-description");

    function showMessage(text, isError = false) {
        message.textContent = text;
        message.style.color = isError ? "#b42318" : "";
    }

    function renderPreview() {
        previewContainer.innerHTML = `
            <table class="table-manager-grid">
                <tbody>
                    ${draftRows.map((row, rowIndex) => `
                        <tr>
                            ${row.map((cell, columnIndex) => `
                                <td>
                                    <input
                                        type="text"
                                        value="${escapeHTML(cell)}"
                                        data-row="${rowIndex}"
                                        data-column="${columnIndex}"
                                        aria-label="Row ${rowIndex + 1}, column ${columnIndex + 1}"
                                        placeholder="${rowIndex === 0 ? `Column ${columnIndex + 1}` : "Enter value"}"
                                    >
                                </td>
                            `).join("")}
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;

        previewContainer.querySelectorAll("input").forEach(input => {
            input.addEventListener("input", event => {
                const row = Number(event.target.dataset.row);
                const column = Number(event.target.dataset.column);

                draftRows[row][column] = event.target.value;
            });
        });
    }

    function renderExistingTables() {
        const list = document.getElementById("tables-manager-list");
        const count = document.getElementById("table-manager-count");

        count.textContent = `${documentTables.length} ${documentTables.length === 1 ? "table" : "tables"}`;

        if (documentTables.length === 0) {
            list.innerHTML = `
                <div class="table-manager-empty">
                    <h4>No tables yet</h4>
                    <p>Create your first table using the editor above.</p>
                </div>
            `;
            return;
        }

        list.innerHTML = documentTables.map((table, index) => `
            <div class="table-manager-item">
                <div>
                    <h4>${escapeHTML(table.caption || `Table ${index + 1}`)}</h4>
                    <p>${escapeHTML(table.section || "General / Unassigned")}</p>
                    <small>${escapeHTML(
            typeof table.content === "string"
                ? table.content.startsWith("{")
                    ? "Structured research table"
                    : table.content.slice(0, 160)
                : "Research table"
        )}</small>
                </div>
                <div class="table-manager-actions">
                    <button type="button" class="workspace-action-btn" data-edit-table="${index}">Edit</button>
                    <button type="button" class="workspace-action-btn" data-delete-table="${index}">Delete</button>
                </div>
            </div>
        `).join("");

        list.querySelectorAll("[data-edit-table]").forEach(button => {
            button.addEventListener("click", () => {
                const index = Number(button.dataset.editTable);
                const table = documentTables[index];

                if (!table) {
                    return;
                }

                editingTableId = table.id;
                captionInput.value = table.caption || "";
                sectionInput.value = table.section || "";
                descriptionInput.value = table.description || "";

                try {
                    const parsed = JSON.parse(table.content);

                    if (parsed && Array.isArray(parsed.rows) && parsed.rows.length) {
                        draftRows = parsed.rows.map(row =>
                            Array.isArray(row) ? row.map(cell => String(cell ?? "")) : []
                        );

                        const width = Math.max(1, ...draftRows.map(row => row.length));

                        draftRows = draftRows.map(row =>
                            [...row, ...Array(Math.max(0, width - row.length)).fill("")]
                        );
                    } else {
                        draftRows = [
                            ["Column 1", "Column 2", "Column 3"],
                            ["", "", ""],
                            ["", "", ""]
                        ];
                    }
                } catch {
                    draftRows = [
                        ["Column 1", "Column 2", "Column 3"],
                        ["", "", ""],
                        ["", "", ""]
                    ];
                }

                renderPreview();
                showMessage("Table loaded into the editor. Save your changes when ready.");
                container.scrollIntoView({ behavior: "smooth", block: "start" });
            });
        });

        list.querySelectorAll("[data-delete-table]").forEach(button => {
            button.addEventListener("click", async () => {
                const index = Number(button.dataset.deleteTable);
                const table = documentTables[index];

                if (!table) {
                    return;
                }

                const confirmed = await showTableDeleteModal(
                    table.caption || "this table"
                );

                if (!confirmed) {
                    return;
                }

                const previousTables = [...documentTables];

                documentTables = documentTables.filter((_, tableIndex) => tableIndex !== index);

                const saved = await saveTables();

                if (!saved) {
                    documentTables = previousTables;
                }

                renderExistingTables();
            });
        });
    }

    document.getElementById("close-table-manager").addEventListener("click", () => {
        container.style.display = "none";
    });

    document.getElementById("generate-table-preview-btn").addEventListener("click", () => {
        const description = descriptionInput.value.trim();

        if (!description) {
            showMessage("Enter a table description first.", true);
            descriptionInput.focus();
            return;
        }

        const words = description
            .replace(/[.,!?;:]+/g, " ")
            .split(/\s+/)
            .filter(Boolean);

        const suggestedColumns = words
            .filter(word => word.length > 2)
            .slice(0, 3);

        draftRows = [
            [
                suggestedColumns[0] || "Column 1",
                suggestedColumns[1] || "Column 2",
                suggestedColumns[2] || "Column 3"
            ],
            ["", "", ""],
            ["", "", ""]
        ];

        if (!captionInput.value.trim()) {
            captionInput.value = description.length > 80
                ? `${description.slice(0, 77)}...`
                : description;
        }

        renderPreview();
        showMessage("Preview created. You can edit the cells before saving.");
    });

    document.getElementById("add-table-row-btn").addEventListener("click", () => {
        const columnCount = Math.max(1, ...draftRows.map(row => row.length));
        draftRows.push(Array(columnCount).fill(""));
        renderPreview();
    });

    document.getElementById("add-table-column-btn").addEventListener("click", () => {
        draftRows = draftRows.map(row => [...row, ""]);
        renderPreview();
    });

    document.getElementById("remove-table-row-btn").addEventListener("click", () => {
        if (draftRows.length <= 1) {
            showMessage("A table must contain at least one row.", true);
            return;
        }

        draftRows.pop();
        renderPreview();
    });

    document.getElementById("remove-table-column-btn").addEventListener("click", () => {
        const columnCount = Math.max(1, ...draftRows.map(row => row.length));

        if (columnCount <= 1) {
            showMessage("A table must contain at least one column.", true);
            return;
        }

        draftRows = draftRows.map(row => row.slice(0, -1));
        renderPreview();
    });

    document.getElementById("reset-table-btn").addEventListener("click", () => {
        editingTableId = null;
        descriptionInput.value = "";
        captionInput.value = "";
        sectionInput.value = "";

        draftRows = [
            ["Column 1", "Column 2", "Column 3"],
            ["", "", ""],
            ["", "", ""]
        ];

        renderPreview();
        showMessage("Editor cleared.");
    });

    document.getElementById("save-table-btn").addEventListener("click", async () => {
        const caption = captionInput.value.trim();
        const section = sectionInput.value;
        const description = descriptionInput.value.trim();

        if (!caption) {
            showMessage("Enter a table caption before saving.", true);
            captionInput.focus();
            return;
        }

        if (!draftRows.length || !draftRows[0].length) {
            showMessage("Create a table with at least one row and one column.", true);
            return;
        }

        const tableContent = JSON.stringify({
            format: "researchforge-table-v1",
            rows: draftRows
        });

        const previousTables = [...documentTables];

        const existingIndex = editingTableId
            ? documentTables.findIndex(table => table.id === editingTableId)
            : -1;

        const tableData = {
            id: editingTableId || createItemId(),
            caption,
            section: isValidSection(section) ? section : "",
            description,
            content: tableContent
        };

        if (existingIndex >= 0) {
            documentTables[existingIndex] = tableData;
        } else {
            documentTables.push(tableData);
        }

        const saveButton = document.getElementById("save-table-btn");
        saveButton.disabled = true;
        saveButton.textContent = "Saving...";

        try {
            const saved = await saveTables();

            if (!saved) {
                documentTables = previousTables;
                renderExistingTables();
                showMessage("Unable to save the table. Your previous tables have been restored.", true);
                return;
            }

            editingTableId = null;
            renderExistingTables();
            showMessage("Table saved successfully.");

            descriptionInput.value = "";
            captionInput.value = "";
            sectionInput.value = "";

            draftRows = [
                ["Column 1", "Column 2", "Column 3"],
                ["", "", ""],
                ["", "", ""]
            ];

            renderPreview();
        } finally {
            saveButton.disabled = false;
            saveButton.textContent = "Save Table";
        }
    });

    renderPreview();
    renderExistingTables();
}

async function saveFigures() {
    if (!currentProjectId) {
        alert("No document is selected.");
        return false;
    }

    try {
        await apiRequest(
            `${API_BASE_URL}/projects/${currentProjectId}/figures`,
            {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    figures: documentFigures
                })
            }
        );

        updateFiguresSummary();
        alert("Figures saved successfully.");
        return true;
    } catch (error) {
        console.error("Unable to save figures:", error);
        alert(`Unable to save figures: ${error.message}`);
        return false;
    }
}

async function saveTables() {
    if (!currentProjectId) {
        alert("No document is selected.");
        return false;
    }

    try {
        await apiRequest(
            `${API_BASE_URL}/projects/${currentProjectId}/tables`,
            {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    tables: documentTables
                })
            }
        );

        updateTablesSummary();
        alert("Tables saved successfully.");
        return true;
    } catch (error) {
        console.error("Unable to save tables:", error);
        alert(`Unable to save tables: ${error.message}`);
        return false;
    }
}

function getSectionNames() {
    const configuration = documentConfigurations[currentDocumentType];

    return configuration ? configuration.sections : [];
}

function isValidSection(section) {
    return getSectionNames().includes(section);
}

function createItemId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function showError(message) {
    if (workspaceErrorMessage) {
        workspaceErrorMessage.textContent = message;
    }

    if (workspaceError) {
        workspaceError.hidden = false;
    }

    if (projectName) {
        projectName.textContent = "Document unavailable";
    }

    if (projectId) {
        projectId.textContent = "";
    }

    if (workspaceSaveStatus) {
        workspaceSaveStatus.textContent = "Unable to load document";
    }

    if (documentSectionsContainer) {
        documentSectionsContainer.hidden = false;
        documentSectionsContainer.replaceChildren();

        const errorMessage = document.createElement("p");
        errorMessage.textContent = message;

        const retryButton = document.createElement("button");
        retryButton.type = "button";
        retryButton.className = "workspace-action-btn";
        retryButton.textContent = "Retry Loading";
        retryButton.addEventListener("click", async () => {
            if (!currentProjectId || workspaceLoading) {
                return;
            }

            if (workspaceError) {
                workspaceError.hidden = true;
            }

            await loadResearch();
        });

        documentSectionsContainer.append(errorMessage, retryButton);
    }

    if (sectionWorkspaceLayout) {
        sectionWorkspaceLayout.hidden = true;
        sectionWorkspaceLayout.style.display = "none";
    }
}
