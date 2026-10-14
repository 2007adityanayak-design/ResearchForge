console.log("ResearchForge workspace2.js loaded");

const FIGURES_API_BASE_URL = "http://127.0.0.1:8000";
const FIGURES_MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const figuresManagerContainer = document.getElementById(
    "figures-manager-container"
);

const figuresManagerButton = document.getElementById("open-figures-btn");
const figuresManagerSummary = document.getElementById("figures-summary");

document.addEventListener(
    "submit",
    function (event) {
        if (
            figuresManagerContainer &&
            event.target instanceof HTMLFormElement &&
            event.target.contains(figuresManagerContainer)
        ) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    },
    true
);

let workspace2ProjectId = null;
let workspace2Figures = [];
let workspace2Sections = [];
let workspace2Loading = false;
let workspace2UploadInProgress = false;
let workspace2ManagerOpen = false;

function initializeFiguresManager() {
    const urlParams = new URLSearchParams(window.location.search);
    workspace2ProjectId = urlParams.get("id");

    if (!figuresManagerContainer || !figuresManagerButton) {
        console.error("Figure manager HTML elements were not found.");
        return;
    }

    if (
        !workspace2ProjectId ||
        !/^\d+$/.test(workspace2ProjectId) ||
        Number(workspace2ProjectId) < 1
    ) {
        figuresManagerContainer.textContent =
            "Unable to identify the current project.";
        return;
    }
    console.log(
        "Figure manager initialized for project:",
        workspace2ProjectId
    );
}

function openFiguresManager() {
    if (workspace2Loading || workspace2UploadInProgress) {
        return;
    }

    workspace2ManagerOpen = true;

    renderFiguresManager();
    loadFiguresManagerData();
}

function renderFiguresManager() {
    figuresManagerContainer.innerHTML = `
        <div class="existing-material-panel figure-manager-panel">
            <div class="figure-manager-heading">
                <div>
                    <h3>Figure Manager</h3>
                    <p>Upload images and organize figures for your research document.</p>
                </div>
            </div>

            <div class="figure-manager-form">
                <div class="figure-manager-field">
                    <label for="workspace2-figure-image">Upload Image</label>
                    <input
                        type="file"
                        id="workspace2-figure-image"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                    >
                    <small>JPG, PNG, WEBP, or GIF. Maximum size: 5 MB.</small>
                </div>

                <div class="figure-manager-field">
                    <label for="workspace2-figure-caption">Figure Caption</label>
                    <input
                        type="text"
                        id="workspace2-figure-caption"
                        placeholder="Enter a figure caption"
                        maxlength="250"
                    >
                </div>

                <div class="figure-manager-field">
                    <label for="workspace2-figure-section">Document Section</label>
                    <select id="workspace2-figure-section">
                        <option value="">General / Unassigned</option>
                    </select>
                </div>

                <button
                    type="button"
                    class="workspace-action-btn"
                    id="workspace2-figure-upload-btn"
                >
                    Upload Figure
                </button>

                <p
                    id="workspace2-figure-manager-message"
                    role="status"
                    aria-live="polite"
                ></p>
            </div>

            <div class="figure-manager-existing">
                <h3>Existing Figures</h3>
                <div id="workspace2-figure-manager-list">
                    Loading figures...
                </div>
            </div>
        </div>
    `;

    const uploadButton = document.getElementById(
        "workspace2-figure-upload-btn"
    );

    uploadButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        uploadFigure(event);
    });
}

async function loadFiguresManagerData() {
    if (workspace2Loading) {
        return;
    }

    workspace2Loading = true;

    const figureList = document.getElementById(
        "workspace2-figure-manager-list"
    );

    if (figureList) {
        figureList.textContent = "Loading figures...";
    }

    try {
        const [figuresResponse, sectionsResponse] = await Promise.all([
            fetch(
                `${FIGURES_API_BASE_URL}/projects/${workspace2ProjectId}/figures`
            ),
            fetch(
                `${FIGURES_API_BASE_URL}/projects/${workspace2ProjectId}/sections`
            )
        ]);

        if (!figuresResponse.ok) {
            throw new Error("Could not load existing figures.");
        }

        if (!sectionsResponse.ok) {
            throw new Error("Could not load document sections.");
        }

        const figuresData = await figuresResponse.json();
        const sectionsData = await sectionsResponse.json();

        workspace2Figures = Array.isArray(figuresData.figures)
            ? figuresData.figures
            : [];

        const savedSections = sectionsData.sections;

        workspace2Sections =
            savedSections &&
                typeof savedSections === "object" &&
                !Array.isArray(savedSections)
                ? Object.keys(savedSections)
                : Array.isArray(savedSections)
                    ? savedSections
                    : [];

        populateFigureSections();
        renderExistingFigures();
        updateFigureSummary();
    } catch (error) {
        console.error("Figure manager loading error:", error);

        const currentFigureList = document.getElementById(
            "workspace2-figure-manager-list"
        );

        if (currentFigureList) {
            currentFigureList.textContent =
                "Unable to load figures. Check that the backend is running.";
        }
    } finally {
        workspace2Loading = false;
    }
}

