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
        tableStudioPreview.innerHTML = `             <div class="table-studio-empty-preview">                 <h3>Your table will appear here</h3>                 <p>Create a preview to get started.</p>             </div>
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
        throw new Error("The project ID is missing or invalid. Return to your workspace and open Table Studio again.");
    }

    const data = await tableStudioRequest(
        `/projects/${tableStudioProjectId}/research`
    );

    const research = data.research || data.project || data;

    tableStudioProjectName.textContent =
        research.project_name ||
        research.name ||
        research.title ||
        "Research Project";

    const workspaceLink = document.querySelector(".table-studio-back");

    if (workspaceLink) {
        workspaceLink.href =
            `workspace.html?id=${encodeURIComponent(tableStudioProjectId)}`;
    }

    const documentType =
        research.document_type ||
        research.documentType ||
        data.document_type ||
        "";

    if (documentType) {
        try {
            const sectionData = await tableStudioRequest(
                `/projects/${tableStudioProjectId}/sections?document_type=${encodeURIComponent(documentType)}`
            );

            const sections = sectionData.sections || sectionData;

            if (Array.isArray(sections)) {
                tableStudioSections = sections.map(section =>
                    typeof section === "string"
                        ? section
                        : section.name || section.title || ""
                ).filter(Boolean);
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

            if (!window.confirm(`Delete "${table.caption || "this table"}"?`)) {
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
                tableStudioMessage(`Unable to delete table: ${error.message}`, true);
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
        const columnCount = Math.max(1, ...tableStudioRows.map(row => row.length));
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
    const columnCount = Math.max(0, ...tableStudioRows.map(row => row.length));

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
        tableStudioMessage("Create a table with at least one row and one column.", true);
        return;
    }

    if (tableStudioRows.some(row => row.length !== tableStudioRows[0].length)) {
        tableStudioMessage("Every row must have the same number of columns.", true);
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
    t