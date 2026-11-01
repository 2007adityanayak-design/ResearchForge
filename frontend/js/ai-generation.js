(() => {
async function getGenerationDocumentPlan() {
    const state = window.ResearchForgeWorkspace;
    if (
        state.cachedGenerationPlan &&
        state.cachedGenerationPlanProjectId === state.currentProjectId
    ) {
        return state.cachedGenerationPlan;
    }

    try {
        const response = await state.apiRequest(
            `${state.API_BASE_URL}/projects/${state.currentProjectId}/plan`,
            { method: "POST" },
            300000
        );

        const plan = response.plan ||
            response.document_plan ||
            response;

        state.cachedGenerationPlan = plan;
        state.cachedGenerationPlanProjectId = state.currentProjectId;

        return plan;
    } catch (error) {
        console.warn("Document plan unavailable:", error);
        return null;
    }
}


async function generateCurrentDocumentSection(
    section,
    editor,
    generateButton,
    generationStatus,
    generationDetails
) {
    const state = window.ResearchForgeWorkspace;
    if (
        !state.currentProjectId ||
        !editor ||
        state.navigationInProgress ||
        !state.currentEditorElements
    ) {
        return;
    }

    const existingContent = editor.value.trim();

    let generationMode = "fill_empty";

    if (existingContent) {
        const confirmed = await showRegenerationConfirmation(section);

        if (!confirmed) {
            return;
        }

        generationMode = "regenerate";
    }

    const {
        saveButton,
        backButton,
        navigationButtons,
        saveStatus
    } = state.currentEditorElements;

    state.navigationInProgress = true;

    generateButton.disabled = true;
    saveButton.disabled = true;
    backButton.disabled = true;
    editor.disabled = true;

    navigationButtons.forEach(button => {
        button.disabled = true;
    });

    if (state.sectionSidebarList) {
        state.sectionSidebarList.querySelectorAll("button").forEach(button => {
            button.disabled = true;
        });
    }

    generationStatus.hidden = false;
    generationStatus.className = "document-section-status research-save-warning";
    generationStatus.textContent =
        "Preparing your project information for AI generation...";

    generationDetails.replaceChildren();
    generationDetails.hidden = true;

    try {
        const saved = await state.saveSectionAndWait(
            section,
            editor,
            saveStatus
        );

        if (!saved) {
            throw new Error(
                "Your existing changes could not be saved. " +
                "Generation was stopped to protect your work."
            );
        }

        clearTimeout(state.sectionSaveTimers[section]);
        delete state.sectionSaveTimers[section];

        const documentPlan = await getGenerationDocumentPlan();

        if (
            !documentPlan ||
            !Array.isArray(documentPlan.recommended_sections) ||
            !Array.isArray(documentPlan.integrity_requirements) ||
            !Array.isArray(documentPlan.missing_information)
        ) {
            throw new Error(
                "A complete AI document plan could not be prepared. Generation stopped to protect factual accuracy."
            );
        }

        const plannedSections = documentPlan.recommended_sections;

        const plannedSection = plannedSections.find(item =>
            item &&
            (
                item.title?.trim().toLowerCase() === section.trim().toLowerCase() ||
                item.section_id?.trim().toLowerCase() === section.trim().toLowerCase()
            )
        );

        const sectionInstructions = plannedSection
            ? {
                ...plannedSection,
                section_id: section,
                title: section
            }
            : {
                section_id: section,
                title: section,
                purpose: "",
                key_points: [],
                source_fields: [],
                required_information: [],
                suggested_word_count: ""
            };

        generationStatus.textContent =
            "ResearchForge AI is generating your section. This may take several minutes...";

        const response = await state.apiRequest(
            `${state.API_BASE_URL}/projects/${state.currentProjectId}/generate-section`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    section: sectionInstructions,
                    document_plan: documentPlan,
                    previous_sections: {
                        ...state.documentSections,
                        [section]: ""
                    },
                    generation_mode: generationMode
                })
            },
            300000
        );

        if (
            !response ||
            response.section_id !== section ||
            typeof response.content !== "string" ||
            !response.content.trim()
        ) {
            throw new Error(
                "The AI returned an incomplete or invalid section."
            );
        }

        clearTimeout(state.sectionSaveTimers[section]);
        delete state.sectionSaveTimers[section];

        clearTimeout(state.sectionRetryTimers[section]);
        delete state.sectionRetryTimers[section];

        editor.value = response.content;
        state.documentSections[section] = response.content;

        const newVersion = (state.sectionVersions[section] || 0) + 1;

        state.sectionVersions[section] = newVersion;
        state.sectionSavedVersions[section] = newVersion;

        delete state.sectionSaveErrors[section];
        state.sectionRetryAttempts[section] = 0;

        state.saveLocalRecovery();
        state.clearLocalRecoveryIfSaved();

        if (state.currentEditorElements.updateWordCounter) {
            state.currentEditorElements.updateWordCounter();
        }

        state.currentEditorElements.updateSaveStatus();

        if (state.workspaceSaveStatus) {
            state.workspaceSaveStatus.textContent =
                "AI-generated section saved successfully ✓";
        }

        generationStatus.textContent =
            "Section generated and saved successfully ✓";

        generationStatus.className =
            "document-section-status research-save-success";

        state.updateSidebarContentIndicators();

        const addDiagnosticGroup = (heading, items) => {
            if (!Array.isArray(items) || items.length === 0) {
                return;
            }

            const group = document.createElement("div");
            group.className = "ai-generation-diagnostic-group";

            const headingElement = document.createElement("h4");
            headingElement.textContent = heading;

            const list = document.createElement("ul");

            items.forEach(item => {
                const listItem = document.createElement("li");
                listItem.textContent = item;
                list.appendChild(listItem);
            });

            group.append(headingElement, list);
            generationDetails.appendChild(group);
        };

        addDiagnosticGroup(
            "Academic background incorporated",
            response.background_context
        );

        addDiagnosticGroup(
            "Information still required",
            response.information_gaps
        );

        addDiagnosticGroup(
            "Integrity and verification notes",
            response.integrity_notes
        );

        const renderQualityAudit = audit => {
            if (!audit || typeof audit !== "object") {
                return;
            }

            const evaluation = audit.ai_evaluation || {};
            const summary = audit.summary || {};
            const findings = Array.isArray(audit.findings)
                ? audit.findings
                : [];
            const dimensions = evaluation.dimension_scores || {};

            const report = document.createElement("section");
            report.className = "ai-quality-report";

            const heading = document.createElement("h3");
            heading.textContent = "AI Academic Quality Report";
            report.appendChild(heading);

            const status = document.createElement("p");
            status.className = "ai-quality-status";
            status.textContent =
                audit.audit_status === "completed"
                    ? "Quality audit completed"
                    : "Quality audit partially completed";
            report.appendChild(status);

            if (Number.isFinite(evaluation.overall_score)) {
                const score = document.createElement("div");
                score.className = "ai-quality-overall-score";
                score.textContent =
                    `${evaluation.overall_score}/100`;
                report.appendChild(score);
            }

            if (evaluation.score_explanation) {
                const explanation = document.createElement("p");
                explanation.textContent = evaluation.score_explanation;
                report.appendChild(explanation);
            }

            const addList = (title, items, className = "") => {
                if (!Array.isArray(items) || items.length === 0) {
                    return;
                }

                const group = document.createElement("div");
                group.className = `ai-quality-group ${className}`.trim();

                const groupHeading = document.createElement("h4");
                groupHeading.textContent = title;

                const list = document.createElement("ul");

                items.forEach(item => {
                    const entry = document.createElement("li");
                    entry.textContent = item;
                    list.appendChild(entry);
                });

                group.append(groupHeading, list);
                report.appendChild(group);
            };

            if (Object.keys(dimensions).length > 0) {
                const group = document.createElement("div");
                group.className = "ai-quality-group";

                const dimensionHeading = document.createElement("h4");
                dimensionHeading.textContent = "Quality Dimensions";

                const list = document.createElement("ul");

                Object.entries(dimensions).forEach(([name, value]) => {
                    const entry = document.createElement("li");
                    const label = name
                        .replaceAll("_", " ")
                        .replace(/\b\w/g, character => character.toUpperCase());

                    entry.textContent = `${label}: ${value}/100`;
                    list.appendChild(entry);
                });

                group.append(dimensionHeading, list);
                report.appendChild(group);
            }

            addList("Identified Strengths", evaluation.strengths);

            if (findings.length > 0) {
                const group = document.createElement("div");
                group.className = "ai-quality-group";

                const findingsHeading = document.createElement("h4");
                findingsHeading.textContent =
                    `Findings (${findings.length})`;

                group.appendChild(findingsHeading);

                findings.forEach(finding => {
                    const card = document.createElement("article");
                    card.className =
                        `ai-quality-finding severity-${finding.severity || "low"}`;

                    const title = document.createElement("strong");
                    title.textContent =
                        `${finding.severity || "Finding"}: ${finding.finding || finding.category || "Quality finding"}`;

                    card.appendChild(title);

                    if (finding.location) {
                        const location = document.createElement("p");
                        location.textContent = `Location: ${finding.location}`;
                        card.appendChild(location);
                    }

                    if (finding.explanation) {
                        const explanation = document.createElement("p");
                        explanation.textContent = finding.explanation;
                        card.appendChild(explanation);
                    }

                    if (finding.recommendation) {
                        const recommendation = document.createElement("p");
                        recommendation.textContent =
                            `Recommendation: ${finding.recommendation}`;
                        card.appendChild(recommendation);
                    }

                    group.appendChild(card);
                });

                report.appendChild(group);
            }

            if (evaluation.limitations?.length) {
                addList("Evaluation Limitations", evaluation.limitations);
            }

            if (summary.severity_counts) {
                const counts = document.createElement("p");
                counts.className = "ai-quality-summary";
                counts.textContent =
                    `Critical: ${summary.severity_counts.critical || 0} | ` +
                    `High: ${summary.severity_counts.high || 0} | ` +
                    `Medium: ${summary.severity_counts.medium || 0} | ` +
                    `Low: ${summary.severity_counts.low || 0}`;
                report.appendChild(counts);
            }

            generationDetails.appendChild(report);
        };

        renderQualityAudit(response.quality_audit);

        generationDetails.hidden =
            generationDetails.childElementCount === 0;

    } catch (error) {
        console.error(
            `AI generation failed for "${section}":`,
            error
        );

        generationStatus.textContent =
            error.message || "Unable to generate this section.";

        generationStatus.className =
            "document-section-status research-save-error";

        state.showWorkspaceNotice(
            error.message || "AI section generation failed."
        );

    } finally {
        state.navigationInProgress = false;

        generateButton.disabled = false;
        saveButton.disabled = false;
        backButton.disabled = false;
        editor.disabled = false;

        const configuration = state.documentConfigurations[state.currentDocumentType];
        const index = configuration.sections.indexOf(state.currentSectionEditor);

        navigationButtons[0].disabled = index === 0;
        navigationButtons[1].disabled =
            index === configuration.sections.length - 1;

        if (state.sectionSidebarList) {
            state.sectionSidebarList.querySelectorAll("button").forEach(button => {
                button.disabled = false;
            });
        }
    }
}