function populateFigureSections() {
    const sectionSelect = document.getElementById(
        "workspace2-figure-section"
    );

    if (!sectionSelect) {
        return;
    }

    sectionSelect.replaceChildren();

    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "General / Unassigned";
    sectionSelect.appendChild(defaultOption);

    workspace2Sections.forEach(section => {
        let sectionName = "";

        if (typeof section === "string") {
            sectionName = section;
        } else if (section && typeof section === "object") {
            sectionName =
                section.title ||
                section.name ||
                section.heading ||
                "";
        }

        if (!sectionName) {
            return;
        }

        const option = document.createElement("option");
        option.value = sectionName;
        option.textContent = sectionName;

        sectionSelect.appendChild(option);
    });
}

function renderExistingFigures() {
    const figureList = document.getElementById(
        "workspace2-figure-manager-list"
    );

    if (!figureList) {
        return;
    }

    figureList.replaceChildren();

    if (workspace2Figures.length === 0) {
        figureList.textContent = "No figures have been added yet.";
        return;
    }

    workspace2Figures.forEach((figure, index) => {
        const card = document.createElement("div");
        card.className = "figure-manager-item";

        const cardHeader = document.createElement("div");
        cardHeader.className = "figure-manager-item-header";

        const caption = document.createElement("h4");
        caption.textContent = figure.caption || `Figure ${index + 1}`;

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "figure-manager-delete-btn";
        deleteButton.textContent = "❌";
        deleteButton.title = "Delete figure";
        deleteButton.setAttribute(
            "aria-label",
            `Delete ${figure.caption || `Figure ${index + 1}`}`
        );

        deleteButton.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            deleteFigure(index, deleteButton);
        });

        cardHeader.append(caption, deleteButton);
        card.appendChild(cardHeader);

        if (figure.image_url) {
            const image = document.createElement("img");

            image.src = figure.image_url;
            image.alt = figure.caption || `Figure ${index + 1}`;
            image.loading = "lazy";
            image.className = "figure-manager-preview";

            image.addEventListener("error", () => {
                image.alt = "Image preview unavailable";
            });

            card.appendChild(image);
        }

        const section = document.createElement("p");
        section.textContent = `Section: ${figure.section || "Unassigned"}`;
        card.appendChild(section);

        figureList.appendChild(card);
    });
}

function updateFigureSummary() {
    if (!figuresManagerSummary) {
        return;
    }

    const count = workspace2Figures.length;

    figuresManagerSummary.textContent =
        count === 0
            ? "No figures added yet."
            : `${count} figure${count === 1 ? "" : "s"} added.`;
}

