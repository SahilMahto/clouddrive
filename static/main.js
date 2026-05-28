/**
 * CLOUDDRIVE CLIENT LOGIC
 * Plain JavaScript to handle interactive upload, search, filters, delete, downloads, and themes.
 */

document.addEventListener("DOMContentLoaded", () => {
    
    // ==========================================================================
    // DOM ELEMENT SELECTORS
    // ==========================================================================
    
    const body = document.body;
    const themeToggle = document.getElementById("theme-toggle");
    const themeIconSun = document.getElementById("theme-icon-sun");
    const themeIconMoon = document.getElementById("theme-icon-moon");
    
    const storageBadge = document.getElementById("storage-badge");
    const badgeText = document.getElementById("badge-text");
    const demoBanner = document.getElementById("demo-banner");
    
    const dropZone = document.getElementById("drop-zone");
    const fileInput = document.getElementById("file-input");
    const browseBtn = document.querySelector(".browse-btn");
    
    const uploadProgressContainer = document.getElementById("upload-progress-container");
    const stagedFilename = document.getElementById("staged-filename");
    const stagedFilesize = document.getElementById("staged-filesize");
    const progressFill = document.getElementById("progress-fill");
    const progressPercent = document.getElementById("progress-percent");
    const uploadStatusText = document.getElementById("upload-status-text");
    
    const statCount = document.getElementById("stat-count");
    const statSize = document.getElementById("stat-size");
    const storageBarFill = document.getElementById("storage-bar-fill");
    
    const searchInput = document.getElementById("search-input");
    const filterChips = document.querySelectorAll(".filter-chips .chip");
    
    const filesGrid = document.getElementById("files-grid");
    const loadingSpinner = document.getElementById("loading-spinner");
    const emptyState = document.getElementById("empty-state");
    const fileCounterSubtitle = document.getElementById("file-counter-subtitle");
    const toastContainer = document.getElementById("toast-container");

    // ==========================================================================
    // APPLICATION STATE VARIABLES
    // ==========================================================================
    
    let allFiles = [];           // Cache for fetched files
    let currentFilter = "all";   // Active category filter
    let searchQuery = "";        // Active name search string
    let storageLimitBytes = 50 * 1024 * 1024; // Simulated visual limit of 50MB for progress bar representation
    let isAzureMode = false;

    // ==========================================================================
    // INITIALIZATION & CONFIGURATION CHECKS
    // ==========================================================================
    
    // Apply saved theme preference or default to dark mode
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "light") {
        body.classList.remove("dark-mode");
        body.classList.add("light-mode");
        themeIconSun.style.display = "none";
        themeIconMoon.style.display = "block";
    }

    // Check system configurations (Azure or Local Storage)
    async function checkServerStatus() {
        try {
            const response = await fetch("/api/status");
            const data = await response.json();
            
            if (data.status === "success") {
                isAzureMode = data.is_azure_configured;
                
                // Update Badge UI
                storageBadge.className = "badge"; // Reset loading class
                
                if (isAzureMode) {
                    storageBadge.classList.add("azure-badge");
                    badgeText.textContent = "Azure Blob Active";
                    demoBanner.style.display = "none";
                    showToast("Connected to Azure Blob Storage container: " + data.container_name, "info");
                } else {
                    storageBadge.classList.add("local-badge");
                    badgeText.textContent = "Demo Storage Mode";
                    demoBanner.style.display = "block";
                }
            }
        } catch (error) {
            console.error("Error fetching storage status:", error);
            storageBadge.className = "badge local-badge";
            badgeText.textContent = "Offline Mode";
            showToast("Server connection error. Running in offline state.", "error");
        }
    }

    // Retrieve file list from API
    async function loadFilesList(silent = false) {
        if (!silent) {
            filesGrid.style.display = "none";
            emptyState.style.display = "none";
            loadingSpinner.style.display = "flex";
        }
        
        try {
            const response = await fetch("/api/files");
            const data = await response.json();
            
            if (data.status === "success") {
                allFiles = data.files;
                renderFiles();
                updateStats();
            } else {
                showToast("Failed to fetch files: " + data.message, "error");
            }
        } catch (error) {
            console.error("Error loading files list:", error);
            showToast("Error retrieving files from server.", "error");
        } finally {
            loadingSpinner.style.display = "none";
        }
    }

    // ==========================================================================
    // THEME HANDLING
    // ==========================================================================
    
    themeToggle.addEventListener("click", () => {
        if (body.classList.contains("dark-mode")) {
            body.classList.remove("dark-mode");
            body.classList.add("light-mode");
            themeIconSun.style.display = "none";
            themeIconMoon.style.display = "block";
            localStorage.setItem("theme", "light");
            showToast("Switched to Light theme", "info");
        } else {
            body.classList.remove("light-mode");
            body.classList.add("dark-mode");
            themeIconMoon.style.display = "none";
            themeIconSun.style.display = "block";
            localStorage.setItem("theme", "dark");
            showToast("Switched to Dark theme", "info");
        }
    });

    // ==========================================================================
    // DRAG AND DROP & SELECTION EVENT HANDLERS
    // ==========================================================================

    // Browse click handlers
    browseBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // Avoid triggering dropzone click twice
        fileInput.click();
    });
    
    dropZone.addEventListener("click", () => {
        fileInput.click();
    });
    
    fileInput.addEventListener("change", () => {
        if (fileInput.files.length > 0) {
            handleFileUpload(fileInput.files[0]);
        }
    });

    // Drag-over styling shifts
    ["dragenter", "dragover"].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add("dragover");
        }, false);
    });

    ["dragleave", "drop"].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove("dragover");
        }, false);
    });

    // Handle dropped files
    dropZone.addEventListener("drop", (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            handleFileUpload(files[0]);
        }
    });

    // ==========================================================================
    // AJAX UPLOAD FUNCTION WITH PROGRESS METER
    // ==========================================================================
    
    function handleFileUpload(file) {
        const maxSize = 10 * 1024 * 1024; // 10MB limit
        
        // Show file warning limit in client side
        if (file.size > maxSize) {
            showToast(`File "${file.name}" is too large! Maximum limit is 10MB.`, "error");
            
            // Highlight dropzone boundary as error briefly
            dropZone.style.borderColor = "var(--color-error)";
            setTimeout(() => {
                dropZone.style.borderColor = "";
            }, 2000);
            return;
        }

        // Show Upload Progress UI
        uploadProgressContainer.style.display = "block";
        stagedFilename.textContent = file.name;
        stagedFilesize.textContent = formatBytes(file.size);
        progressFill.style.width = "0%";
        progressPercent.textContent = "0%";
        uploadStatusText.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Preparing upload...`;
        
        // Disable file selection inputs during upload
        dropZone.style.pointerEvents = "none";
        
        // Setup Form Data
        const formData = new FormData();
        formData.append("file", file);
        
        // Create custom XMLHttp Request to monitor progress percentage
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/upload", true);
        
        // Setup Progress Listener
        xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable) {
                const percentComplete = Math.round((e.loaded / e.total) * 100);
                progressFill.style.width = percentComplete + "%";
                progressPercent.textContent = percentComplete + "%";
                
                if (percentComplete < 100) {
                    uploadStatusText.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Uploading: ${percentComplete}%`;
                } else {
                    uploadStatusText.innerHTML = `<i class="fa-solid fa-cloud-arrow-up fa-bounce"></i> Processing file in cloud...`;
                }
            }
        });
        
        // Setup Completion Handler
        xhr.onload = function() {
            // Restore Dropzone Inputs
            dropZone.style.pointerEvents = "auto";
            
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const response = JSON.parse(xhr.responseText);
                    if (response.status === "success") {
                        showToast(`"${file.name}" uploaded successfully!`, "success");
                        
                        // Briefly show 100% complete before hiding panel
                        progressFill.style.width = "100%";
                        progressPercent.textContent = "100%";
                        uploadStatusText.innerHTML = `<span style="color: var(--color-success)"><i class="fa-solid fa-circle-check"></i> Complete!</span>`;
                        
                        // Close Upload widget and refresh listings
                        setTimeout(() => {
                            uploadProgressContainer.style.display = "none";
                            fileInput.value = ""; // Reset file input
                        }, 2000);
                        
                        loadFilesList(true); // Load files silently (without full container loading indicators)
                    } else {
                        handleUploadFailure(response.message);
                    }
                } catch (e) {
                    handleUploadFailure("Invalid server response format.");
                }
            } else {
                try {
                    const response = JSON.parse(xhr.responseText);
                    handleUploadFailure(response.message || "Upload failed with status code " + xhr.status);
                } catch(e) {
                    handleUploadFailure("Connection interrupted or upload rejected.");
                }
            }
        };
        
        // Setup Connection/Error handlers
        xhr.onerror = function() {
            dropZone.style.pointerEvents = "auto";
            handleUploadFailure("Network connection error during transfer.");
        };
        
        // Send request
        xhr.send(formData);
    }
    
    function handleUploadFailure(message) {
        showToast(message, "error");
        uploadStatusText.innerHTML = `<span style="color: var(--color-error)"><i class="fa-solid fa-circle-xmark"></i> Failed</span>`;
        progressFill.style.backgroundColor = "var(--color-error)";
        
        setTimeout(() => {
            uploadProgressContainer.style.display = "none";
            fileInput.value = "";
        }, 4000);
    }

    // ==========================================================================
    // DELETION ACTION METHOD
    // ==========================================================================
    
    async function deleteFile(filename) {
        if (!confirm(`Are you sure you want to permanently delete "${filename}"?`)) {
            return;
        }
        
        showToast(`Deleting "${filename}"...`, "info");
        
        try {
            const response = await fetch(`/api/files/${encodeURIComponent(filename)}`, {
                method: "DELETE"
            });
            const data = await response.json();
            
            if (data.status === "success") {
                showToast(data.message, "success");
                loadFilesList(true); // Refresh silently
            } else {
                showToast("Failed to delete: " + data.message, "error");
            }
        } catch (error) {
            console.error("Deletion error:", error);
            showToast("Network error trying to delete file.", "error");
        }
    }

    // ==========================================================================
    // SEARCH & CATEGORY FILTERS EVENT BINDINGS
    // ==========================================================================
    
    // Search handler
    searchInput.addEventListener("input", (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        renderFiles();
    });

    // Category chips selection
    filterChips.forEach(chip => {
        chip.addEventListener("click", () => {
            filterChips.forEach(c => c.classList.remove("active"));
            chip.classList.add("active");
            
            currentFilter = chip.getAttribute("data-filter");
            renderFiles();
        });
    });

    // ==========================================================================
    // VIEW RENDERING & GRAPHICAL COMPUTATIONS
    // ==========================================================================
    
    function renderFiles() {
        filesGrid.innerHTML = "";
        
        // Apply search query and category filters
        const filtered = allFiles.filter(file => {
            const matchesSearch = file.name.toLowerCase().includes(searchQuery);
            const category = getFileCategory(file.name);
            const matchesFilter = (currentFilter === "all") || (category === currentFilter);
            return matchesSearch && matchesFilter;
        });

        // Set subtitles
        fileCounterSubtitle.textContent = `${filtered.length} item${filtered.length !== 1 ? 's' : ''}`;

        // Empty states checks
        if (filtered.length === 0) {
            filesGrid.style.display = "none";
            emptyState.style.display = "flex";
            return;
        }

        emptyState.style.display = "none";
        filesGrid.style.display = "grid";

        filtered.forEach(file => {
            const fileCard = createFileCard(file);
            filesGrid.appendChild(fileCard);
        });
    }

    function createFileCard(file) {
        const category = getFileCategory(file.name);
        const iconConfig = getIconConfig(category);
        const card = document.createElement("div");
        card.className = `file-card ${category}-type`;
        
        // Clean Date presentation (YYYY-MM-DD HH:MM)
        const dateObj = new Date(file.last_modified);
        const formattedDate = dateObj.toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric"
        });

        const formattedSize = formatBytes(file.size);
        
        card.innerHTML = `
            <div class="file-card-preview">
                <i class="${iconConfig.icon}"></i>
            </div>
            
            <div class="file-card-info">
                <p class="file-card-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</p>
                <div class="file-card-meta">
                    <span class="file-card-date">${formattedDate}</span>
                    <span class="file-card-size">${formattedSize}</span>
                </div>
            </div>
            
            <div class="file-url-display" title="${escapeHtml(file.url)}">
                URL: ${escapeHtml(file.url)}
            </div>
            
            <div class="file-card-actions">
                <!-- Uses download proxy server API route -->
                <a href="${file.download_url}" class="download-link-btn" title="Download File">
                    <i class="fa-solid fa-arrow-down-to-bracket"></i> Download
                </a>
                
                <!-- Copies Direct Blob Storage Link to Clipboard -->
                <button class="btn-secondary copy-url-btn" data-url="${escapeHtml(file.url)}" title="Copy Azure Storage URL">
                    <i class="fa-solid fa-link"></i>
                </button>
                
                <!-- Triggers API delete endpoint -->
                <button class="btn-secondary btn-danger delete-file-btn" data-name="${escapeHtml(file.name)}" title="Delete File">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        `;
        
        // Clipboard binding
        const copyBtn = card.querySelector(".copy-url-btn");
        copyBtn.addEventListener("click", () => {
            const url = copyBtn.getAttribute("data-url");
            navigator.clipboard.writeText(url).then(() => {
                showToast("Copied Azure Storage URL to clipboard!", "success");
            }).catch(err => {
                showToast("Clipboard copy failed.", "warning");
            });
        });
        
        // Delete button binding
        const deleteBtn = card.querySelector(".delete-file-btn");
        deleteBtn.addEventListener("click", () => {
            const name = deleteBtn.getAttribute("data-name");
            deleteFile(name);
        });

        return card;
    }

    // Determine general file classifications based on extensions
    function getFileCategory(filename) {
        const ext = filename.split(".").pop().toLowerCase();
        
        if (ext === "pdf") {
            return "pdf";
        }
        
        const imageExtensions = ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "tiff"];
        if (imageExtensions.includes(ext)) {
            return "image";
        }
        
        const documentExtensions = ["doc", "docx", "txt", "rtf", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "pages"];
        if (documentExtensions.includes(ext)) {
            return "doc";
        }

        const archiveExtensions = ["zip", "rar", "7z", "tar", "gz", "bz2"];
        if (archiveExtensions.includes(ext)) {
            return "archive";
        }
        
        return "other";
    }

    // Match icons to categories
    function getIconConfig(category) {
        switch(category) {
            case "pdf":
                return { icon: "fa-solid fa-file-pdf" };
            case "image":
                return { icon: "fa-solid fa-file-image" };
            case "doc":
                return { icon: "fa-solid fa-file-word" };
            case "archive":
                return { icon: "fa-solid fa-file-zipper" };
            default:
                return { icon: "fa-solid fa-file" };
        }
    }

    // Refresh drive summary metrics
    function updateStats() {
        const totalCount = allFiles.length;
        let totalSize = 0;
        
        allFiles.forEach(file => {
            totalSize += file.size;
        });

        statCount.textContent = totalCount;
        statSize.textContent = formatBytes(totalSize);

        // Compute fill width on overview metrics (relative to budget)
        const percentFill = Math.min((totalSize / storageLimitBytes) * 100, 100);
        storageBarFill.style.width = percentFill + "%";
        
        if (percentFill >= 90) {
            storageBarFill.style.background = "var(--color-error)";
        } else if (percentFill >= 70) {
            storageBarFill.style.background = "var(--color-warning)";
        } else {
            storageBarFill.style.background = "var(--primary-gradient)";
        }
    }

    // ==========================================================================
    // UTILITIES (TOASTS, BYTES FORMATTERS, HTML SANITIZERS)
    // ==========================================================================
    
    // Stackable notification alert banner
    function showToast(message, type = "success") {
        const toast = document.createElement("div");
        toast.className = `toast ${type}`;
        
        let icon = "fa-circle-check";
        if (type === "warning") icon = "fa-triangle-exclamation";
        if (type === "error") icon = "fa-circle-xmark";
        if (type === "info") icon = "fa-circle-info";

        toast.innerHTML = `
            <i class="fa-solid ${icon} toast-icon"></i>
            <div class="toast-content">${escapeHtml(message)}</div>
            <i class="fa-solid fa-xmark toast-close"></i>
        `;
        
        toastContainer.appendChild(toast);
        
        // Auto remove toast after 4s
        const autoRemove = setTimeout(() => {
            removeToast(toast);
        }, 4000);
        
        // Manual close click
        toast.querySelector(".toast-close").addEventListener("click", () => {
            clearTimeout(autoRemove);
            removeToast(toast);
        });
    }

    function removeToast(toast) {
        toast.style.animation = "slideIn 0.3s ease reverse forwards";
        toast.style.opacity = "0";
        setTimeout(() => {
            if (toast.parentNode === toastContainer) {
                toastContainer.removeChild(toast);
            }
        }, 300);
    }

    // Format bytes to readable size scales
    function formatBytes(bytes, decimals = 1) {
        if (bytes === 0) return "0 Bytes";
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ["Bytes", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
    }

    // Escape character injections
    function escapeHtml(string) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return String(string).replace(/[&<>"']/g, function(m) { return map[m]; });
    }

    // ==========================================================================
    // INITIAL SYSTEM START
    // ==========================================================================
    
    checkServerStatus().then(() => {
        loadFilesList();
    });
});