async function generateFullDocument(
    editor,
    generateButton,
    generationStatus,
    generationDetails
) {
    const state = window.ResearchForgeWorkspace;

    if (
        !state.currentProjectId ||
        state.navigationInProgress ||
        !state.currentEditorElements
    ) {
        return;
    }

    const modeChoice = await showFullDocumentModeConfirmation();

    if (!modeChoice) return;

    const {
        saveButton,
        backButton,
        navigationButtons,
        saveStatus
    } = state.currentEditorElements;

    state.navigationInProgress = true;

    generateButton.disabled = true;
    saveButton.disabled = true;
    backButton.disabled = true;

    if (editor) editor.disabled = true;

    navigationButtons.forEach(button => {
        button.disabled = true;
    });

    if (state.sectionSidebarList) {
        state.sectionSidebarList.querySelectorAll("button").forEach(button => {
            button.disabled = true;
        });
    }

    generationStatus.hidden = false;
    generationStatus.className =
        "document-section-status research-save-warning";
    generationStatus.textContent =
        "Saving current work before full-document generation...";

    generationDetails.replaceChildren();
    generationDetails.hidden = true;

    try {
        if (editor && state.currentSectionEditor) {
            const saved = await state.saveSectionAndWait(
                state.currentSectionEditor,
                editor,
                saveStatus
            );

            if (!saved) {
                throw new Error(
                    "Current section could not be saved. Generation stopped to protect your work."
                );
            }
        }

        generationStatus.textContent =
            "ResearchForge AI is generating your complete document. This may take several minutes...";

        const response = await state.apiRequest(
            `${state.API_BASE_URL}/projects/${state.currentProjectId}/generate-full-document`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    generation_mode: modeChoice
                })
            },
            900000
        );

        if (!response || !Array.isArray(response.generated_sections)) {
            throw new Error("The full-document generator returned an invalid response.");
        }

        const generated = response.generated_sections;

        generated.forEach(section => {
            if (
                !section ||
                typeof section.content !== "string" ||
                !section.content.trim()
            ) {
                return;
            }

            const displayName =
                section.section_title ||
                section.title ||
                section.section_id;

            if (displayName) {
                const existingKey = section.existing_section_key;

                const targetKey =
                    typeof existingKey === "string" &&
                    Object.prototype.hasOwnProperty.call(
                        state.documentSections,
                        existingKey
                    )
                        ? existingKey
                        : displayName;

                state.documentSections[targetKey] = section.content;
            }
        });

        state.saveLocalRecovery();
        state.updateSidebarContentIndicators();

        generationStatus.textContent =
            response.generation_complete
                ? "Full document generated successfully ?"
                : "Generation finished with incomplete sections. Review the report below.";

        generationStatus.className =
            response.generation_complete
                ? "document-section-status research-save-success"
                : "document-section-status research-save-warning";

        const addGroup = (heading, items) => {
            if (!Array.isArray(items) || !items.length) return;

            const group = document.createElement("div");
            group.className = "ai-generation-diagnostic-group";

            const title = document.createElement("h4");
            title.textContent = heading;

            const list = document.createElement("ul");

            items.forEach(item => {
                const entry = document.createElement("li");
                entry.textContent =
                    typeof item === "string"
                        ? item
                        : item.section_title
                            ? `${item.section_title}: ${item.error || item.section_id || ""}`
                            : JSON.stringify(item);

                list.appendChild(entry);
            });

            group.append(title, list);
            generationDetails.appendChild(group);
        };

        addGroup("Generated Sections", generated.map(
            item => item.section_title || item.title || item.section_id
        ));

        addGroup("Sections Already Containing Content", response.skipped_sections);
        addGroup("Sections That Could Not Be Generated", response.failed_sections);
        addGroup("Evidence and Verification Findings", response.evidence_findings);

        if (response.quality_reports) {
            Object.entries(response.quality_reports).forEach(([sectionId, report]) => {
                const group = document.createElement("section");
                group.className = "ai-quality-report";

                const heading = document.createElement("h3");
                heading.textContent = `Quality Audit: ${sectionId}`;
                group.appendChild(heading);

                const status = document.createElement("p");
                status.textContent =
                    report.audit_status === "completed"
                        ? "Quality audit completed"
                        : "Quality audit partially completed";
                group.appendChild(status);

                const findings = Array.isArray(report.findings)
                    ? report.findings
                    : [];

                findings.forEach(finding => {
                    const card = document.createElement("article");
                    card.className =
                        `ai-quality-finding severity-${finding.severity || "low"}`;

                    const title = document.createElement("strong");
                    title.textContent =
                        `${finding.severity || "Finding"}: ${finding.finding || finding.category || "Quality finding"}`;

                    card.appendChild(title);

                    if (finding.explanation) {
                        const explanation = document.createElement("p");
                        explanation.textContent = finding.explanation;
                        card.appendChild(explanation);
                    }

                    if (finding.recommendation) {
                        const recommendation = document.createElement("p");
                        recommendation.textContent =
                            `Recommendation: ${finding.recommendation}`;
                        card.appendChild(recommendation);
                    }

                    group.appendChild(card);
                });

                generationDetails.appendChild(group);
            });
        }

        generationDetails.hidden =
            generationDetails.childElementCount === 0;

        state.showWorkspaceNotice(
            response.message || "Full-document generation finished."
        );

    } catch (error) {
        console.error("Full-document generation failed:", error);

        generationStatus.textContent =
            error.message || "Full-document generation failed.";

        generationStatus.className =
            "document-section-status research-save-error";

        state.showWorkspaceNotice(
            error.message || "Full-document generation failed."
        );

    } finally {
        state.navigationInProgress = false;

        generateButton.disabled = false;
        saveButton.disabled = false;
        backButton.disabled = false;

        if (editor) editor.disabled = false;

        const configuration =
            state.documentConfigurations[state.currentDocumentType];

        const index = configuration.sections.indexOf(
            state.currentSectionEditor
        );

        navigationButtons[0].disabled = index === 0;
        navigationButtons[1].disabled =
            index === configuration.sections.length - 1;

        if (state.sectionSidebarList) {
            state.sectionSidebarList.querySelectorAll("button").forEach(button => {
                button.disabled = false;
            });
        }
    }
}