async function uploadFigure(event) {
    event.preventDefault();
    event.stopPropagation();

    if (workspace2UploadInProgress || workspace2Loading) {
        return;
    }

    const imageInput = document.getElementById(
        "workspace2-figure-image"
    );

    const captionInput = document.getElementById(
        "workspace2-figure-caption"
    );

    const sectionInput = document.getElementById(
        "workspace2-figure-section"
    );

    const uploadButton = document.getElementById(
        "workspace2-figure-upload-btn"
    );

    const message = document.getElementById(
        "workspace2-figure-manager-message"
    );

    if (!imageInput || !captionInput || !sectionInput || !uploadButton || !message) {
        return;
    }

    const image = imageInput.files[0];
    const caption = captionInput.value.trim();
    const section = sectionInput.value;

    if (!image || !caption) {
        message.textContent = "Please select an image and enter a caption.";
        return;
    }

    const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif"
    ];

    if (!allowedTypes.includes(image.type)) {
        message.textContent =
            "Please select a JPG, PNG, WEBP, or GIF image.";
        return;
    }

    if (image.size > FIGURES_MAX_IMAGE_SIZE) {
        message.textContent = "The image must not exceed 5 MB.";
        return;
    }

    workspace2UploadInProgress = true;
    uploadButton.disabled = true;
    uploadButton.textContent = "Uploading...";
    message.textContent = "Uploading image...";

    try {
        const formData = new FormData();
        formData.append("image", image);

        const uploadResponse = await fetch(
            `${FIGURES_API_BASE_URL}/projects/${workspace2ProjectId}/figures/upload`,
            {
                method: "POST",
                body: formData
            }
        );

        const uploadData = await uploadResponse.json();

        if (!uploadResponse.ok) {
            throw new Error(
                uploadData.detail || "Image upload failed."
            );
        }

        if (!uploadData.image_url) {
            throw new Error("The server did not return an image URL.");
        }

        const newFigure = {
            id:
                typeof crypto !== "undefined" &&
                    typeof crypto.randomUUID === "function"
                    ? crypto.randomUUID()
                    : `figure-${Date.now()}`,
            caption,
            image_url: uploadData.image_url,
            section
        };

        const updatedFigures = [...workspace2Figures, newFigure];

        const saveResponse = await fetch(
            `${FIGURES_API_BASE_URL}/projects/${workspace2ProjectId}/figures`,
            {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    figures: updatedFigures
                })
            }
        );

        const saveData = await saveResponse.json();

        if (!saveResponse.ok) {
            throw new Error(
                saveData.detail || "Could not save the figure."
            );
        }

        workspace2Figures = updatedFigures;

        renderExistingFigures();
        updateFigureSummary();

        imageInput.value = "";
        captionInput.value = "";
        sectionInput.value = "";

        message.textContent = "Figure uploaded and saved successfully.";
    } catch (error) {
        console.error("Figure upload error:", error);

        const currentMessage = document.getElementById(
            "workspace2-figure-manager-message"
        );

        if (currentMessage) {
            currentMessage.textContent =
                error.message || "Something went wrong while uploading.";
        }
    } finally {
        workspace2UploadInProgress = false;

        const currentUploadButton = document.getElementById(
            "workspace2-figure-upload-btn"
        );

        if (currentUploadButton) {
            currentUploadButton.disabled = false;
            currentUploadButton.textContent = "Upload Figure";
        }
    }
}

