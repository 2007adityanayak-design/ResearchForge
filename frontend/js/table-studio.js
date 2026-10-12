console.log("ResearchForge Table Studio loaded");

const TABLE_STUDIO_API = "http://127.0.0.1:8000";
const tableStudioParams = new URLSearchParams(window.location.search);
const tableStudioProjectId = tableStudioParams.get("id");

const tableStudioProjectName = document.getElementById("table-studio-project-name");
const tableStudioDescription = document.getElementById("studio-table-description");
const tableStudioCaption = document.getElementById("studio-table-caption");
const tableStudioSection = document.getElementById("studio-table-section");
const tableStudioPreview = document.getElementById("studio-table-preview");
const tableStudioSaved = document.getElementById("studio-saved-tables");
const tableStudioCount = document.getElementById("studio-table-count");
const tableStudioStatus = document.getElementById("studio-table-status");
const tableStudioFeedback = document.getElementById("studio-table-feedback");
const tableStudioSaveButton = document.getElementById("studio-save-table");

let tableStudioTables = [];
let tableStudioRows = [];
let tableStudioEditingId = null;
let tableStudioSections = [];

function tableStudioEscape(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

async function tableStudioRequest(path, options = {}) {
    const response = await fetch(`${TABLE_STUDIO_API}${path}`, {
        ...options,
        headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...options.headers
        }
    });

    const text = await response.text();
    let data = {};

    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = { detail: text };
        }
    }

    if (!response.ok) {
        throw new Error(
            data.detail || data.message || `Request failed with status ${response.status}`
        );
    }

    return data;
}

function tableStudioMessage(text, isError = false) {
    tableStudioFeedback.textContent = text;
    tableStudioFeedback.style.color = isError ? "#b42318" : "";
}

function tableStudioSetStatus(text) {
    tableStudioStatus.textContent = text;
}

function tableStudioResetRows() {
    tableStudioRows = [
        ["Column 1", "Column 2", "Column 3"],
        ["", "", ""],
        ["", "", ""]
    ];

    tableStudioEditingId = null;
    tableStudioDescription.value = "";
    tableStudioCaption.value = "";
    tableStudioSection.value = "";

    tableStudioRenderPreview();
    tableStudioSetStatus("Unsaved changes");
}

