(() => {
    const API_BASE = "http://127.0.0.1:8000";

    const elements = {
        status: document.getElementById("custom-template-status"),
        details: document.getElementById("custom-template-details"),
        name: document.getElementById("custom-template-name"),
        open: document.getElementById("custom-template-open"),
        remove: document.getElementById("custom-template-remove"),
        file: document.getElementById("custom-template-file"),
        upload: document.getElementById("custom-template-upload")
    };

    const projectId = new URLSearchParams(window.location.search).get("id");

    let currentTemplate = null;
    let busy = false;

    function setStatus(message, isError = false) {
        elements.status.textContent = message;
        elements.status.style.color = isError ? "#c0392b" : "";
    }

    function setBusy(value) {
        busy = value;
        elements.upload.disabled = value;
        elements.remove.disabled = value;
        elements.file.disabled = value;
        elements.upload.textContent = value ? "Please wait..." : "Upload Template";
    }

    function makeUploadUrl(relativePath) {
        const encodedPath = relativePath
            .split("/")
            .map(segment => encodeURIComponent(segment))
            .join("/");

        return `${API_BASE}/uploads/${encodedPath}`;
    }

    function renderTemplate(template) {
        currentTemplate = template;

        if (!template || !template.template_file_path) {
            elements.details.hidden = true;
            setStatus("No custom formatting template is currently attached.");
            return;
        }

        elements.details.hidden = false;
        elements.name.textContent = template.template_file_name || "Formatting template";
        elements.open.href = makeUploadUrl(template.template_file_path);
        elements.open.textContent = "Open Template";
        setStatus("Formatting template is saved for this project.");
    }

    async function loadTemplate() {
        if (!projectId) {
            setStatus("Project ID is missing from the URL.", true);
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/projects/${projectId}/research`);

            if (!response.ok) {
                throw new Error(`Unable to load template information (${response.status}).`);
            }

            const data = await response.json();
            renderTemplate(data);
        } catch (error) {
            setStatus(error.message || "Could not load template information.", true);
        }
    }

    function validateFile(file) {
        if (!file) {
            return "Please select a template file first.";
        }

        const extension = file.name.split(".").pop().toLowerCase();

        if (!["pdf", "doc", "docx"].includes(extension)) {
            return "Only PDF, DOC, and DOCX files are supported.";
        }

        if (file.size > 15 * 1024 * 1024) {
            return "The template file cannot exceed 15 MB.";
        }

        if (file.size === 0) {
            return "The selected file is empty.";
        }

        return null;
    }

    async function uploadTemplate() {
        if (busy) return;

        const file = elements.file.files[0];
        const validationError = validateFile(file);

        if (validationError) {
            setStatus(validationError, true);
            return;
        }

        const formData = new FormData();
        formData.append("template_file", file);

        setBusy(true);
        setStatus("Uploading formatting template...");

        try {
            const response = await fetch(
                `${API_BASE}/projects/${projectId}/template`,
                {
                    method: "POST",
                    body: formData
                }
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || "Template upload failed.");
            }

            renderTemplate(data);
            elements.file.value = "";
            setStatus("Formatting template uploaded successfully.");
        } catch (error) {
            setStatus(error.message || "Template upload failed.", true);
        } finally {
            setBusy(false);
        }
    }

    async function removeTemplate() {
        if (busy || !currentTemplate) return;

        if (!window.confirm("Remove the custom formatting template from this project?")) {
            return;
        }

        setBusy(true);
        setStatus("Removing formatting template...");

        try {
            const response = await fetch(
                `${API_BASE}/projects/${projectId}/template`,
                { method: "DELETE" }
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || "Template removal failed.");
            }

            elements.file.value = "";
            renderTemplate(null);
            setStatus("Formatting template removed successfully.");
        } catch (error) {
            setStatus(error.message || "Template removal failed.", true);
        } finally {
            setBusy(false);
        }
    }

    function initialize() {
        if (!elements.status || !elements.details || !elements.file ||
            !elements.upload || !elements.remove || !elements.name ||
            !elements.open) {
            return;
        }

        elements.upload.addEventListener("click", uploadTemplate);
        elements.remove.addEventListener("click", removeTemplate);

        elements.file.addEventListener("change", () => {
            const file = elements.file.files[0];

            if (!file) return;

            const error = validateFile(file);
            setStatus(error || `Selected: ${file.name}`, Boolean(error));
        });

        loadTemplate();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize);
    } else {
        initialize();
    }
})();
