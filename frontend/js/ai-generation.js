(() => {
function showGenerationConfirmation(options) {
    return new Promise(resolve => {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay active generation-confirmation-overlay";
        overlay.setAttribute("aria-hidden", "false");

        const card = document.createElement("div");
        card.className = "modal-card generation-confirmation-card";
        card.setAttribute("role", "dialog");
        card.setAttribute("aria-modal", "true");
        card.setAttribute("aria-labelledby", "generation-confirmation-title");

        const icon = document.createElement("div");
        icon.className = "modal-icon generation-confirmation-icon";
        icon.textContent = "!";

        const title = document.createElement("h2");
        title.id = "generation-confirmation-title";
        title.className = "generation-confirmation-title";
        title.textContent = options.title;

        const description = document.createElement("p");
        description.textContent = options.description;
        description.className = "generation-confirmation-description";

        const actions = document.createElement("div");
        actions.className = "modal-actions generation-confirmation-actions";

        let settled = false;

        function finish(value) {
            if (settled) return;
            settled = true;
            document.removeEventListener("keydown", handleKeydown);
            document.body.classList.remove("modal-open");
            overlay.remove();
            resolve(value);
        }

        function handleKeydown(event) {
            if (event.key === "Escape") finish(null);
        }

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "modal-cancel-btn generation-cancel-button";
        cancelButton.textContent = "Cancel";
        cancelButton.addEventListener("click", () => finish(null));

        actions.appendChild(cancelButton);

        options.choices.forEach(choice => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = `generation-choice-button ${choice.className}`;
            button.textContent = choice.label;
            button.addEventListener("click", () => finish(choice.value));
            actions.appendChild(button);
        });

        card.append(title, description, actions);
        overlay.appendChild(card);

        overlay.addEventListener("click", event => {
            if (event.target === overlay) finish(null);
        });

        document.body.appendChild(overlay);
        document.body.classList.add("modal-open");
        document.addEventListener("keydown", handleKeydown);
        cancelButton.focus();
    });
}

async function showRegenerationConfirmation(section) {
    return (
        await showGenerationConfirmation({
            title: "Regenerate this section?",
            description:
                `Existing content in "${section}" will be replaced by newly generated content.`,
            choices: [{
                label: "Regenerate",
                value: true,
                className: "generation-choice-danger"
            }]
        })
    ) === true;
}

async function showFullDocumentModeConfirmation() {
    return showGenerationConfirmation({
        title: "Generate your complete document",
        description:
            "Choose how ResearchForge should handle your existing sections. " +
            "Filling empty sections preserves your current content. " +
            "Regenerating all replaces existing generated content.",
        choices: [
            {
                label: "Fill Empty Sections",
                value: "fill_empty",
                className: "generation-choice-recommended"
            },
            {
                label: "Regenerate All",
                value: "regenerate",
                className: "generation-choice-danger"
            }
        ]
    });
}


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
                "AI-generated section saved successfully âœ“";
        }

        generationStatus.textContent =
            "Section generated and saved successfully âœ“";

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

    const modeChoice = "fill_empty";

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

    window.ResearchForgeAIGeneration = {
        generateCurrentDocumentSection,
        generateFullDocument,
        showFullDocumentModeConfirmation,
    };
})();