function showFullDocumentModeConfirmation() {
    return new Promise(resolve => {
        if (document.getElementById("rf-full-document-modal")) {
            return resolve(null);
        }

        if (!document.getElementById("rf-full-document-modal-styles")) {
            const style = document.createElement("style");
            style.id = "rf-full-document-modal-styles";
            style.textContent = `
                #rf-full-document-modal {
                    position: fixed;
                    inset: 0;
                    z-index: 10050;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                    background: rgba(20, 30, 35, .48);
                    backdrop-filter: blur(5px);
                }

                #rf-full-document-modal,
                #rf-full-document-modal * {
                    box-sizing: border-box;
                }

                #rf-full-document-modal .rf-full-dialog {
                    width: min(100%, 590px);
                    padding: 30px;
                    border: 1px solid var(--color-border);
                    border-radius: var(--radius-large, 18px);
                    background: var(--color-surface);
                    color: var(--color-text);
                    box-shadow: 0 20px 65px rgba(20, 35, 40, .2);
                    animation: rfFullModalIn .2s ease-out;
                }

                #rf-full-document-modal .rf-full-header {
                    display: flex;
                    align-items: center;
                    gap: 13px;
                    margin-bottom: 10px;
                }

                #rf-full-document-modal .rf-full-icon {
                    display: grid;
                    place-items: center;
                    flex: 0 0 44px;
                    height: 44px;
                    border-radius: 12px;
                    background: var(--color-primary-light, rgba(40, 145, 150, .12));
                    color: var(--color-primary);
                    font-size: 23px;
                }

                #rf-full-document-modal .rf-full-heading {
                    margin: 0;
                    font-family: var(--font-heading);
                    font-size: clamp(21px, 4vw, 27px);
                    font-weight: 800;
                    line-height: 1.25;
                }

                #rf-full-document-modal .rf-full-subtitle {
                    margin: 12px 0 24px;
                    color: var(--color-muted);
                    font-size: 14px;
                    line-height: 1.65;
                }

                #rf-full-document-modal .rf-full-option {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    width: 100%;
                    padding: 19px;
                    margin-top: 13px;
                    border: 1px solid var(--color-border);
                    border-radius: 13px;
                    background: var(--color-background, var(--color-surface));
                    color: var(--color-text);
                    text-align: left;
                    cursor: pointer;
                    transition: border-color .18s, background .18s, box-shadow .18s;
                }

                #rf-full-document-modal .rf-full-option:hover {
                    border-color: var(--color-primary);
                }

                #rf-full-document-modal .rf-full-option.selected {
                    border: 2px solid var(--color-primary);
                    padding: 18px;
                    background: var(--color-primary-light, rgba(40, 145, 150, .09));
                    box-shadow: 0 0 0 2px rgba(40, 145, 150, .07);
                }

                #rf-full-document-modal .rf-full-radio {
                    display: grid;
                    place-items: center;
                    flex: 0 0 22px;
                    width: 22px;
                    height: 22px;
                    border: 2px solid var(--color-muted);
                    border-radius: 50%;
                }

                #rf-full-document-modal .rf-full-option.selected .rf-full-radio {
                    border-color: var(--color-primary);
                }

                #rf-full-document-modal .rf-full-radio-dot {
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    background: transparent;
                }

                #rf-full-document-modal .rf-full-option.selected .rf-full-radio-dot {
                    background: var(--color-primary);
                }

                #rf-full-document-modal .rf-full-option-content {
                    flex: 1;
                    min-width: 0;
                }

                #rf-full-document-modal .rf-full-option strong {
                    display: block;
                    margin-bottom: 6px;
                    font-size: 15px;
                    font-weight: 800;
                }

                #rf-full-document-modal .rf-full-option-description {
                    display: block;
                    color: var(--color-muted);
                    font-size: 13px;
                    line-height: 1.6;
                }

                #rf-full-document-modal .rf-full-option-icon {
                    flex: 0 0 35px;
                    color: var(--color-primary);
                    font-size: 27px;
                    text-align: center;
                }

                #rf-full-document-modal .rf-full-warning {
                    display: flex;
                    gap: 11px;
                    align-items: flex-start;
                    margin: 18px 0 0;
                    padding: 13px 15px;
                    border: 1px solid rgba(190, 145, 55, .3);
                    border-radius: 10px;
                    background: rgba(190, 145, 55, .09);
                    color: var(--color-text);
                    font-size: 12px;
                    line-height: 1.6;
                }

                #rf-full-document-modal .rf-full-warning-icon {
                    color: #b8872f;
                    font-size: 18px;
                    font-weight: 800;
                }

                #rf-full-document-modal .rf-full-actions {
                    display: flex;
                    justify-content: flex-end;
                    gap: 12px;
                    margin-top: 24px;
                }

                #rf-full-document-modal .rf-full-action {
                    min-height: 43px;
                    padding: 10px 20px;
                    border: 1px solid var(--color-border);
                    border-radius: var(--radius-small, 9px);
                    background: transparent;
                    color: var(--color-text);
                    font: inherit;
                    font-size: 14px;
                    font-weight: 700;
                    cursor: pointer;
                }

                #rf-full-document-modal .rf-full-continue {
                    border-color: var(--color-primary);
                    background: var(--color-primary);
                    color: #fff;
                }

                #rf-full-document-modal .rf-full-action {
                    transition: transform .2s ease, box-shadow .2s ease,
                                background .2s ease, border-color .2s ease;
                }

                #rf-full-document-modal .rf-full-action:hover {
                    transform: translateY(-3px);
                    box-shadow: 0 7px 16px rgba(25, 55, 65, .13);
                }

                #rf-full-document-modal .rf-full-action:active {
                    transform: translateY(-1px) scale(.98);
                    box-shadow: none;
                }

                #rf-full-document-modal .rf-full-continue:hover {
                    filter: brightness(1.08);
                }

                #rf-full-document-modal .rf-full-cancel:hover {
                    border-color: var(--color-primary);
                    background: var(--color-primary-light, rgba(40, 145, 150, .08));
                }

                @media (prefers-reduced-motion: reduce) {
                    #rf-full-document-modal .rf-full-action {
                        transition: none;
                    }
                }

                #rf-full-document-modal button:focus-visible {
                    outline: 2px solid var(--color-primary);
                    outline-offset: 3px;
                }

                @keyframes rfFullModalIn {
                    from { opacity: 0; transform: translateY(9px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                @media (max-width: 480px) {
                    #rf-full-document-modal .rf-full-dialog {
                        padding: 21px;
                    }

                    #rf-full-document-modal .rf-full-option {
                        padding: 15px;
                        gap: 11px;
                    }

                    #rf-full-document-modal .rf-full-option.selected {
                        padding: 14px;
                    }

                    #rf-full-document-modal .rf-full-option-icon {
                        display: none;
                    }
                }

                @media (prefers-reduced-motion: reduce) {
                    #rf-full-document-modal .rf-full-dialog {
                        animation: none;
                    }
                }
            `;
            document.head.appendChild(style);
        }

        let selectedMode = "fill_empty";

        const overlay = document.createElement("div");
        overlay.id = "rf-full-document-modal";

        overlay.innerHTML = `
            <div class="rf-full-dialog" role="dialog"
                 aria-modal="true" aria-labelledby="rf-full-title"
                 aria-describedby="rf-full-description">

                <div class="rf-full-header">
                    <div class="rf-full-icon" aria-hidden="true">?</div>
                    <h2 class="rf-full-heading" id="rf-full-title">
                        Generate Full Document
                    </h2>
                </div>

                <p class="rf-full-subtitle" id="rf-full-description">
                    Choose how ResearchForge AI should generate your document.
                    Your current section will be saved before generation begins.
                </p>

                <button type="button"
                        class="rf-full-option selected"
                        data-mode="fill_empty"
                        role="radio"
                        aria-checked="true">
                    <span class="rf-full-radio">
                        <span class="rf-full-radio-dot"></span>
                    </span>
                    <span class="rf-full-option-content">
                        <strong>Fill Empty Sections</strong>
                        <span class="rf-full-option-description">
                            Preserve existing content and generate only
                            sections that are currently empty or missing.
                        </span>
                    </span>
                    <span class="rf-full-option-icon" aria-hidden="true">?</span>
                </button>

                <button type="button"
                        class="rf-full-option"
                        data-mode="regenerate"
                        role="radio"
                        aria-checked="false">
                    <span class="rf-full-radio">
                        <span class="rf-full-radio-dot"></span>
                    </span>
                    <span class="rf-full-option-content">
                        <strong>Regenerate Entire Document</strong>
                        <span class="rf-full-option-description">
                            Generate all recommended sections again,
                            replacing their existing content.
                        </span>
                    </span>
                    <span class="rf-full-option-icon" aria-hidden="true">?</span>
                </button>

                <div class="rf-full-warning">
                    <span class="rf-full-warning-icon" aria-hidden="true">!</span>
                    <span>
                        <strong>Important:</strong>
                        Regeneration replaces existing section content.
                        Choose Fill Empty Sections to preserve your work.
                    </span>
                </div>

                <div class="rf-full-actions">
                    <button type="button"
                            class="rf-full-action rf-full-cancel">
                        Cancel
                    </button>
                    <button type="button"
                            class="rf-full-action rf-full-continue">
                        Continue
                    </button>
                </div>
            </div>
        `;

        const finish = mode => {
            overlay.remove();
            document.removeEventListener("keydown", handleKeydown);
            resolve(mode);
        };

        const options = [...overlay.querySelectorAll("[data-mode]")];

        options.forEach(option => {
            option.addEventListener("click", () => {
                selectedMode = option.dataset.mode;

                options.forEach(item => {
                    const selected = item === option;
                    item.classList.toggle("selected", selected);
                    item.setAttribute("aria-checked", String(selected));
                });
            });
        });

        overlay.querySelector(".rf-full-cancel").addEventListener(
            "click",
            () => finish(null)
        );

        overlay.querySelector(".rf-full-continue").addEventListener(
            "click",
            () => finish(selectedMode)
        );

        overlay.addEventListener("click", event => {
            if (event.target === overlay) finish(null);
        });

        const handleKeydown = event => {
            if (event.key === "Escape") {
                finish(null);
            }

            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                if (!options.includes(document.activeElement)) return;

                event.preventDefault();
                const current = options.indexOf(document.activeElement);
                const next = event.key === "ArrowDown"
                    ? (current + 1) % options.length
                    : (current - 1 + options.length) % options.length;

                options[next].focus();
                options[next].click();
            }

            if (event.key === "Tab") {
                const controls = [...overlay.querySelectorAll("button")];
                const first = controls[0];
                const last = controls[controls.length - 1];

                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        };

        document.addEventListener("keydown", handleKeydown);
        document.body.appendChild(overlay);
        options[0].focus();
    });
}