function tableStudioRenderPreview() {
    if (!tableStudioRows.length || !tableStudioRows[0]?.length) {
        tableStudioPreview.innerHTML = `
            <div class="table-studio-empty-preview">
                <h3>Your table will appear here</h3>
                <p>Create a preview to get started.</p>
            </div>
        `;
        return;
    }

    tableStudioPreview.innerHTML = `
        <table class="table-studio-grid">
            <tbody>
                ${tableStudioRows.map((row, rowIndex) => `
                    <tr>
                        ${row.map((cell, columnIndex) => `
                            <td>
                                <input
                                    type="text"
                                    value="${tableStudioEscape(cell)}"
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

    tableStudioPreview.querySelectorAll("input").forEach(input => {
        input.addEventListener("input", event => {
            const row = Number(event.target.dataset.row);
            const column = Number(event.target.dataset.column);

            tableStudioRows[row][column] = event.target.value;
            tableStudioSetStatus("Unsaved changes");
        });
    });
}

function tableStudioRenderSections() {
    const currentValue = tableStudioSection.value;

    tableStudioSection.innerHTML = `
        <option value="">General / Unassigned</option>
        ${tableStudioSections.map(section => `
            <option value="${tableStudioEscape(section)}">${tableStudioEscape(section)}</option>
        `).join("")}
    `;

    if (tableStudioSections.includes(currentValue)) {
        tableStudioSection.value = currentValue;
    }
}

function tableStudioParseRows(content) {
    if (typeof content !== "string") {
        return null;
    }

    try {
        const parsed = JSON.parse(content);

        if (
            parsed &&
            parsed.format === "researchforge-table-v1" &&
            Array.isArray(parsed.rows) &&
            parsed.rows.length &&
            parsed.rows.every(Array.isArray)
        ) {
            const rows = parsed.rows.map(row =>
                row.map(cell => String(cell ?? ""))
            );

            const width = Math.max(1, ...rows.map(row => row.length));

            return rows.map(row =>
                [...row, ...Array(Math.max(0, width - row.length)).fill("")]
            );
        }
    } catch {
        return null;
    }

    return null;
}

async function tableStudioLoadProject() {
    if (!tableStudioProjectId || !/^\d+$/.test(tableStudioProjectId)) {
        throw new Error(
            "The project ID is missing or invalid. Return to your workspace and open Table Studio again."
        );
    }

    const data = await tableStudioRequest(
        `/projects/${tableStudioProjectId}/research`
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

    tableStudioProjectName.textContent =
        projectName || `Project #${tableStudioProjectId}`;

    const workspaceLink = document.querySelector(".table-studio-back");

    if (workspaceLink) {
        workspaceLink.href =
            `workspace.html?id=${encodeURIComponent(tableStudioProjectId)}`;
    }

    const research = data?.research || data?.project || data;

    const documentType =
        research?.document_type ||
        research?.documentType ||
        data?.document_type ||
        "";

    if (documentType) {
        try {
            const sectionData = await tableStudioRequest(
                `/projects/${tableStudioProjectId}/sections?document_type=${encodeURIComponent(documentType)}`
            );

            const sections = sectionData.sections || sectionData;

            if (Array.isArray(sections)) {
                tableStudioSections = sections
                    .map(section =>
                        typeof section === "string"
                            ? section
                            : section.name || section.title || ""
                    )
                    .filter(Boolean);
            }
        } catch (error) {
            console.warn("Unable to load document sections:", error);
        }
    }

    tableStudioRenderSections();
}

async function tableStudioLoadTables() {
    const data = await tableStudioRequest(
        `/projects/${tableStudioProjectId}/tables`
    );

    if (!Array.isArray(data.tables)) {
        throw new Error("The server returned invalid table data.");
    }

    tableStudioTables = data.tables.filter(
        table => table && typeof table === "object" && !Array.isArray(table)
    );

    tableStudioRenderSavedTables();
}

function tableStudioRenderSavedTables() {
    tableStudioCount.textContent =
        `${tableStudioTables.length} ${tableStudioTables.length === 1 ? "table" : "tables"}`;

    if (!tableStudioTables.length) {
        tableStudioSaved.innerHTML = `
            <div class="table-studio-empty-saved">
                No saved tables yet. Create your first table above.
            </div>
        `;
        return;
    }

    tableStudioSaved.innerHTML = tableStudioTables.map((table, index) => `
        <article class="table-studio-saved-item">
            <div>
                <h3>${tableStudioEscape(table.caption || `Table ${index + 1}`)}</h3>
                <p>${tableStudioEscape(table.section || "General / Unassigned")}</p>
                <small>${tableStudioEscape(table.description || "No description provided.")}</small>
            </div>
            <div class="table-studio-saved-actions">
                <button type="button" data-studio-edit="${index}">Edit</button>
                <button type="button" data-studio-delete="${index}">Delete</button>
            </div>
        </article>
    `).join("");

    tableStudioSaved.querySelectorAll("[data-studio-edit]").forEach(button => {
        button.addEventListener("click", () => {
            const table = tableStudioTables[Number(button.dataset.studioEdit)];

            if (!table) {
                return;
            }

            const parsedRows = tableStudioParseRows(table.content);

            if (!parsedRows) {
                tableStudioMessage(
                    "This saved table uses an older or unsupported format. It has not been changed.",
                    true
                );
                return;
            }

            tableStudioEditingId = table.id;
            tableStudioDescription.value = table.description || "";
            tableStudioCaption.value = table.caption || "";
            tableStudioSection.value = table.section || "";
            tableStudioRows = parsedRows;

            tableStudioRenderPreview();
            tableStudioSetStatus("Editing saved table");
            tableStudioMessage("Table loaded. Make your changes and click Save Table.");

            document.querySelector(".table-studio-editor").scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        });
    });

    tableStudioSaved.querySelectorAll("[data-studio-delete]").forEach(button => {
        button.addEventListener("click", async () => {
            const index = Number(button.dataset.studioDelete);
            const table = tableStudioTables[index];

            if (!table) {
                return;
            }

            const confirmed = await showTableDeleteModal(
                table.caption || "this table"
            );

            if (!confirmed) {
                return;
            }

            const previousTables = [...tableStudioTables];

            tableStudioTables = tableStudioTables.filter(
                (_, tableIndex) => tableIndex !== index
            );

            button.disabled = true;

            try {
                await tableStudioSaveAll();
                tableStudioRenderSavedTables();
                tableStudioMessage("Table deleted successfully.");
            } catch (error) {
                tableStudioTables = previousTables;
                tableStudioRenderSavedTables();
                tableStudioMessage(
                    `Unable to delete table: ${error.message}`,
                    true
                );
            }
        });
    });
}

async function tableStudioSaveAll() {
    await tableStudioRequest(
        `/projects/${tableStudioProjectId}/tables`,
        {
            method: "PUT",
            body: JSON.stringify({ tables: tableStudioTables })
        }
    );
}

document.getElementById("studio-create-preview").addEventListener("click", () => {
    const description = tableStudioDescription.value.trim();

    if (!description) {
        tableStudioMessage("Enter a table description first.", true);
        tableStudioDescription.focus();
        return;
    }

    const words = description
        .replace(/[.,!?;:]+/g, " ")
        .split(/\s+/)
        .filter(Boolean);

    const columns = words.filter(word => word.length > 2).slice(0, 3);

    tableStudioRows = [
        [
            columns[0] || "Column 1",
            columns[1] || "Column 2",
            columns[2] || "Column 3"
        ],
        ["", "", ""],
        ["", "", ""]
    ];

    if (!tableStudioCaption.value.trim()) {
        tableStudioCaption.value = description.length > 80
            ? `${description.slice(0, 77)}...`
            : description;
    }

    tableStudioRenderPreview();
    tableStudioSetStatus("Preview ready");
    tableStudioMessage("Preview created. Edit the cells before saving.");
});

document.getElementById("studio-add-row").addEventListener("click", () => {
    if (!tableStudioRows.length) {
        tableStudioRows = [[""]];
    } else {
        const columnCount = Math.max(
            1,
            ...tableStudioRows.map(row => row.length)
        );

        tableStudioRows.push(Array(columnCount).fill(""));
    }

    tableStudioRenderPreview();
    tableStudioSetStatus("Unsaved changes");
});

document.getElementById("studio-add-column").addEventListener("click", () => {
    if (!tableStudioRows.length) {
        tableStudioRows = [[""]];
    }

    tableStudioRows = tableStudioRows.map(row => [...row, ""]);

    tableStudioRenderPreview();
    tableStudioSetStatus("Unsaved changes");
});

document.getElementById("studio-remove-row").addEventListener("click", () => {
    if (tableStudioRows.length <= 1) {
        tableStudioMessage("A table must contain at least one row.", true);
        return;
    }

    tableStudioRows.pop();

    tableStudioRenderPreview();
    tableStudioSetStatus("Unsaved changes");
});

document.getElementById("studio-remove-column").addEventListener("click", () => {
    const columnCount = Math.max(
        0,
        ...tableStudioRows.map(row => row.length)
    );

    if (columnCount <= 1) {
        tableStudioMessage("A table must contain at least one column.", true);
        return;
    }

    tableStudioRows = tableStudioRows.map(row => row.slice(0, -1));

    tableStudioRenderPreview();
    tableStudioSetStatus("Unsaved changes");
});

document.getElementById("studio-reset-table").addEventListener("click", () => {
    tableStudioResetRows();
    tableStudioMessage("Editor reset.");
});

tableStudioSaveButton.addEventListener("click", async () => {
    const caption = tableStudioCaption.value.trim();
    const section = tableStudioSection.value;
    const description = tableStudioDescription.value.trim();

    if (!caption) {
        tableStudioMessage("Enter a table caption before saving.", true);
        tableStudioCaption.focus();
        return;
    }

    if (!tableStudioRows.length || !tableStudioRows[0]?.length) {
        tableStudioMessage(
            "Create a table with at least one row and one column.",
            true
        );
        return;
    }

    if (tableStudioRows.some(row => row.length !== tableStudioRows[0].length)) {
        tableStudioMessage(
            "Every row must have the same number of columns.",
            true
        );
        return;
    }

    const previousTables = [...tableStudioTables];

    const table = {
        id: tableStudioEditingId || (
            window.crypto?.randomUUID
                ? window.crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(16).slice(2)}`
        ),
        caption,
        section: tableStudioSections.includes(section) ? section : "",
        description,
        content: JSON.stringify({
            format: "researchforge-table-v1",
            rows: tableStudioRows
        })
    };

    const existingIndex = tableStudioEditingId
        ? tableStudioTables.findIndex(item => item.id === tableStudioEditingId)
        : -1;

    if (existingIndex >= 0) {
        tableStudioTables[existingIndex] = table;
    } else {
        tableStudioTables.push(table);
    }

    tableStudioSaveButton.disabled = true;

    try {
        await tableStudioSaveAll();

        tableStudioEditingId = null;

        tableStudioRenderSavedTables();
        tableStudioSetStatus("Saved successfully");
        tableStudioMessage("Table saved successfully.");
    } catch (error) {
        tableStudioTables = previousTables;

        tableStudioRenderSavedTables();
        tableStudioSetStatus("Save failed");

        tableStudioMessage(
            `Unable to save table: ${error.message}`,
            true
        );
    } finally {
        tableStudioSaveButton.disabled = false;
    }
});

async function tableStudioInitialize() {
    try {
        await tableStudioLoadProject();
        await tableStudioLoadTables();
    } catch (error) {
        console.error("Table Studio initialization failed:", error);

        if (tableStudioProjectName.textContent === "Loading project...") {
            tableStudioProjectName.textContent = "Unable to load project";
        }

        tableStudioMessage(
            `Unable to load the project: ${error.message}`,
            true
        );
    }
}

tableStudioInitialize();

function showTableDeleteModal(tableCaption) {
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
        heading.textContent = "Delete Table?";

        Object.assign(heading.style, {
            margin: "0 0 12px",
            color: "#20372b",
            fontSize: "21px",
            fontWeight: "700"
        });

        const message = document.createElement("p");
        message.textContent = `Are you sure you want to delete "${tableCaption}"? This action cannot be undone.`;

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