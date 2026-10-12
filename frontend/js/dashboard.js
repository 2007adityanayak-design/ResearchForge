const API_BASE_URL = "http://127.0.0.1:8000";

const projectCount = document.getElementById("project-count");
const projectSearch = document.getElementById("project-search");
const projectsContainer = document.getElementById("projects-container");
const projectResultsLabel = document.getElementById("project-results-label");

const deleteModal = document.getElementById("delete-modal");
const cancelDeleteButton = document.getElementById("cancel-delete");
const confirmDeleteButton = document.getElementById("confirm-delete");

const toastContainer = document.getElementById("toast-container");

let allProjects = [];
let projectToDelete = null;
let isDeleting = false;

document.addEventListener("DOMContentLoaded", () => {
    loadProjects();
    setupSearch();
    setupDeleteModal();
    setupComingSoonLinks();
});

async function loadProjects() {
    projectsContainer.innerHTML = `
        <div class="projects-loading">
            <div class="loading-spinner"></div>
            <p>Loading your projects...</p>
        </div>
    `;

    try {
        const response = await fetch(`${API_BASE_URL}/projects`);

        if (!response.ok) {
            throw new Error("Unable to load projects.");
        }

        const projects = await response.json();

        allProjects = Array.isArray(projects) ? projects : [];

        updateProjectCount();
        renderProjects(allProjects);
    } catch (error) {
        projectsContainer.innerHTML = `
            <div class="projects-error">
                <div class="empty-state-icon">!</div>
                <h3>We couldn't load your projects</h3>
                <p>Check that the ResearchForge backend is running, then try again.</p>
                <button type="button" class="retry-button" id="retry-projects">
                    Try again
                </button>
            </div>
        `;

        projectCount.textContent = "—";
        projectResultsLabel.textContent = "Connection unavailable";

        document.getElementById("retry-projects").addEventListener("click", loadProjects);
    }
}

function updateProjectCount() {
    projectCount.textContent = allProjects.length;
}

function setupSearch() {
    projectSearch.addEventListener("input", () => {
        const searchTerm = projectSearch.value.trim().toLowerCase();

        const filteredProjects = allProjects.filter(project =>
            String(project.name || "").toLowerCase().includes(searchTerm)
        );

        renderProjects(filteredProjects);
    });
}

function renderProjects(projects) {
    projectsContainer.innerHTML = "";

    const searchTerm = projectSearch.value.trim();

    if (projectResultsLabel) {
        projectResultsLabel.textContent = searchTerm
            ? `${projects.length} matching ${projects.length === 1 ? "project" : "projects"}`
            : `${projects.length} ${projects.length === 1 ? "project" : "projects"}`;
    }

    if (projects.length === 0) {
        if (searchTerm) {
            projectsContainer.innerHTML = `
                <div class="projects-empty">
                    <div class="empty-state-icon">⌕</div>
                    <h3>No matching projects</h3>
                    <p>Try another search term or clear your search.</p>
                    <button type="button" class="empty-action-btn" id="clear-project-search">
                        Clear search
                    </button>
                </div>
            `;

            document.getElementById("clear-project-search").addEventListener("click", () => {
                projectSearch.value = "";
                renderProjects(allProjects);
                projectSearch.focus();
            });

            return;
        }

        projectsContainer.innerHTML = `
            <div class="projects-empty">
                <div class="empty-state-icon">＋</div>
                <h3>Your research starts here</h3>
                <p>Create your first project to keep your academic work organized.</p>
                <a href="project.html" class="empty-action-btn">
                    Create your first project
                </a>
            </div>
        `;

        return;
    }

    const fragment = document.createDocumentFragment();

    projects.forEach((project, index) => {
        const card = document.createElement("article");
        card.className = "project-card";

        const header = document.createElement("div");
        header.className = "project-card-header";

        const icon = document.createElement("div");
        icon.className = `project-card-icon project-color-${index % 5}`;
        icon.textContent = "R";

        const menu = document.createElement("button");
        menu.type = "button";
        menu.className = "project-delete-btn";
        menu.textContent = "⋯";
        menu.setAttribute("aria-label", `Delete ${project.name || "project"}`);
        menu.title = "Delete project";

        menu.addEventListener("click", event => {
            event.stopPropagation();
            openDeleteModal(project);
        });

        header.append(icon, menu);

        const name = document.createElement("h3");
        name.className = "project-card-title";
        name.textContent = project.name || "Untitled project";

        const description = document.createElement("p");
        description.className = "project-card-description";
        description.textContent = "Academic research project";

        const divider = document.createElement("div");
        divider.className = "project-card-divider";

        const footer = document.createElement("div");
        footer.className = "project-card-footer";

        const projectId = document.createElement("span");
        projectId.className = "project-card-id";
        projectId.textContent = `Project #${project.id}`;

        const openButton = document.createElement("button");
        openButton.type = "button";
        openButton.className = "project-open-btn";
        openButton.textContent = "Open project →";

        openButton.addEventListener("click", () => {
            openProject(project);
        });

        footer.append(projectId, openButton);
        card.append(header, name, description, divider, footer);

        fragment.appendChild(card);
    });

    projectsContainer.appendChild(fragment);
}


