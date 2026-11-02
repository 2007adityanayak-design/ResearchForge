const INDEX_SECTIONS = {
    "List of Figures": {
        key: "figures",
        heading: "Saved Figures",
        description: "Automatically generated from figures saved in Figure Studio.",
        empty: "No figures saved yet. Add figures through Figure Studio."
    },
    "List of Tables": {
        key: "tables",
        heading: "Saved Tables",
        description: "Automatically generated from tables saved in Table Studio.",
        empty: "No tables saved yet. Add tables through Table Studio."
    }
};

function addAssetIndexStyles() {
    if (document.getElementById("document-asset-index-styles")) return;

    const style = document.createElement("style");
    style.id = "document-asset-index-styles";
    style.textContent = `
        .document-asset-index {
            width: 100%;
            max-width: 900px;
            margin: 28px auto;
            padding: 28px;
            box-sizing: border-box;
            background: #ffffff;
            border: 1px solid #dce7e7;
            border-radius: 16px;
            box-shadow: 0 5px 20px rgba(20, 70, 75, 0.06);
        }

        .document-asset-index-heading {
            margin: 0 0 22px;
            color: #174b50;
            font-size: 19px;
            font-weight: 700;
        }

        .document-asset-index-list {
            display: grid;
            gap: 12px;
            padding: 0;
            margin: 0;
            list-style: none;
            counter-reset: asset;
        }

        .document-asset-index-entry {
            counter-increment: asset;
            display: flex;
            align-items: center;
            gap: 16px;
            min-height: 65px;
            padding: 14px 18px;
            background: #f5fafa;
            border: 1px solid #e0ebeb;
            border-radius: 12px;
            box-sizing: border-box;
            transition: border-color 0.2s, transform 0.2s;
        }

        .document-asset-index-entry:hover {
            border-color: #83bdbb;
            transform: translateY(-1px);
        }

        .document-asset-index-entry::before {
            content: counter(asset);
            display: flex;
            align-items: center;
            justify-content: center;
            flex: 0 0 36px;
            width: 36px;
            height: 36px;
            border-radius: 10px;
            background: #d9efed;
            color: #087b7e;
            font-size: 15px;
            font-weight: 700;
        }

        .document-asset-index-entry-content {
            flex: 1;
            min-width: 0;
        }

        .document-asset-index-caption {
            display: block;
            color: #243f43;
            font-size: 15px;
            font-weight: 600;
            line-height: 1.5;
            overflow-wrap: anywhere;
        }

        .document-asset-index-section {
            display: block;
            margin-top: 4px;
            color: #718588;
            font-size: 12px;
        }

        .document-asset-index-empty {
            padding: 20px;
            border: 1px dashed #cbdcdb;
            border-radius: 12px;
            background: #f7fafa;
            color: #667c7d;
            text-align: center;
        }

        @media (max-width: 600px) {
            .document-asset-index {
                padding: 18px;
            }

            .document-asset-index-entry {
                padding: 12px;
            }
        }
    `;

    document.head.appendChild(style);
}

function renderAssetIndex(detail) {
    if (!detail) return;

    const { section, editorView, editor } = detail;
    const config = INDEX_SECTIONS[section];

    if (!config || !editorView || !editor) return;

    const workspace = window.ResearchForgeWorkspace;
    if (!workspace) return;

    addAssetIndexStyles();

    editor.readOnly = true;
    editor.hidden = true;
    editor.style.display = "none";

    const description = editorView.querySelector(
        ".document-section-editor-description"
    );

    if (description) {
        description.textContent = config.description;
    }

    const footer = editorView.querySelector(
        ".document-section-editor-footer"
    );

    const generationDetails = editorView.querySelector(
        ".ai-generation-details"
    );

    if (footer) footer.hidden = true;
    if (generationDetails) generationDetails.hidden = true;

    editorView.querySelectorAll(".document-section-status").forEach(element => {
        element.hidden = true;
    });

    editorView.querySelectorAll(".document-section-editor-toolbar button")
        .forEach(button => {
            if (/generate/i.test(button.textContent)) {
                button.hidden = true;
            }
        });

    const saveButton = editorView.querySelector(
        ".document-section-editor-footer button"
    );

    if (saveButton) saveButton.hidden = true;

    let container = editorView.querySelector(".document-asset-index");

    if (!container) {
        container = document.createElement("section");
        container.className = "document-asset-index";
        editorView.insertBefore(container, editor);
    }

    const records = config.key === "figures"
        ? workspace.documentFigures
        : workspace.documentTables;

    const savedRecords = Array.isArray(records)
        ? records.filter(item =>
            item &&
            typeof item.caption === "string" &&
            item.caption.trim().length > 0
        )
        : [];

    const heading = document.createElement("h3");
    heading.className = "document-asset-index-heading";
    heading.textContent = config.heading;

    container.replaceChildren(heading);

    if (savedRecords.length === 0) {
        const empty = document.createElement("p");
        empty.className = "document-asset-index-empty";
        empty.textContent = config.empty;
        container.appendChild(empty);
        return;
    }

    const list = document.createElement("ol");
    list.className = "document-asset-index-list";

    savedRecords.forEach(item => {
        const entry = document.createElement("li");
        entry.className = "document-asset-index-entry";

        const content = document.createElement("div");
        content.className = "document-asset-index-entry-content";

        const caption = document.createElement("span");
        caption.className = "document-asset-index-caption";
        caption.textContent = item.caption.trim();
        content.appendChild(caption);

        if (typeof item.section === "string" && item.section.trim()) {
            const association = document.createElement("small");
            association.className = "document-asset-index-section";
            association.textContent = item.section.trim();
            content.appendChild(association);
        }

        entry.appendChild(content);
        list.appendChild(entry);
    });

    container.appendChild(list);
}

window.addEventListener("researchforge:section-editor-opened", event => {
    renderAssetIndex(event.detail);
});

window.addEventListener("pageshow", async () => {
    const workspace = window.ResearchForgeWorkspace;
    if (!workspace) return;

    const section = workspace.currentSectionEditor;
    if (!INDEX_SECTIONS[section]) return;

    try {
        await workspace.refreshDocumentAssets();

        const editorView = document.querySelector(
            ".document-section-editor-view"
        );

        const editor = editorView?.querySelector(
            ".document-section-editor"
        );

        if (editorView && editor) {
            renderAssetIndex({ section, editorView, editor });
        }
    } catch (error) {
        console.error("Unable to refresh document asset indexes:", error);
    }
});
