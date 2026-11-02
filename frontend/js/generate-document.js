(() => {
    let generationInProgress = false;

    const sleep = (ms) =>
        new Promise((resolve) => setTimeout(resolve, ms));

    function setStatus(message, type = "info") {
        const element = document.getElementById("generate-document-status");

        if (!element) return;

        element.textContent = message;
        element.className = `generate-document-status ${type}`;
    }

    async function waitForPendingSaves(state) {
        const deadline = Date.now() + 120000;

        while (Date.now() < deadline) {
            const pending = Object.values(state.sectionSavePromises || {});
            const saving = Object.values(state.sectionSaving || {}).some(Boolean);

            if (pending.length) {
                await Promise.allSettled(pending);
            }

            if (!saving && !Object.values(state.sectionSaving || {}).some(Boolean)) {
                break;
            }

            await sleep(200);
        }

        if (
            Object.values(state.sectionSaving || {}).some(Boolean) ||
            Object.values(state.sectionSavePromises || {}).length
        ) {
            throw new Error("Some section saves are still running. Please try again.");
        }
    }

    async function saveAllSections(state) {
        const activeEditor = state.currentEditorElements?.editor;
        const activeSection = state.currentSectionEditor;

        if (activeEditor && activeSection) {
            state.documentSections[activeSection] = activeEditor.value;
        }

        for (const timer of Object.values(state.sectionSaveTimers || {})) {
            clearTimeout(timer);
        }

        for (const timer of Object.values(state.sectionRetryTimers || {})) {
            clearTimeout(timer);
        }

        await waitForPendingSaves(state);

        const sections = state.documentSections || {};

        if (activeEditor && activeSection) {
            const saved = await state.saveSectionAndWait(
                activeSection,
                activeEditor,
                state.currentEditorElements?.saveStatus
            );

            if (!saved) {
                throw new Error(`Unable to save "${activeSection}". Please resolve the save issue first.`);
            }
        }

        await waitForPendingSaves(state);

        const response = await state.apiRequest(
            `${state.API_BASE_URL}/projects/${state.currentProjectId}/sections`,
            {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ sections })
            }
        );

        for (const section of Object.keys(sections)) {
            state.sectionSavedVersions[section] =
                state.sectionVersions[section] || 0;

            delete state.sectionSaveErrors[section];
        }

        state.clearLocalRecoveryIfSaved();

        return response;
    }

    async function handleGeneration() {
        if (generationInProgress) return;

        const state = window.ResearchForgeWorkspace;
        const ai = window.ResearchForgeAIGeneration;

        if (!state || !ai) {
            setStatus("Workspace modules are not ready. Refresh the page and try again.", "error");
            return;
        }

        if (!state.currentProjectId) {
            setStatus("No project is currently open.", "error");
            return;
        }

        if (state.navigationInProgress) {
            setStatus("Please wait for the current workspace operation to finish.", "error");
            return;
        }

        generationInProgress = true;

        const button = document.getElementById("generate-document-btn");

        if (button) {
            button.disabled = true;
            button.classList.add("is-loading");
        }

        try {
            const mode = await ai.showFullDocumentModeConfirmation();

            if (!mode) {
                setStatus("Document generation cancelled.");
                return;
            }

            setStatus("Saving all your project sections...", "info");

            await saveAllSections(state);

            setStatus("Generating your complete document. This may take several minutes...", "info");

            const response = await state.apiRequest(
                `${state.API_BASE_URL}/projects/${state.currentProjectId}/generate-full-document`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        generation_mode: mode
                    })
                },
                900000
            );

            if (!response || !Array.isArray(response.generated_sections)) {
                throw new Error("The generation response was incomplete or invalid.");
            }

            if (
                response.generated_sections.length === 0 &&
                (!response.all_sections || Object.keys(response.all_sections).length === 0)
            ) {
                throw new Error("No document sections were generated. Check your project information and try again.");
            }

            setStatus("Document generated successfully. Opening your document editor...", "success");

            const query = new URLSearchParams({
                id: String(state.currentProjectId)
            });

            if (response.failed_sections?.length) {
                query.set("partial", "1");
            }

            await sleep(700);

            window.location.href = `document-editor.html?${query.toString()}`;
        } catch (error) {
            console.error("Full document generation failed:", error);

            setStatus(
                error.message || "Document generation failed. Please try again.",
                "error"
            );

            if (typeof state.showWorkspaceNotice === "function") {
                state.showWorkspaceNotice(
                    error.message || "Unable to generate the document.",
                    "error"
                );
            }
        } finally {
            generationInProgress = false;

            if (button && window.location.pathname.endsWith("workspace.html")) {
                button.disabled = false;
                button.classList.remove("is-loading");
            }
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        const button = document.getElementById("generate-document-btn");

        if (button) {
            button.addEventListener("click", handleGeneration);
        }
    });
})();


