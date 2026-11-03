document.addEventListener("DOMContentLoaded", () => {
    const button = document.getElementById("open-document-editor-btn");

    if (!button) {
        return;
    }

    button.addEventListener("click", () => {
        const params = new URLSearchParams(window.location.search);
        const projectId = params.get("id");

        if (!projectId || !/^\d+$/.test(projectId) || Number(projectId) < 1) {
            alert("Unable to identify the current project. Please reopen it from the dashboard.");
            return;
        }

        window.location.href = `document-editor.html?id=${encodeURIComponent(projectId)}`;
    });
});
