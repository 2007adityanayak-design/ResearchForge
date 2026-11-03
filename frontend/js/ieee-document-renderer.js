(() => {
    "use strict";

    const ROMAN = [
        "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
        "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"
    ];

    const SECTION_ORDER = [
        "Introduction",
        "Related Work",
        "Methodology",
        "Proposed Approach",
        "Experimental Setup",
        "Results and Discussion",
        "Limitations and Discussion",
        "Conclusion",
        "References"
    ];

    function element(tag, className, text) {
        const node = document.createElement(tag);

        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;

        return node;
    }

    function normalize(value) {
        return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
    }

    function orderedSections(sections) {
        const names = Object.keys(sections);
        const used = new Set();
        const result = [];

        for (const preferred of SECTION_ORDER) {
            const match = names.find(
                name => normalize(name) === normalize(preferred)
            );

            if (match) {
                result.push(match);
                used.add(match);
            }
        }

        for (const name of names) {
            if (
                !used.has(name) &&
                !["title and authors", "abstract", "keywords",
                  "title page, authors, and abstract"].includes(normalize(name))
            ) {
                result.push(name);
            }
        }

        return result;
    }

    function renderText(container, value) {
        container.replaceChildren();

        const lines = String(value || "").replace(/\r\n/g, "\n").split("\n");
        let paragraph = [];
        let list = null;

        function flushParagraph() {
            if (!paragraph.length) return;

            const p = element("p", "ieee-paragraph");
            p.textContent = paragraph.join(" ");
            container.appendChild(p);
            paragraph = [];
        }

        function flushList() {
            if (list) {
                container.appendChild(list);
                list = null;
            }
        }

        for (const rawLine of lines) {
            const line = rawLine.trim();

            if (!line) {
                flushParagraph();
                flushList();
                continue;
            }

            const headingMatch = line.match(/^#{1,3}\s+(.+)$/);

            if (headingMatch) {
                flushParagraph();
                flushList();
                container.appendChild(element("h4", "ieee-subheading", headingMatch[1]));
                continue;
            }

            const numberedMatch = line.match(/^\d+[\.\)]\s+(.+)$/);
            const bulletMatch = line.match(/^[-*•]\s+(.+)$/);

            if (numberedMatch || bulletMatch) {
                flushParagraph();

                const isNumbered = Boolean(numberedMatch);
                const tag = isNumbered ? "ol" : "ul";

                if (!list || list.tagName.toLowerCase() !== tag) {
                    flushList();
                    list = element(tag, "ieee-content-list");
                }

                list.appendChild(element("li", "", (numberedMatch || bulletMatch)[1]));
                continue;
            }

            flushList();
            paragraph.push(line);
        }

        flushParagraph();
        flushList();
    }

    function createSectionEditor(name, content, options) {
        const article = element("article", "ieee-section");
        article.id = options.id;

        const heading = element("h2", "ieee-section-heading", name);
        const display = element("div", "ieee-section-text");
        const editor = element("textarea", "ieee-section-editor");
        const actions = element("div", "ieee-section-actions");
        const editButton = element("button", "ieee-edit-section", "Edit section");
        const doneButton = element("button", "ieee-done-section", "Finish editing");

        editor.value = content || "";
        editor.setAttribute("aria-label", `Edit ${name}`);
        editor.spellcheck = true;
        editor.hidden = true;
        doneButton.hidden = true;

        renderText(display, content);

        editButton.type = "button";
        doneButton.type = "button";

        editButton.addEventListener("click", () => {
            display.hidden = true;
            editor.hidden = false;
            editButton.hidden = true;
            doneButton.hidden = false;
            editor.focus();
        });

        doneButton.addEventListener("click", () => {
            display.hidden = false;
            editor.hidden = true;
            editButton.hidden = false;
            doneButton.hidden = true;
            renderText(display, editor.value);
        });

        editor.addEventListener("input", () => {
            options.onInput(name, editor.value);
        });

        actions.append(editButton, doneButton);
        article.append(heading, display, editor, actions);

        return article;
    }

    function renderAssetIndex(title, assets, prefix) {
        const section = element("section", "ieee-asset-index");
        section.appendChild(element("h2", "ieee-index-heading", title));

        if (!assets.length) {
            section.appendChild(element("p", "ieee-index-empty", `No ${title.toLowerCase()} saved.`));
            return section;
        }

        const list = element("ol", "ieee-index-list");

        assets.forEach((asset, index) => {
            const label = prefix === "Fig."
                ? `Fig. ${index + 1}. `
                : `TABLE ${ROMAN[index] || index + 1}: `;

            list.appendChild(element("li", "", label + (asset.caption || "Untitled")));
        });

        section.appendChild(list);
        return section;
    }

    function parseTableContent(content) {
        try {
            const parsed = typeof content === "string" ? JSON.parse(content) : content;

            if (parsed && Array.isArray(parsed.rows)) {
                return parsed.rows;
            }
        } catch (error) {
            console.warn("Unable to parse saved table content:", error);
        }

        return [];
    }

    function renderTable(table, index) {
        const figure = element("figure", "ieee-table-figure");
        figure.appendChild(
            element("div", "ieee-table-number", `TABLE ${ROMAN[index] || index + 1}`)
        );
        figure.appendChild(element("figcaption", "ieee-table-caption", table.caption || "Untitled table"));

        const rows = parseTableContent(table.content);
        const wrapper = element("div", "ieee-table-scroll");
        const htmlTable = element("table", "ieee-data-table");
        const body = element("tbody");

        rows.forEach((row, rowIndex) => {
            const tr = element("tr");

            (Array.isArray(row) ? row : []).forEach(value => {
                const cell = element(rowIndex === 0 ? "th" : "td");
                cell.textContent = String(value ?? "");
                tr.appendChild(cell);
            });

            body.appendChild(tr);
        });

        htmlTable.appendChild(body);
        wrapper.appendChild(htmlTable);
        figure.appendChild(wrapper);

        if (table.description) {
            figure.appendChild(element("p", "ieee-asset-description", table.description));
        }

        return figure;
    }

    function renderFigure(figure, index) {
        const wrapper = element("figure", "ieee-image-figure");
        const image = element("img", "ieee-paper-image");

        image.src = figure.image_url || "";
        image.alt = figure.description || figure.caption || `Figure ${index + 1}`;
        image.loading = "lazy";

        image.addEventListener("error", () => {
            image.replaceWith(element("div", "ieee-image-unavailable", "Figure image could not be loaded."));
        });

        wrapper.appendChild(image);
        wrapper.appendChild(
            element("figcaption", "ieee-figure-caption", `Fig. ${index + 1}. ${figure.caption || "Untitled figure"}`)
        );

        if (figure.description) {
            wrapper.appendChild(element("p", "ieee-asset-description", figure.description));
        }

        return wrapper;
    }

    function render(config) {
        const {
            preview,
            outline,
            project,
            sections,
            figures = [],
            tables = [],
            onInput = () => {}
        } = config;

        preview.replaceChildren();
        outline.replaceChildren();

        const title = project.project_name || project.name || "Untitled Research Paper";
        const author = project.author_name || "";
        const affiliation = [
            project.department,
            project.institution
        ].filter(Boolean).join(", ");

        const titleBlock = element("header", "ieee-title-block");
        titleBlock.appendChild(element("h1", "ieee-paper-title", title));

        if (author) {
            titleBlock.appendChild(element("p", "ieee-author-name", author));
        }

        if (affiliation) {
            titleBlock.appendChild(element("p", "ieee-affiliation", affiliation));
        }

        preview.appendChild(titleBlock);

        const abstractName = Object.keys(sections).find(
            name => normalize(name) === "abstract"
        );

        if (abstractName) {
            const abstract = element("section", "ieee-abstract");
            abstract.appendChild(element("h2", "ieee-frontmatter-heading", "Abstract—"));
            renderText(abstract, sections[abstractName]);
            preview.appendChild(abstract);
        }

        const keywordName = Object.keys(sections).find(
            name => normalize(name) === "keywords"
        );

        if (keywordName) {
            const keywords = element("section", "ieee-keywords");
            keywords.appendChild(element("strong", "", "Index Terms— "));
            keywords.appendChild(element("span", "", sections[keywordName]));
            preview.appendChild(keywords);
        }

        const body = element("div", "ieee-paper-body");
        const ordered = orderedSections(sections);
        const figuresBySection = new Map();
        const tablesBySection = new Map();

        figures.forEach((figure, index) => {
            const key = normalize(figure.section);
            if (!figuresBySection.has(key)) figuresBySection.set(key, []);
            figuresBySection.get(key).push({ ...figure, _index: index });
        });

        tables.forEach((table, index) => {
            const key = normalize(table.section);
            if (!tablesBySection.has(key)) tablesBySection.set(key, []);
            tablesBySection.get(key).push({ ...table, _index: index });
        });

        const numberedFigures = figures.map((asset, index) => ({ ...asset, _index: index }));
        const numberedTables = tables.map((asset, index) => ({ ...asset, _index: index }));

        body.appendChild(renderAssetIndex("List of Figures", numberedFigures, "Fig."));
        body.appendChild(renderAssetIndex("List of Tables", numberedTables, "TABLE"));

        ordered.forEach((name, index) => {
            const id = `ieee-section-${index}`;
            const article = createSectionEditor(name, sections[name], {
                id,
                onInput
            });

            article.querySelector(".ieee-section-heading").textContent =
                `${ROMAN[index] || index + 1}. ${name.toUpperCase()}`;

            body.appendChild(article);

            const sectionFigures = figuresBySection.get(normalize(name)) || [];
            sectionFigures.forEach(figure => {
                body.appendChild(renderFigure(figure, figure._index));
            });

            const sectionTables = tablesBySection.get(normalize(name)) || [];
            sectionTables.forEach(table => {
                body.appendChild(renderTable(table, table._index));
            });

            const link = element("a", "document-outline-link", name);
            link.href = `#${id}`;

            link.addEventListener("click", () => {
                outline.querySelectorAll(".document-outline-link").forEach(item => {
                    item.classList.remove("active");
                });

                link.classList.add("active");
                article.scrollIntoView({ behavior: "smooth", block: "start" });
                article.querySelector(".ieee-edit-section").click();
            });

            outline.appendChild(link);
        });

        const unassignedFigures = figures.filter(figure => !normalize(figure.section));
        const unassignedTables = tables.filter(table => !normalize(table.section));

        if (unassignedFigures.length || unassignedTables.length) {
            const unassigned = element("section", "ieee-unassigned-assets");
            unassigned.appendChild(element("h2", "ieee-section-heading", "Unassigned Document Assets"));

            unassignedFigures.forEach(figure => {
                unassigned.appendChild(renderFigure(figure, figures.indexOf(figure)));
            });

            unassignedTables.forEach(table => {
                unassigned.appendChild(renderTable(table, tables.indexOf(table)));
            });

            body.appendChild(unassigned);
        }

        preview.appendChild(body);

        return {
            sectionCount: Object.keys(sections).length
        };
    }

    window.ResearchForgeIEEERenderer = { render };
})();
