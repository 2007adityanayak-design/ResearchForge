
const API_BASE_URL = "http://127.0.0.1:8000";

const projectForm = document.getElementById("project-form");
const projectNameInput = document.getElementById("project-name");
const createProjectButton = document.getElementById("create-project-btn");
const projectMessage = document.getElementById("project-message");
const projectNameCount = document.getElementById("project-name-count");
const documentTypeSelect = document.getElementById("document-type");
const formatStyleSelect = document.getElementById("format-style");
const formatHelper = document.getElementById("format-helper");
const documentNextStep = document.getElementById("document-next-step");
const authorNameInput = document.getElementById("author-name");
const institutionInput = document.getElementById("institution");
const departmentInput = document.getElementById("department");
const supervisorInput = document.getElementById("supervisor");
const documentModeSelect = document.getElementById("document-mode");
const existingMaterialNotice = document.getElementById("existing-material-notice");

let isCreatingProject = false;

const documentConfigurations = {
    project_report: {
        formats: [
            { value: "college_template", label: "College Template" },
            { value: "standard_academic", label: "Standard Academic Format" }
        ],
        description: "Choose a college template or a standard academic layout.",
        nextStep: "Your project report workspace will include sections for the introduction, objectives, methodology, implementation, results, conclusion, and references."
    },
    research_paper: {
        formats: [
            { value: "ieee", label: "IEEE Format" },
            { value: "apa", label: "APA Format" },
            { value: "standard_academic", label: "Standard Academic Format" }
        ],
        description: "Choose IEEE, APA, or a standard academic layout.",
        nextStep: "Your research paper workspace will include sections for the abstract, keywords, introduction, methodology, results, discussion, conclusion, and references."
    },
    review_paper: {
        formats: [
            { value: "ieee", label: "IEEE Format" },
            { value: "apa", label: "APA Format" },
            { value: "standard_academic", label: "Standard Academic Format" }
        ],
        description: "Choose the citation and formatting style for your literature review.",
        nextStep: "Your review paper workspace will help you organize existing research, compare findings, identify research gaps, and document references."
    },
    thesis: {
        formats: [
            { value: "university_template", label: "University Template" },
            { value: "standard_academic", label: "Standard Academic Format" }
        ],
        description: "Choose your university template or a standard academic layout.",
        nextStep: "Your thesis workspace will organize your research into chapters, including the introduction, literature review, methodology, results, conclusion, and references."
    },
    academic_report: {
        formats: [
            { value: "standard_academic", label: "Standard Academic Format" },
            { value: "apa", label: "APA Format" }
        ],
        description: "Choose a standard academic layout or APA formatting.",
        nextStep: "Your academic report workspace will provide a structure appropriate for general academic writing."
    }
};

document.addEventListener("DOMContentLoaded", () => {
    projectNameInput.focus();

    projectNameInput.addEventListener("input", updateCharacterCount);
    documentTypeSelect.addEventListener("change", updateFormattingOptions);
    documentModeSelect.addEventListener("change", updateDocumentMode);
    projectForm.addEventListener("submit", createProject);

    updateDocumentMode();
});

function updateCharacterCount() {
    projectNameCount.textContent = `${projectNameInput.value.length}/150`;
}

function updateDocumentMode() {
    const isConverting = documentModeSelect.value === "convert";

    existingMaterialNotice.hidden = !isConverting;

    if (isConverting) {
        createProjectButton.innerHTML = "<span>Continue with existing material</span><span aria-hidden=\"true\">→</span>";
        documentNextStep.textContent = "Create the destination document first. You can then add existing material in your workspace.";
    } else {
        createProjectButton.innerHTML = "<span>Create document</span><span aria-hidden=\"true\">→</span>";

        const configuration = documentConfigurations[documentTypeSelect.value];

        documentNextStep.textContent = configuration
            ? configuration.nextStep
            : "Your selected document type will determine the structure of your workspace. You can develop your document section by section.";
    }

    projectMessage.style.display = "none";
}

function updateFormattingOptions() {
    const selectedType = documentTypeSelect.value;
    const configuration = documentConfigurations[selectedType];

    formatStyleSelect.replaceChildren();

    if (!configuration) {
        formatStyleSelect.disabled = true;
        formatStyleSelect.add(new Option("Choose a document type first", ""));
        formatHelper.textContent = "Available formats will depend on your document type.";
        documentNextStep.textContent = "Your selected document type will determine the structure of your workspace. You can develop your document section by section.";
        return;
    }

    formatStyleSelect.add(new Option("Select formatting style", ""));

    configuration.formats.forEach(format => {
        formatStyleSelect.add(new Option(format.label, format.value));
    });

    formatStyleSelect.disabled = false;
    formatHelper.textContent = configuration.description;

    if (documentModeSelect.value !== "convert") {
        documentNextStep.textContent = configuration.nextStep;
    }
}

function showProjectMessage(message, type) {
    projectMessage.textContent = message;
    projectMessage.className = `project-message project-message-${type}`;
    projectMessage.style.display = "block";
}

async function createProject(event) {
    event.preventDefault();

    if (isCreatingProject) {
        return;
    }

    const projectName = projectNameInput.value.trim();
    const authorName = authorNameInput.value.trim();
    const documentType = documentTypeSelect.value;
    const formatStyle = formatStyleSelect.value;
    const isConverting = documentModeSelect.value === "convert";

    if (!documentType) {
        showProjectMessage("Please select a document type.", "error");
        documentTypeSelect.focus();
        return;
    }

    if (!formatStyle) {
        showProjectMessage("Please select a formatting style.", "error");
        formatStyleSelect.focus();
        return;
    }

    if (!projectName) {
        showProjectMessage("Please enter a document title.", "error");
        projectNameInput.focus();
        return;
    }

    if (projectName.length > 150) {
        showProjectMessage("Document titles cannot exceed 150 characters.", "error");
        projectNameInput.focus();
        return;
    }

    if (!authorName) {
        showProjectMessage("Please enter at least one author name.", "error");
        authorNameInput.focus();
        return;
    }

    isCreatingProject = true;
    createProjectButton.disabled = true;
    createProjectButton.innerHTML = "<span>Creating document...</span>";

    const formData = new FormData();

    formData.append("project_name", projectName);
    formData.append("document_type", documentType);
    formData.append("format_style", formatStyle);
    formData.append("author_name", authorName);
    formData.append("institution", institutionInput.value.trim());
    formData.append("department", departmentInput.value.trim());
    formData.append("supervisor", supervisorInput.value.trim());

    try {
        const response = await fetch(`${API_BASE_URL}/projects`, {
            method: "POST",
            body: formData
        });

        const responseData = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(
                responseData.detail || "Unable to create your document."
            );
        }

        if (isConverting) {
            sessionStorage.setItem(
                `researchforge-conversion-${responseData.project_id}`,
                "pending"
            );
        }

        showProjectMessage(
            isConverting
                ? "Destination document created! Opening your workspace..."
                : "Document created successfully! Opening your workspace...",
            "success"
        );

        createProjectButton.innerHTML = "<span>Document created ✓</span>";

        window.location.href = `workspace.html?id=${encodeURIComponent(responseData.project_id)}`;
    } catch (error) {
        showProjectMessage(
            error.message === "Failed to fetch"
                ? "Could not connect to ResearchForge. Make sure the backend is running and try again."
                : error.message || "Something went wrong. Please try again.",
            "error"
        );

        createProjectButton.disabled = false;
        updateDocumentMode();
    } finally {
        isCreatingProject = false;
    }
}