function openProject(project) {
    window.location.href = `workspace.html?id=${encodeURIComponent(project.id)}`;
}



function openDeleteModal(project) {
    projectToDelete = project;

    deleteModal.classList.add("active");
    deleteModal.setAttribute("aria-hidden", "false");

    document.body.classList.add("modal-open");

    confirmDeleteButton.disabled = false;
    confirmDeleteButton.textContent = "Delete project";

    cancelDeleteButton.focus();
}

function closeDeleteModal() {
    if (isDeleting) {
        return;
    }

    deleteModal.classList.remove("active");
    deleteModal.setAttribute("aria-hidden", "true");

    document.body.classList.remove("modal-open");

    projectToDelete = null;
}

function setupDeleteModal() {
    cancelDeleteButton.addEventListener("click", closeDeleteModal);

    deleteModal.addEventListener("click", event => {
        if (event.target === deleteModal) {
            closeDeleteModal();
        }
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && deleteModal.classList.contains("active")) {
            closeDeleteModal();
        }
    });

    confirmDeleteButton.addEventListener("click", deleteProject);
}

async function deleteProject() {
    if (!projectToDelete || isDeleting) {
        return;
    }

    isDeleting = true;
    confirmDeleteButton.disabled = true;
    confirmDeleteButton.textContent = "Deleting...";

    try {
        const response = await fetch(
            `${API_BASE_URL}/projects/${projectToDelete.id}`,
            {
                method: "DELETE"
            }
        );

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.detail || "Unable to delete this project.");
        }

        const deletedProjectName = projectToDelete.name;

        allProjects = allProjects.filter(
            project => project.id !== projectToDelete.id
        );

        projectToDelete = null;

        deleteModal.classList.remove("active");
        deleteModal.setAttribute("aria-hidden", "true");
        document.body.classList.remove("modal-open");

        updateProjectCount();
        renderProjects(allProjects.filter(project =>
            String(project.name || "")
                .toLowerCase()
                .includes(projectSearch.value.trim().toLowerCase())
        ));

        showToast(`"${deletedProjectName}" was deleted.`, "success");
    } catch (error) {
        showToast(error.message || "Something went wrong while deleting the project.", "error");
    } finally {
        isDeleting = false;
        confirmDeleteButton.disabled = false;
        confirmDeleteButton.textContent = "Delete project";
    }
}

function setupComingSoonLinks() {
    document.querySelectorAll("[data-coming-soon]").forEach(link => {
        link.addEventListener("click", event => {
            event.preventDefault();
            showToast("This feature is planned for a future update.", "info");
        });
    });
}

function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.setAttribute("role", "status");
    toast.textContent = message;

    toastContainer.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add("show");
    });

    setTimeout(() => {
        toast.classList.remove("show");

        setTimeout(() => {
            toast.remove();
        }, 250);
    }, 3500);
}