function showRegenerationConfirmation(section) {
    return new Promise((resolve) => {
        if (!document.getElementById("rf-regeneration-modal-styles")) {
            const style = document.createElement("style");
            style.id = "rf-regeneration-modal-styles";
            style.textContent = `
                .rf-modal-overlay {
                    position: fixed;
                    inset: 0;
                    z-index: 99999;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                    background: rgba(3, 7, 18, 0.78);
                    backdrop-filter: blur(9px);
                    animation: rfModalFadeIn 0.2s ease;
                }

                .rf-modal-card {
                    width: 100%;
                    max-width: 440px;
                    padding: 30px;
                    border: 1px solid rgba(255,255,255,0.12);
                    border-radius: 18px;
                    background: linear-gradient(145deg, #171e2d, #0d1320);
                    box-shadow: 0 20px 70px rgba(0,0,0,0.55),
                                0 0 30px rgba(59,130,246,0.10);
                    color: #f8fafc;
                    animation: rfModalSlideIn 0.25s ease;
                }

                .rf-modal-icon {
                    width: 48px;
                    height: 48px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 14px;
                    background: rgba(59,130,246,0.15);
                    color: #60a5fa;
                    font-size: 24px;
                    margin-bottom: 20px;
                }

                .rf-modal-title {
                    margin: 0 0 12px;
                    color: #ffffff;
                    font-size: 22px;
                    font-weight: 700;
                }

                .rf-modal-section {
                    color: #93c5fd;
                    font-weight: 600;
                    overflow-wrap: anywhere;
                }

                .rf-modal-description {
                    margin: 14px 0 12px;
                    color: #cbd5e1;
                    font-size: 14px;
                    line-height: 1.7;
                }

                .rf-modal-warning {
                    padding: 12px 14px;
                    margin-top: 16px;
                    border: 1px solid rgba(245,158,11,0.2);
                    border-radius: 10px;
                    background: rgba(245,158,11,0.07);
                    color: #fcd34d;
                    font-size: 13px;
                    line-height: 1.6;
                }

                .rf-modal-actions {
                    display: flex;
                    justify-content: flex-end;
                    gap: 12px;
                    margin-top: 26px;
                }

                .rf-modal-btn {
                    padding: 11px 20px;
                    border-radius: 9px;
                    border: 1px solid transparent;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: 0.2s ease;
                }

                .rf-modal-cancel {
                    color: #e2e8f0;
                    background: #263244;
                    border-color: rgba(255,255,255,0.1);
                }

                .rf-modal-cancel:hover {
                    background: #35445b;
                }

                .rf-modal-confirm {
                    color: #ffffff;
                    background: linear-gradient(135deg, #2563eb, #3b82f6);
                    box-shadow: 0 4px 16px rgba(37,99,235,0.25);
                }

                .rf-modal-confirm:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 6px 22px rgba(37,99,235,0.4);
                }

                .rf-modal-btn:focus-visible {
                    outline: 2px solid #93c5fd;
                    outline-offset: 3px;
                }

                @keyframes rfModalFadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                @keyframes rfModalSlideIn {
                    from { opacity: 0; transform: translateY(12px) scale(0.98); }
                    to { opacity: 1; transform: translateY(0) scale(1); }
                }

                /* ResearchForge native teal theme */
                .rf-modal-card {
                    background: var(--color-surface, #ffffff);
                    border: 1px solid var(--color-border, #dce3e3);
                    border-radius: var(--radius-large, 14px);
                    color: var(--color-text, #263238);
                    box-shadow: 0 18px 55px rgba(0, 0, 0, 0.22),
                                0 0 25px rgba(11, 127, 133, 0.10);
                }

                .rf-modal-icon {
                    background: var(--color-soft, #e8f4f4);
                    color: var(--color-primary, #0b7f85);
                    border: 1px solid var(--color-primary-border, #b9dddd);
                }

                .rf-modal-title {
                    color: var(--color-heading, #172f30);
                    font-family: var(--font-heading, inherit);
                }

                .rf-modal-section {
                    color: var(--color-primary, #0b7f85);
                }

                .rf-modal-description {
                    color: var(--color-text, #344b4c);
                }

                .rf-modal-warning {
                    background: var(--color-soft, #edf7f7);
                    border: 1px solid var(--color-primary-border, #c5e2e2);
                    color: var(--color-text, #344b4c);
                    border-radius: var(--radius-medium, 10px);
                }

                .rf-modal-cancel {
                    background: var(--color-background, #f5f8f8);
                    color: var(--color-text, #263238);
                    border: 1px solid var(--color-border, #dce3e3);
                    border-radius: var(--radius-small, 7px);
                }

                .rf-modal-cancel:hover {
                    background: var(--color-soft, #e8f4f4);
                    border-color: var(--color-primary, #0b7f85);
                    color: var(--color-primary, #0b7f85);
                    transform: translateY(-3px);
                    box-shadow: 0 5px 16px rgba(11, 127, 133, 0.20);
                }

                .rf-modal-cancel:active {
                    transform: translateY(0) scale(0.97);
                    box-shadow: 0 2px 6px rgba(11, 127, 133, 0.12);
                }

                .rf-modal-confirm {
                    background: var(--color-primary, #0b7f85);
                    color: #ffffff;
                    border: 1px solid var(--color-primary, #0b7f85);
                    border-radius: var(--radius-small, 7px);
                    box-shadow: 0 4px 14px rgba(11, 127, 133, 0.20);
                }

                .rf-modal-confirm:hover {
                    background: var(--color-primary-hover, #08696e);
                    border-color: var(--color-primary-hover, #08696e);
                    box-shadow: 0 5px 18px rgba(11, 127, 133, 0.28);
                }

                .rf-modal-btn:focus-visible {
                    outline: 2px solid var(--color-primary, #0b7f85);
                    outline-offset: 3px;
                    box-shadow: 0 0 0 4px rgba(11, 127, 133, 0.12);
                }
            `;
            document.head.appendChild(style);
        }

        const overlay = document.createElement("div");
        overlay.className = "rf-modal-overlay";
        overlay.setAttribute("role", "presentation");

        const card = document.createElement("div");
        card.className = "rf-modal-card";
        card.setAttribute("role", "dialog");
        card.setAttribute("aria-modal", "true");
        card.setAttribute("aria-labelledby", "rf-modal-title");

        const icon = document.createElement("div");
        icon.className = "rf-modal-icon";
        icon.textContent = "✦";

        const title = document.createElement("h2");
        title.id = "rf-modal-title";
        title.className = "rf-modal-title";
        title.textContent = "Regenerate Section?";

        const sectionName = document.createElement("div");
        sectionName.className = "rf-modal-section";
        sectionName.textContent = section;

        const description = document.createElement("p");
        description.className = "rf-modal-description";
        description.textContent =
            "This section already contains content. AI will generate a new version to replace the existing text.";

        const warning = document.createElement("div");
        warning.className = "rf-modal-warning";
        warning.textContent =
            "Your current content will be saved before regeneration. The new AI-generated content will replace it.";

        const actions = document.createElement("div");
        actions.className = "rf-modal-actions";

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "rf-modal-btn rf-modal-cancel";
        cancelButton.textContent = "Cancel";

        const confirmButton = document.createElement("button");
        confirmButton.type = "button";
        confirmButton.className = "rf-modal-btn rf-modal-confirm";
        confirmButton.textContent = "Regenerate";

        actions.append(cancelButton, confirmButton);
        card.append(icon, title, sectionName, description, warning, actions);
        overlay.appendChild(card);
        document.body.appendChild(overlay);

        let completed = false;

        function close(result) {
            if (completed) return;
            completed = true;
            document.removeEventListener("keydown", handleKeydown);
            overlay.remove();
            resolve(result);
        }

        function handleKeydown(event) {
            if (event.key === "Escape") {
                close(false);
            }
        }

        cancelButton.addEventListener("click", () => close(false));
        confirmButton.addEventListener("click", () => close(true));

        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) close(false);
        });

        document.addEventListener("keydown", handleKeydown);
        confirmButton.focus();
    });
}

    window.ResearchForgeAIGeneration = {
        generateCurrentDocumentSection,
        generateFullDocument
    };
})();