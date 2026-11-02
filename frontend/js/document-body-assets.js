(() => {
    const STYLE_ID = "document-body-assets-styles";
    const CONTAINER_CLASS = "document-body-assets";

    const INDEX_SECTIONS = new Set([
        "list of figures",
        "list of tables"
    ]);

    function normalizeSection(value) {
        return String(value || "").trim().toLowerCase();
    }

    function resolveImageUrl(value) {
        if (typeof value !== "string" || !value.trim()) {
            return "";
        }

        try {
            const workspace = window.ResearchForgeWorkspace;
            const baseUrl = workspace?.API_BASE_URL || window.location.origin;
            const parsed = new URL(value.trim(), baseUrl);

            if (!["http:", "https:"].includes(parsed.protocol)) {
                return "";
            }

            const allowedOrigins = [
                new URL(baseUrl).origin,
                window.location.origin
            ];

            return allowedOrigins.includes(parsed.origin) ? parsed.href : "";
        } catch {
            return "";
        }
    }

    function addStyles() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }

        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            .${CONTAINER_CLASS} {
                display: flex;
                flex-direction: column;
                gap: 24px;
                margin: 22px 0;
            }

            .document-body-asset {
                min-width: 0;
                padding: 20px;
                border: 1px solid var(--border-color, #d8e3df);
                border-radius: 12px;
                background: var(--card-bg, #ffffff);
            }

            .document-body-asset-label {
                margin: 0 0 14px;
                color: var(--text-secondary, #687b73);
                font-size: 12px;
                font-weight: 700;
                letter-spacing: .07em;
                text-transform: uppercase;
            }

            .document-body-figure {
                margin: 0;
                text-align: center;
            }

            .document-body-figure img {
                display: block;
                max-width: 100%;
                max-height: 620px;
                width: auto;
                height: auto;
                margin: 0 auto;
                object-fit: contain;
                border-radius: 8px;
            }

            .document-body-figure figcaption {
                margin-top: 14px;
                color: var(--text-primary, #263b33);
                font-size: 14px;
                font-weight: 700;
                line-height: 1.7;
                overflow-wrap: anywhere;
            }

            .document-body-figure-description {
                margin: 8px 0 0;
                color: var(--text-secondary, #687b73);
                font-size: 13px;
                line-height: 1.7;
                overflow-wrap: anywhere;
            }

            .document-body-image-error {
                padding: 24px;
                color: #a33a32;
                background: #fff4f2;
                border-radius: 8px;
                font-size: 13px;
            }

            .document-body-table-wrapper {
                width: 100%;
                overflow-x: auto;
            }

            .document-body-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 13px;
                line-height: 1.6;
            }

            .document-body-table th,
            .document-body-table td {
                min-width: 90px;
                padding: 10px 12px;
                border: 1px solid var(--border-color, #d8e3df);
                text-align: left;
                vertical-align: top;
                overflow-wrap: anywhere;
            }

            .document-body-table th {
                background: var(--table-header-bg, #eaf3ef);
                color: var(--text-primary, #263b33);
                font-weight: 700;
            }

            .document-body-table-caption {
                margin: 0 0 12px;
                color: var(--text-primary, #263b33);
                font-size: 14px;
                font-weight: 700;
                line-height: 1.7;
                overflow-wrap: anywhere;
            }

            @media (max-width: 700px) {
                .document-body-asset {
                    padding: 14px;
                }

                .document-body-table {
                    font-size: 12px;
                }
            }
        `;

        document.head.appendChild(style);
    }

    function createFigureCard(figure) {
        const card = document.createElement("article");
        card.className = "document-body-asset";

        const label = document.createElement("p");
        label.className = "document-body-asset-label";
        label.textContent = "Figure";

        const figureElement = document.createElement("figure");
        figureElement.className = "document-body-figure";

        const imageUrl = resolveImageUrl(figure.image_url);

        if (imageUrl) {
            const image = document.createElement("img");
            image.src = imageUrl;
            image.alt = figure.caption || "Research figure";
            image.loading = "lazy";

            image.addEventListener("error", () => {
                const error = document.createElement("div");
                error.className = "document-body-image-error";
                error.textContent = "This figure image could not be loaded.";
                image.replaceWith(error);
            }, { once: true });

            figureElement.appendChild(image);
        } else {
            const error = document.createElement("div");
            error.className = "document-body-image-error";
            error.textContent = "No valid image is available for this figure.";
            figureElement.appendChild(error);
        }

        const caption = document.createElement("figcaption");
        caption.textContent = figure.caption || "Untitled figure";
        figureElement.appendChild(caption);

        if (figure.description) {
            const description = document.createElement("p");
            description.className = "document-body-figure-description";
            description.textContent = figure.description;
            figureElement.appendChild(description);
        }

        card.append(label, figureElement);
        return card;
    }

    function parseTableRows(table) {
        if (Array.isArray(table.rows)) {
            return table.rows;
        }

        if (typeof table.content !== "string" || !table.content.trim()) {
            return [];
        }

        try {
            const parsed = JSON.parse(table.content);

            if (Array.isArray(parsed)) {
                return parsed;
            }

            return Array.isArray(parsed?.rows) ? parsed.rows : [];
        } catch {
            return [];
        }
    }

    function createTableCard(table) {
        const rows = parseTableRows(table)
            .filter(Array.isArray);

        if (!rows.length) {
            return null;
        }

        const card = document.createElement("article");
        card.className = "document-body-asset";

        const label = document.createElement("p");
        label.className = "document-body-asset-label";
        label.textContent = "Table";

        const caption = document.createElement("p");
        caption.className = "document-body-table-caption";
        caption.textContent = table.caption || "Untitled table";

        const wrapper = document.createElement("div");
        wrapper.className = "document-body-table-wrapper";

        const element = document.createElement("table");
        element.className = "document-body-table";

        const header = document.createElement("thead");
        const body = document.createElement("tbody");

        rows.forEach((row, rowIndex) => {
            const tr = document.createElement("tr");

            row.forEach(cell => {
                const cellElement = document.createElement(
                    rowIndex === 0 ? "th" : "td"
                );
                cellElement.textContent = String(cell ?? "");
                tr.appendChild(cellElement);
            });

            if (rowIndex === 0) {
                header.appendChild(tr);
            } else {
                body.appendChild(tr);
            }
        });

        if (header.childElementCount) {
            element.appendChild(header);
        }

        if (body.childElementCount) {
            element.appendChild(body);
        }

        wrapper.appendChild(element);
        card.append(label, caption, wrapper);

        if (table.description) {
            const description = document.createElement("p");
            description.className = "document-body-figure-description";
            description.textContent = table.description;
            card.appendChild(description);
        }

        return card;
    }

    function renderSectionAssets(detail) {
        const { section, editorView, editor } = detail || {};

        if (!section || !editorView || !editor) {
            return;
        }

        if (INDEX_SECTIONS.has(normalizeSection(section))) {
            return;
        }

        const workspace = window.ResearchForgeWorkspace;

        if (!workspace) {
            return;
        }

        editorView.querySelector(`.${CONTAINER_CLASS}`)?.remove();

        const figures = (workspace.documentFigures || []).filter(
            figure =>
                normalizeSection(figure.section) === normalizeSection(section)
        );

        const tables = (workspace.documentTables || []).filter(
            table =>
                normalizeSection(table.section) === normalizeSection(section)
        );

        if (!figures.length && !tables.length) {
            return;
        }

        addStyles();

        const container = document.createElement("div");
        container.className = CONTAINER_CLASS;
        container.setAttribute("aria-label", "Figures and tables for this section");

        figures.forEach(figure => {
            container.appendChild(createFigureCard(figure));
        });

        tables.forEach(table => {
            const card = createTableCard(table);

            if (card) {
                container.appendChild(card);
            }
        });

        if (container.childElementCount) {
            editor.insertAdjacentElement("afterend", container);
        }
    }

    window.addEventListener("researchforge:section-editor-opened", event => {
        renderSectionAssets(event.detail);
    });

    window.addEventListener("pageshow", () => {
        const editorView = document.querySelector(".document-section-editor-view");
        const editor = editorView?.querySelector(".document-section-editor");

        if (editorView && editor) {
            renderSectionAssets({
                section: editor.dataset.section,
                editorView,
                editor
            });
        }
    });
})();