function showFigureDeleteModal(figureCaption) {
    return new Promise((resolve) => {
        const existingModal = document.getElementById("figure-delete-modal");

        if (existingModal) {
            existingModal.remove();
        }

        const overlay = document.createElement("div");
        overlay.id = "figure-delete-modal";

        Object.assign(overlay.style, {
            position: "fixed",
            inset: "0",
            background: "rgba(20, 38, 29, 0.58)",
            backdropFilter: "blur(5px)",
            WebkitBackdropFilter: "blur(5px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: "99999",
            opacity: "0",
            transition: "opacity 180ms ease",
            padding: "20px"
        });

        const modal = document.createElement("div");

        Object.assign(modal.style, {
            width: "100%",
            maxWidth: "420px",
            background: "#f8faf8",
            border: "1px solid #c7d5ca",
            borderRadius: "18px",
            padding: "28px",
            boxShadow: "0 24px 65px rgba(15, 35, 23, 0.28)",
            transform: "translateY(12px) scale(0.97)",
            transition: "transform 200ms ease",
            fontFamily: "inherit",
            boxSizing: "border-box"
        });

        const heading = document.createElement("h3");
        heading.textContent = "Delete Figure?";

        Object.assign(heading.style, {
            margin: "0 0 12px",
            color: "#20372b",
            fontSize: "21px",
            fontWeight: "700",
            letterSpacing: "-0.3px"
        });

        const message = document.createElement("p");
        message.textContent = `Are you sure you want to delete "${figureCaption}"? This action cannot be undone.`;

        Object.assign(message.style, {
            margin: "0 0 26px",
            color: "#46594c",
            fontSize: "14px",
            lineHeight: "1.7",
            overflowWrap: "anywhere"
        });

        const buttonContainer = document.createElement("div");

        Object.assign(buttonContainer.style, {
            display: "flex",
            justifyContent: "flex-end",
            gap: "12px",
            flexWrap: "wrap"
        });

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.textContent = "Cancel";

        Object.assign(cancelButton.style, {
            padding: "10px 19px",
            border: "1px solid #9aafa0",
            borderRadius: "9px",
            background: "#e8eee9",
            color: "#263d2e",
            fontSize: "14px",
            fontWeight: "600",
            cursor: "pointer",
            transition: "background 160ms ease, border-color 160ms ease, transform 160ms ease"
        });

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.textContent = "Delete";

        Object.assign(deleteButton.style, {
            padding: "10px 21px",
            border: "1px solid #2f6b4c",
            borderRadius: "9px",
            background: "#367653",
            color: "#ffffff",
            fontSize: "14px",
            fontWeight: "700",
            cursor: "pointer",
            boxShadow: "0 3px 8px rgba(31, 82, 53, 0.18)",
            transition: "background 160ms ease, box-shadow 160ms ease, transform 160ms ease"
        });

        cancelButton.addEventListener("mouseenter", () => {
            cancelButton.style.background = "#dce6de";
            cancelButton.style.borderColor = "#718d79";
            cancelButton.style.transform = "translateY(-3px) scale(1.04)";
            cancelButton.style.boxShadow = "0 8px 18px rgba(31, 82, 53, 0.2)";
        });

        cancelButton.addEventListener("mouseleave", () => {
            cancelButton.style.background = "#e8eee9";
            cancelButton.style.borderColor = "#9aafa0";
            cancelButton.style.transform = "translateY(0) scale(1)";
            cancelButton.style.boxShadow = "none";
        });

        cancelButton.addEventListener("mousedown", () => {
            cancelButton.style.transform = "scale(0.97)";
        });

        cancelButton.addEventListener("mouseup", () => {
            cancelButton.style.transform = "translateY(0)";
        });

        deleteButton.addEventListener("mouseenter", () => {
            deleteButton.style.background = "#285b3f";
            deleteButton.style.transform = "translateY(-3px) scale(1.04)";
            deleteButton.style.boxShadow = "0 8px 18px rgba(31, 82, 53, 0.3)";
        });

        deleteButton.addEventListener("mouseleave", () => {
            deleteButton.style.background = "#367653";
            deleteButton.style.transform = "translateY(0) scale(1)";
            deleteButton.style.boxShadow = "0 3px 8px rgba(31, 82, 53, 0.18)";
        });

        deleteButton.addEventListener("mousedown", () => {
            deleteButton.style.transform = "translateY(0) scale(0.97)";
        });

        deleteButton.addEventListener("mouseup", () => {
            deleteButton.style.transform = "translateY(-3px) scale(1.04)";
        });

        function closeModal(result) {
            overlay.style.opacity = "0";
            modal.style.transform = "translateY(12px) scale(0.97)";

            setTimeout(() => {
                overlay.remove();
                resolve(result);
            }, 180);
        }

        cancelButton.addEventListener("click", () => closeModal(false));

        deleteButton.addEventListener("click", () => closeModal(true));

        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) {
                closeModal(false);
            }
        });

        modal.appendChild(heading);
        modal.appendChild(message);
        buttonContainer.appendChild(cancelButton);
        buttonContainer.appendChild(deleteButton);
        modal.appendChild(buttonContainer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        requestAnimationFrame(() => {
            overlay.style.opacity = "1";
            modal.style.transform = "translateY(0) scale(1)";
        });

        function handleEscape(event) {
            if (event.key === "Escape" && document.body.contains(overlay)) {
                document.removeEventListener("keydown", handleEscape);
                closeModal(false);
            }
        }

        document.addEventListener("keydown", handleEscape);
    });
}

async function deleteFigure(index, deleteButton) {
    if (workspace2Loading || workspace2UploadInProgress) {
        return;
    }

    const figure = workspace2Figures[index];

    if (!figure) {
        return;
    }

    const confirmed = await showFigureDeleteModal(
        figure.caption || `Figure ${index + 1}`
    );

    if (!confirmed) {
        return;
    }

    workspace2Loading = true;
    deleteButton.disabled = true;

    const message = document.getElementById(
        "workspace2-figure-manager-message"
    );

    if (message) {
        message.textContent = "Deleting figure...";
    }

    const previousFigures = [...workspace2Figures];

    const updatedFigures = workspace2Figures.filter(
        (_, figureIndex) => figureIndex !== index
    );

    try {
        const response = await fetch(
            `${FIGURES_API_BASE_URL}/projects/${workspace2ProjectId}/figures`,
            {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    figures: updatedFigures
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.detail || "Could not delete the figure."
            );
        }

        workspace2Figures = updatedFigures;

        renderExistingFigures();
        updateFigureSummary();

        const currentMessage = document.getElementById(
            "workspace2-figure-manager-message"
        );

        if (currentMessage) {
            currentMessage.textContent = "Figure deleted successfully.";
        }
    } catch (error) {
        console.error("Figure deletion error:", error);

        workspace2Figures = previousFigures;
        renderExistingFigures();
        updateFigureSummary();

        const currentMessage = document.getElementById(
            "workspace2-figure-manager-message"
        );

        if (currentMessage) {
            currentMessage.textContent =
                error.message || "Unable to delete the figure.";
        }
    } finally {
        workspace2Loading = false;
    }
}

document.addEventListener("DOMContentLoaded", initializeFiguresManager);

