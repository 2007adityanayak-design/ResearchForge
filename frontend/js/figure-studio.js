console.log("ResearchForge Figure Studio loaded");

const FIGURE_STUDIO_API = "http://127.0.0.1:8000";
const figureStudioParams = new URLSearchParams(window.location.search);
const figureStudioProjectId = figureStudioParams.get("id");

const figureStudioProjectName = document.getElementById("figure-studio-project-name");
const figureStudioForm = document.getElementById("figure-studio-form");
const figureStudioImage = document.getElementById("studio-figure-image");
const figureStudioCaption = document.getElementById("studio-figure-caption");
const figureStudioDescription = document.getElementById("studio-figure-description");
const figureStudioSection = document.getElementById("studio-figure-section");
const figureStudioPreview = document.getElementById("studio-figure-preview");
const figureStudioSaved = document.getElementById("studio-saved-figures");
const figureStudioCount = document.getElementById("studio-figure-count");
const figureStudioStatus = document.getElementById("studio-figure-status");
const figureStudioFeedback = document.getElementById("studio-figure-feedback");
const figureStudioSaveButton = document.getElementById("studio-save-figure");
const figureStudioPreviewButton = document.getElementById("studio-preview-figure");
const figureStudioResetButton = document.getElementById("studio-reset-figure");

const FIGURE_STUDIO_MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const FIGURE_STUDIO_ALLOWED_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif"
];

let figureStudioFigures = [];
let figureStudioSections = [];
let figureStudioEditingId = null;
let figureStudioCurrentImageUrl = "";
let figureStudioSelectedFile = null;
let figureStudioObjectUrl = "";
let figureStudioIsPreviewReady = false;
let figureStudioIsSaving = false;

