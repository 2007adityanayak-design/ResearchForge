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

        const plannedSections =
            documentPlan?.recommended_sections || [];

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
        generateCurrentDocumentSection
    };
})();