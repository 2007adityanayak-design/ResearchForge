
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
const templateUploadGroup = document.getElementById("template-upload-group");
const templateFileInput = document.getElementById("template-file");
const templateFileName = document.getElementById("template-file-name");

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
    templateFileInput.addEventListener("change", updateTemplateFile);
    documentTypeSelect.addEventListener("change", updateFormattingOptions);
    formatStyleSelect.addEventListener("change", updateTemplateVisibility);
    projectForm.addEventListener("submit", createProject);

    updateFormattingOptions();
});

function updateTemplateFile() {
    const file = templateFileInput.files[0];
    templateFileName.replaceChildren();

    if (!file) {
        return;
    }

    const allowedExtensions = [".pdf", ".doc", ".docx"];
    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();

    if (!allowedExtensions.includes(extension)) {
        templateFileInput.value = "";
        templateFileName.textContent = "Please select a PDF, DOC, or DOCX file.";
        return;
    }

    if (file.size > 15 * 1024 * 1024) {
        templateFileInput.value = "";
        templateFileName.textContent = "Template files cannot exceed 15 MB.";
        return;
    }

    const label = document.createElement("span");
    label.textContent = `Selected: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.style.marginLeft = "10px";
    removeButton.addEventListener("click", () => {
        templateFileInput.value = "";
        templateFileName.replaceChildren();
    });

    templateFileName.append(label, removeButton);
}

function updateCharacterCount() {
    projectNameCount.textContent = `${projectNameInput.value.length}/150`;
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

    formatStyleSelect.add(new Option("Custom Template", "custom_template"));

    formatStyleSelect.disabled = false;
    formatHelper.textContent = configuration.description;
    documentNextStep.textContent = configuration.nextStep;
    updateTemplateVisibility();
}

function updateTemplateVisibility() {
    const isCustomTemplate = formatStyleSelect.value === "custom_template";

    templateUploadGroup.hidden = !isCustomTemplate;
    templateFileInput.required = isCustomTemplate;

    if (!isCustomTemplate) {
        templateFileInput.value = "";
        templateFileName.replaceChildren();
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

    if (formatStyle === "custom_template" && !templateFileInput.files[0]) {
        showProjectMessage("Please upload a PDF or Word formatting template.", "error");
        templateFileInput.focus();
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
    if (templateFileInput.files[0]) {
        formData.append("template_file", templateFileInput.files[0]);
    }

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

        showProjectMessage(
            "Document created successfully! Opening your workspace...",
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
        createProjectButton.innerHTML = "<span>Create document</span><span aria-hidden=\"true\">&#8594;</span>";
    } finally {
        isCreatingProject = false;
    }
}