function figureStudioEscape(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function figureStudioResolveImageUrl(imageUrl) {
    if (!imageUrl || typeof imageUrl !== "string") {
        return "";
    }

    try {
        const parsed = new URL(imageUrl, FIGURE_STUDIO_API);

        if (
            parsed.protocol !== "http:" &&
            parsed.protocol !== "https:"
        ) {
            return "";
        }

        if (
            parsed.origin !== FIGURE_STUDIO_API &&
            parsed.origin !== window.location.origin
        ) {
            return "";
        }

        return parsed.href;
    } catch {
        return "";
    }
}

async function figureStudioRequest(path, options = {}) {
    const response = await fetch(`${FIGURE_STUDIO_API}${path}`, {
        ...options,
        headers: {
            ...(options.body && !(options.body instanceof FormData)
                ? { "Content-Type": "application/json" }
                : {}),
            ...options.headers
        }
    });

    const responseText = await response.text();
    let data = {};

    if (responseText) {
        try {
            data = JSON.parse(responseText);
        } catch {
            data = { detail: responseText };
        }
    }

    if (!response.ok) {
        throw new Error(
            data.detail ||
            data.message ||
            `Request failed with status ${response.status}`
        );
    }

    return data;
}

function figureStudioMessage(message, isError = false) {
    figureStudioFeedback.textContent = message;
    figureStudioFeedback.style.color = isError ? "#b42318" : "";
}

function figureStudioSetStatus(message) {
    figureStudioStatus.textContent = message;
}

function figureStudioUpdatePreview() {
    const caption = figureStudioCaption.value.trim();
    const description = figureStudioDescription.value.trim();
    const section = figureStudioSection.value;

    const imageUrl = figureStudioSelectedFile
        ? figureStudioObjectUrl
        : figureStudioCurrentImageUrl;

    if (!imageUrl) {
        figureStudioPreview.innerHTML = `
            <div class="figure-studio-empty-preview">
                <div class="figure-studio-empty-icon">▧</div>
                <h3>Your figure will appear here</h3>
                <p>Upload an image and select Preview Figure to get started.</p>
            </div>
        `;
        return;
    }

    figureStudioPreview.innerHTML = `
        <figure class="figure-studio-preview-figure" style="width:100%;margin:0;text-align:center;">
            <img
                src="${figureStudioEscape(imageUrl)}"
                alt="${figureStudioEscape(caption || "Research figure preview")}"
                style="display:block;max-width:100%;max-height:480px;width:auto;height:auto;margin:0 auto;border-radius:10px;object-fit:contain;"
            >
            <figcaption style="margin-top:20px;color:#304b38;font-size:15px;font-weight:750;line-height:1.8;overflow-wrap:anywhere;">
                ${figureStudioEscape(caption || "Figure caption will appear here")}
            </figcaption>
            ${description ? `
                <p style="margin:12px 0 0;color:#728075;font-size:13px;line-height:1.8;overflow-wrap:anywhere;">
                    ${figureStudioEscape(description)}
                </p>
            ` : ""}
            <p style="margin:10px 0 0;color:#849187;font-size:11px;">
                ${figureStudioEscape(section || "General / Unassigned")}
            </p>
        </figure>
    `;

    const image = figureStudioPreview.querySelector("img");

    image.addEventListener("error", () => {
        image.alt = "Unable to load this image";
        image.style.display = "none";

        const errorMessage = document.createElement("p");
        errorMessage.textContent = "Unable to load this image. Please select another image.";
        errorMessage.style.color = "#b42318";
        errorMessage.style.fontSize = "13px";

        figureStudioPreview.querySelector("figure").appendChild(errorMessage);
    }, { once: true });
}

function figureStudioRenderSections() {
    const currentValue = figureStudioSection.value;

    figureStudioSection.innerHTML = `
        <option value="">General / Unassigned</option>
        ${figureStudioSections.map(section => `
            <option value="${figureStudioEscape(section)}">${figureStudioEscape(section)}</option>
        `).join("")}
    `;

    if (figureStudioSections.includes(currentValue)) {
        figureStudioSection.value = currentValue;
    }
}

async function figureStudioLoadProject() {
    if (
        !figureStudioProjectId ||
        !/^\d+$/.test(figureStudioProjectId) ||
        !Number.isSafeInteger(Number(figureStudioProjectId)) ||
        Number(figureStudioProjectId) < 1
    ) {
        throw new Error(
            "The project ID is missing or invalid. Return to your workspace and open Figure Studio again."
        );
    }

    const data = await figureStudioRequest(
        `/projects/${figureStudioProjectId}/research`
    );

    const candidates = [
        data?.project,
        data?.research?.project,
        data?.research,
        data
    ];

    let projectName = "";

    for (const candidate of candidates) {
        if (!candidate || typeof candidate !== "object") {
            continue;
        }

        projectName =
            candidate.project_name ||
            candidate.projectName ||
            candidate.name ||
            candidate.title ||
            "";

        if (projectName) {
            break;
        }
    }

    figureStudioProjectName.textContent =
        projectName || `Project #${figureStudioProjectId}`;

    const workspaceLink = document.querySelector(".figure-studio-back");

    if (workspaceLink) {
        workspaceLink.href =
            `workspace.html?id=${encodeURIComponent(figureStudioProjectId)}`;
    }

    const research = data?.research || data?.project || data;

    const documentType =
        research?.document_type ||
        research?.documentType ||
        data?.document_type ||
        "";

    if (documentType) {
        try {
            const sectionData = await figureStudioRequest(
                `/projects/${figureStudioProjectId}/sections?document_type=${encodeURIComponent(documentType)}`
            );

            const sections = sectionData.sections || sectionData;

            if (Array.isArray(sections)) {
                figureStudioSections = sections
                    .map(section =>
                        typeof section === "string"
                            ? section
                            : section.name || section.title || ""
                    )
                    .filter(Boolean);
            } else if (
                sections &&
                typeof sections === "object"
            ) {
                figureStudioSections = Object.keys(sections);
            }
        } catch (error) {
            console.warn("Unable to load document sections:", error);
        }
    }

    figureStudioRenderSections();
}

async function figureStudioLoadFigures() {
    const data = await figureStudioRequest(
        `/projects/${figureStudioProjectId}/figures`
    );

    if (!Array.isArray(data.figures)) {
        throw new Error("The server returned invalid figure data.");
    }

    figureStudioFigures = data.figures.filter(
        figure => figure && typeof figure === "object" && !Array.isArray(figure)
    );

    figureStudioRenderSavedFigures();
}

async function figureStudioSaveAll() {
    await figureStudioRequest(
        `/projects/${figureStudioProjectId}/figures`,
        {
            method: "PUT",
            body: JSON.stringify({
                figures: figureStudioFigures
            })
        }
    );
}

async function figureStudioUploadImage(file) {
    const formData = new FormData();
    formData.append("image", file);

    const data = await figureStudioRequest(
        `/projects/${figureStudioProjectId}/figures/upload`,
        {
            method: "POST",
            body: formData
        }
    );

    if (!data.image_url) {
        throw new Error("The server did not return an image URL.");
    }

    return data.image_url;
}

function figureStudioRenderSavedFigures() {
    figureStudioCount.textContent =
        `${figureStudioFigures.length} ${figureStudioFigures.length === 1 ? "figure" : "figures"}`;

    if (!figureStudioFigures.length) {
        figureStudioSaved.innerHTML = `
            <div class="figure-studio-empty-saved">
                No saved figures yet. Create your first figure above.
            </div>
        `;
        return;
    }

    figureStudioSaved.innerHTML = figureStudioFigures.map((figure, index) => {
        const imageUrl = figureStudioResolveImageUrl(figure.image_url);

        return `
            <article class="figure-studio-saved-item">
                <div class="figure-studio-saved-image">
                    ${imageUrl ? `
                        <img
                            src="${figureStudioEscape(imageUrl)}"
                            alt="${figureStudioEscape(figure.caption || `Figure ${index + 1}`)}"
                            loading="lazy"
                        >
                    ` : `
                        <div class="figure-studio-saved-image-placeholder">
                            No image available
                        </div>
                    `}
                </div>
                <div class="figure-studio-saved-content">
                    <h3>${figureStudioEscape(figure.caption || `Figure ${index + 1}`)}</h3>
                    <p>${figureStudioEscape(figure.section || "General / Unassigned")}</p>
                    <small>${figureStudioEscape(figure.description || "No description provided.")}</small>
                    <div class="figure-studio-saved-actions">
                        <button type="button" data-figure-edit="${index}">Edit</button>
                        <button type="button" data-figure-delete="${index}">Delete</button>
                    </div>
                </div>
            </article>
        `;
    }).join("");

    figureStudioSaved.querySelectorAll("[data-figure-edit]").forEach(button => {
        button.addEventListener("click", () => {
            const figure = figureStudioFigures[
                Number(button.dataset.figureEdit)
            ];

            if (!figure) {
                return;
            }

            figureStudioClearObjectUrl();

            figureStudioEditingId = figure.id;
            figureStudioCurrentImageUrl = figure.image_url || "";
            figureStudioSelectedFile = null;
            figureStudioImage.value = "";
            figureStudioCaption.value = figure.caption || "";
            figureStudioDescription.value = figure.description || "";
            figureStudioSection.value = figure.section || "";
            figureStudioIsPreviewReady = true;

            figureStudioUpdatePreview();
            figureStudioSetStatus("Editing saved figure");
            figureStudioMessage(
                "Figure loaded. Make your changes and click Save Figure."
            );

            document.querySelector(".figure-studio-editor").scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        });
    });

    figureStudioSaved.querySelectorAll("[data-figure-delete]").forEach(button => {
        button.addEventListener("click", async () => {
            const index = Number(button.dataset.figureDelete);
            const figure = figureStudioFigures[index];

            if (!figure || figureStudioIsSaving) {
                return;
            }

            const confirmed = await showFigureDeleteModal(
                figure.caption || "this figure"
            );

            if (!confirmed) {
                return;
            }

            const previousFigures = [...figureStudioFigures];

            figureStudioFigures = figureStudioFigures.filter(
                (_, figureIndex) => figureIndex !== index
            );

            button.disabled = true;

            try {
                figureStudioIsSaving = true;
                await figureStudioSaveAll();
                figureStudioRenderSavedFigures();
                figureStudioMessage("Figure deleted successfully.");

                if (figureStudioEditingId === figure.id) {
                    figureStudioResetForm();
                }
            } catch (error) {
                figureStudioFigures = previousFigures;
                figureStudioRenderSavedFigures();

                figureStudioMessage(
                    `Unable to delete figure: ${error.message}`,
                    true
                );
            } finally {
                figureStudioIsSaving = false;
            }
        });
    });

    figureStudioSaved.querySelectorAll(".figure-studio-saved-image img").forEach(image => {
        image.addEventListener("error", () => {
            const placeholder = document.createElement("div");
            placeholder.className = "figure-studio-saved-image-placeholder";
            placeholder.textContent = "Image unavailable";
            image.replaceWith(placeholder);
        }, { once: true });
    });
}

function figureStudioClearObjectUrl() {
    if (figureStudioObjectUrl) {
        URL.revokeObjectURL(figureStudioObjectUrl);
        figureStudioObjectUrl = "";
    }
}

function figureStudioResetForm() {
    figureStudioClearObjectUrl();

    figureStudioEditingId = null;
    figureStudioCurrentImageUrl = "";
    figureStudioSelectedFile = null;
    figureStudioIsPreviewReady = false;

    figureStudioForm.reset();
    figureStudioRenderSections();

    figureStudioPreview.innerHTML = `
        <div class="figure-studio-empty-preview">
            <div class="figure-studio-empty-icon">▧</div>
            <h3>Your figure will appear here</h3>
            <p>Upload an image and select Preview Figure to get started.</p>
        </div>
    `;

    figureStudioSetStatus("Unsaved changes");
}

function figureStudioValidateFile(file) {
    if (!FIGURE_STUDIO_ALLOWED_TYPES.includes(file.type)) {
        figureStudioMessage(
            "Choose a JPG, PNG, WEBP, or GIF image.",
            true
        );
        return false;
    }

    if (file.size === 0) {
        figureStudioMessage("The selected image is empty.", true);
        return false;
    }

    if (file.size > FIGURE_STUDIO_MAX_IMAGE_SIZE) {
        figureStudioMessage("Image size cannot exceed 5 MB.", true);
        return false;
    }

    return true;
}

figureStudioImage.addEventListener("change", () => {
    const file = figureStudioImage.files?.[0];

    figureStudioClearObjectUrl();
    figureStudioSelectedFile = null;
    figureStudioIsPreviewReady = false;

    if (!file) {
        figureStudioSetStatus("Unsaved changes");
        return;
    }

    if (!figureStudioValidateFile(file)) {
        figureStudioImage.value = "";
        figureStudioSetStatus("Unsaved changes");
        return;
    }

    figureStudioSelectedFile = file;
    figureStudioObjectUrl = URL.createObjectURL(file);

    figureStudioSetStatus("Image selected");
    figureStudioMessage("Image selected. Click Preview Figure to review it.");
});

figureStudioPreviewButton.addEventListener("click", () => {
    const caption = figureStudioCaption.value.trim();

    if (!caption) {
        figureStudioMessage("Enter a figure caption first.", true);
        figureStudioCaption.focus();
        return;
    }

    if (!figureStudioSelectedFile && !figureStudioCurrentImageUrl) {
        figureStudioMessage("Select an image before creating the preview.", true);
        figureStudioImage.focus();
        return;
    }

    figureStudioIsPreviewReady = true;
    figureStudioUpdatePreview();
    figureStudioSetStatus("Preview ready");
    figureStudioMessage("Preview ready. Review the figure before saving.");
});

figureStudioCaption.addEventListener("input", () => {
    figureStudioSetStatus("Unsaved changes");

    if (figureStudioIsPreviewReady) {
        figureStudioUpdatePreview();
    }
});

figureStudioDescription.addEventListener("input", () => {
    figureStudioSetStatus("Unsaved changes");

    if (figureStudioIsPreviewReady) {
        figureStudioUpdatePreview();
    }
});

figureStudioSection.addEventListener("change", () => {
    figureStudioSetStatus("Unsaved changes");

    if (figureStudioIsPreviewReady) {
        figureStudioUpdatePreview();
    }
});

figureStudioResetButton.addEventListener("click", () => {
    if (figureStudioIsSaving) {
        return;
    }

    figureStudioResetForm();
    figureStudioMessage("Editor reset.");
});

figureStudioSaveButton.addEventListener("click", async () => {
    if (figureStudioIsSaving) {
        return;
    }

    const caption = figureStudioCaption.value.trim();
    const description = figureStudioDescription.value.trim();
    const section = figureStudioSection.value;

    if (!caption) {
        figureStudioMessage("Enter a figure caption before saving.", true);
        figureStudioCaption.focus();
        return;
    }

    if (!figureStudioSelectedFile && !figureStudioCurrentImageUrl) {
        figureStudioMessage("Select an image before saving the figure.", true);
        figureStudioImage.focus();
        return;
    }

    if (!figureStudioIsPreviewReady) {
        figureStudioMessage("Click Preview Figure before saving.", true);
        return;
    }

    const previousFigures = [...figureStudioFigures];
    const previousImageUrl = figureStudioCurrentImageUrl;

    figureStudioIsSaving = true;
    figureStudioSaveButton.disabled = true;
    figureStudioPreviewButton.disabled = true;
    figureStudioResetButton.disabled = true;
    figureStudioSetStatus("Saving figure...");
    figureStudioMessage("Saving your figure. Please wait.");

    try {
        if (figureStudioSelectedFile) {
            figureStudioCurrentImageUrl = await figureStudioUploadImage(
                figureStudioSelectedFile
            );
        }

        const figure = {
            id: figureStudioEditingId || (
                window.crypto?.randomUUID
                    ? window.crypto.randomUUID()
                    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
            ),
            caption,
            description,
            section: figureStudioSections.includes(section) ? section : "",
            image_url: figureStudioCurrentImageUrl
        };

        const existingIndex = figureStudioEditingId
            ? figureStudioFigures.findIndex(
                item => item.id === figureStudioEditingId
            )
            : -1;

        if (existingIndex >= 0) {
            figureStudioFigures[existingIndex] = figure;
        } else {
            figureStudioFigures.push(figure);
        }

        await figureStudioSaveAll();

        figureStudioEditingId = null;
        figureStudioRenderSavedFigures();
        figureStudioSetStatus("Saved successfully");
        figureStudioMessage("Figure saved successfully.");

        figureStudioResetForm();
        figureStudioSetStatus("Saved successfully");
    } catch (error) {
        figureStudioFigures = previousFigures;
        figureStudioCurrentImageUrl = previousImageUrl;

        figureStudioRenderSavedFigures();
        figureStudioSetStatus("Save failed");

        figureStudioMessage(
            `Unable to save figure: ${error.message}`,
            true
        );
    } finally {
        figureStudioIsSaving = false;
        figureStudioSaveButton.disabled = false;
        figureStudioPreviewButton.disabled = false;
        figureStudioResetButton.disabled = false;
    }
});

async function figureStudioInitialize() {
    try {
        await figureStudioLoadProject();
        await figureStudioLoadFigures();
    } catch (error) {
        console.error("Figure Studio initialization failed:", error);

        if (figureStudioProjectName.textContent === "Loading project...") {
            figureStudioProjectName.textContent = "Unable to load project";
        }

        figureStudioMessage(
            `Unable to load the project: ${error.message}`,
            true
        );
    }
}

function showFigureDeleteModal(figureCaption) {
    return new Promise(resolve => {
        const overlay = document.createElement("div");

        Object.assign(overlay.style, {
            position: "fixed",
            inset: "0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            background: "rgba(20, 38, 29, 0.65)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            zIndex: "999999",
            opacity: "0",
            transition: "opacity 180ms ease",
            boxSizing: "border-box"
        });

        const modal = document.createElement("div");

        Object.assign(modal.style, {
            width: "100%",
            maxWidth: "420px",
            padding: "28px",
            borderRadius: "18px",
            border: "1px solid #c7d5ca",
            background: "#f8faf8",
            boxShadow: "0 24px 65px rgba(15, 35, 23, 0.3)",
            fontFamily: "inherit",
            boxSizing: "border-box",
            transform: "translateY(12px) scale(0.97)",
            transition: "transform 200ms ease"
        });

        const heading = document.createElement("h3");
        heading.textContent = "Delete Figure?";

        Object.assign(heading.style, {
            margin: "0 0 12px",
            color: "#20372b",
            fontSize: "21px",
            fontWeight: "700"
        });

        const message = document.createElement("p");
        message.textContent =
            `Are you sure you want to delete "${figureCaption}"? This action cannot be undone.`;

        Object.assign(message.style, {
            margin: "0 0 26px",
            color: "#46594c",
            fontSize: "14px",
            lineHeight: "1.7",
            overflowWrap: "anywhere"
        });

        const actions = document.createElement("div");

        Object.assign(actions.style, {
            display: "flex",
            justifyContent: "flex-end",
            gap: "12px",
            flexWrap: "wrap"
        });

        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = "Cancel";

        Object.assign(cancel.style, {
            padding: "10px 19px",
            border: "1px solid #9aafa0",
            borderRadius: "9px",
            background: "#e8eee9",
            color: "#263d2e",
            fontWeight: "600",
            cursor: "pointer",
            transition: "all 180ms ease",
            boxShadow: "none"
        });

        const confirm = document.createElement("button");
        confirm.type = "button";
        confirm.textContent = "Delete";

        Object.assign(confirm.style, {
            padding: "10px 21px",
            border: "1px solid #2f6b4c",
            borderRadius: "9px",
            background: "#367653",
            color: "#ffffff",
            fontWeight: "700",
            cursor: "pointer",
            transition: "all 180ms ease",
            boxShadow: "none"
        });

        cancel.addEventListener("mouseenter", () => {
            cancel.style.transform = "translateY(-3px) scale(1.05)";
            cancel.style.boxShadow = "0 7px 20px rgba(54, 118, 83, 0.25)";
        });

        cancel.addEventListener("mouseleave", () => {
            cancel.style.transform = "translateY(0) scale(1)";
            cancel.style.boxShadow = "none";
        });

        confirm.addEventListener("mouseenter", () => {
            confirm.style.transform = "translateY(-3px) scale(1.05)";
            confirm.style.boxShadow = "0 7px 20px rgba(54, 118, 83, 0.3)";
        });

        confirm.addEventListener("mouseleave", () => {
            confirm.style.transform = "translateY(0) scale(1)";
            confirm.style.boxShadow = "none";
        });

        let closed = false;

        function close(result) {
            if (closed) {
                return;
            }

            closed = true;
            document.removeEventListener("keydown", onKeyDown);

            cancel.disabled = true;
            confirm.disabled = true;

            overlay.style.opacity = "0";
            modal.style.transform = "translateY(12px) scale(0.97)";

            setTimeout(() => {
                overlay.remove();
                resolve(result);
            }, 180);
        }

        function onKeyDown(event) {
            if (event.key === "Escape") {
                close(false);
            }
        }

        cancel.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            close(false);
        });

        confirm.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            close(true);
        });

        overlay.addEventListener("click", event => {
            if (event.target === overlay) {
                close(false);
            }
        });

        modal.append(heading, message);
        actions.append(cancel, confirm);
        modal.appendChild(actions);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        document.addEventListener("keydown", onKeyDown);

        requestAnimationFrame(() => {
            overlay.style.opacity = "1";
            modal.style.transform = "translateY(0) scale(1)";
        });
    });
}

figureStudioInitialize();