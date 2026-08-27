// App State
let currentTab = 'download';
let downloadPath = '';
let activeDownloadsCount = 0;
let libraryFilter = 'all';
let lastAnalyzedInfo = null;

const localeMap = {
    tr: 'tr-TR',
    en: 'en-US',
    de: 'de-DE',
    it: 'it-IT',
    ru: 'ru-RU',
    es: 'es-ES'
};

function getThumbnailUrl(url, thumbnail) {
    if (thumbnail && thumbnail.trim() !== '') {
        if (thumbnail.startsWith('http://') || thumbnail.startsWith('https://') || thumbnail.startsWith('data:')) {
            return thumbnail;
        }
        let normalizedPath = thumbnail.replace(/\\/g, '/');
        if (!normalizedPath.startsWith('file:///')) {
            normalizedPath = 'file:///' + normalizedPath;
        }
        return normalizedPath;
    }
    try {
        let videoId = '';
        if (url && url.includes('youtu.be/')) {
            videoId = url.split('youtu.be/')[1].split(/[?#]/)[0];
        } else if (url && url.includes('watch?v=')) {
            videoId = url.split('watch?v=')[1].split('&')[0];
        } else if (url && url.includes('embed/')) {
            videoId = url.split('embed/')[1].split(/[?#]/)[0];
        } else if (url && url.includes('v/')) {
            videoId = url.split('v/')[1].split(/[?#]/)[0];
        }
        if (videoId) {
            return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
        }
    } catch (e) {
        console.error("Error parsing video ID for thumbnail:", e);
    }
    return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='68' viewBox='0 0 120 68' fill='%23eeeeee'><rect width='120' height='68' fill='%23eeeeee'/><path d='M60 24v20M50 34h20' stroke='%23888888' stroke-width='2' stroke-linecap='round'/></svg>";
}


// Initialize when ready
document.addEventListener('DOMContentLoaded', () => {
    if (typeof qt !== 'undefined' && qt.webChannelTransport) {
        // Qt WebEngine QWebChannel
        new QWebChannel(qt.webChannelTransport, function(channel) {
            window.pywebview = {
                api: channel.objects.api
            };
            initApp();
        });
    } else {
        // PyWebView fallback
        window.addEventListener('pywebviewready', () => {
            initApp();
        });
        
        // Wait briefly to see if pywebview loaded. If not, trigger mock
        setTimeout(() => {
            if (!window.pywebview && typeof qt === 'undefined') {
                console.log("Running in browser mockup mode");
                setupUIEvents();
            }
        }, 500);
    }
});

async function initApp() {
    setupUIEvents();
    
    // Fetch initial configurations
    try {
        // Load language preference (Default: 'en')
        let savedLang = 'en';
        if (window.pywebview) {
            const dbLang = await window.pywebview.api.get_setting('language');
            if (dbLang) savedLang = dbLang;
            else savedLang = localStorage.getItem('app-language') || 'en';
        } else {
            savedLang = localStorage.getItem('app-language') || 'en';
        }
        
        applyLanguage(savedLang);
        const langSelect = document.getElementById('language-select');
        if (langSelect) langSelect.value = savedLang;

        downloadPath = await window.pywebview.api.get_default_download_dir();
        document.getElementById('download-path-text').innerText = downloadPath;
        
        // Load CPU threads setting
        const cpuThreads = await window.pywebview.api.get_setting('cpu_threads');
        if (cpuThreads) {
            const cpuSelect = document.getElementById('cpu-threads-select');
            if (cpuSelect) cpuSelect.value = cpuThreads;
        } else {
            const cpuSelect = document.getElementById('cpu-threads-select');
            if (cpuSelect) cpuSelect.value = '2'; // Default laptop friendly
        }
    } catch (e) {
        console.error("Error getting default path or settings:", e);
    }

    // Initialize library view mode
    const viewMode = localStorage.getItem('lib-view-mode') || 'grid';
    const libList = document.getElementById('library-list');
    if (libList) {
        libList.className = `list-container ${viewMode}-view`;
    }
    updateViewModeButtons(viewMode);
    
    // Initialize downloads view mode
    const dlViewMode = localStorage.getItem('downloads-view-mode') || 'list';
    const historyContainer = document.getElementById('history-downloads-container');
    if (historyContainer) {
        historyContainer.className = `list-container ${dlViewMode}-view`;
    }
    updateDownloadsViewModeButtons(dlViewMode);

    // Load library and downloads history
    loadLibrary();
    loadDownloadsHistory();
    
    showToast(t('toast_app_loaded'));
}

function showToast(message) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-message');
    toastMsg.innerText = message;
    toast.style.display = 'block';
    
    setTimeout(() => {
        toast.style.display = 'none';
    }, 3000);
}

// Set up UI Event Listeners
function setupUIEvents() {
    // Tab switching
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetTab = item.getAttribute('data-tab');
            switchTab(targetTab);
        });
    });

    // Analyze button click
    document.getElementById('btn-analyze').addEventListener('click', analyzeUrl);
    document.getElementById('youtube-url').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') analyzeUrl();
    });

    // Paste button click
    document.getElementById('btn-paste').addEventListener('click', async () => {
        try {
            const text = await window.pywebview.api.get_clipboard();
            if (text) {
                document.getElementById('youtube-url').value = text.trim();
                document.getElementById('youtube-url').focus();
            }
        } catch (err) {
            console.error('Clipboard paste failed:', err);
        }
    });

    // Settings folder selector
    document.getElementById('btn-change-path').addEventListener('click', changeDownloadFolder);

    // Language setting change listener
    const langSelect = document.getElementById('language-select');
    if (langSelect) {
        langSelect.addEventListener('change', async (e) => {
            const selectedLang = e.target.value;
            applyLanguage(selectedLang);
            localStorage.setItem('app-language', selectedLang);
            if (window.pywebview) {
                await window.pywebview.api.set_setting('language', selectedLang);
            }
            showToast(t('toast_lang_set'));
            
            // Re-render current tab contents to refresh localized dynamic labels
            if (currentTab === 'library') {
                loadLibrary();
            } else if (currentTab === 'downloads-list') {
                loadDownloadsHistory();
            }
            // If media info card is currently open, re-render with lastAnalyzedInfo
            if (lastAnalyzedInfo) {
                renderMediaInfo(lastAnalyzedInfo);
            }
        });
    }

    // CPU Threads setting change listener
    const cpuSelect = document.getElementById('cpu-threads-select');
    if (cpuSelect) {
        cpuSelect.addEventListener('change', async (e) => {
            const val = e.target.value;
            if (window.pywebview) {
                await window.pywebview.api.set_setting('cpu_threads', val);
                showToast(t('toast_cpu_set', { threads: val }));
            }
        });
    }

    // Library updates listeners
    const btnCheckUpdates = document.getElementById('btn-check-updates');
    if (btnCheckUpdates) {
        btnCheckUpdates.addEventListener('click', checkLibraryUpdates);
    }
    const btnUpdateAll = document.getElementById('btn-update-all');
    if (btnUpdateAll) {
        btnUpdateAll.addEventListener('click', updateAllLibraries);
    }

    // Clear user data listener
    const btnClearData = document.getElementById('btn-clear-data');
    if (btnClearData) {
        btnClearData.addEventListener('click', async () => {
            const confirmed = confirm(t('confirm_clear_data'));
            if (!confirmed) return;
            
            try {
                let success = true;
                if (window.pywebview) {
                    success = await window.pywebview.api.clear_all_data();
                }
                
                if (success) {
                    // Clear local storage items
                    localStorage.removeItem('app-language');
                    localStorage.removeItem('lib-view-mode');
                    localStorage.removeItem('downloads-view-mode');
                    
                    // Reset to default language 'en'
                    applyLanguage('en');
                    const langSelect = document.getElementById('language-select');
                    if (langSelect) langSelect.value = 'en';
                    
                    // Reset CPU threads to 2
                    const cpuSelect = document.getElementById('cpu-threads-select');
                    if (cpuSelect) cpuSelect.value = '2';
                    
                    // Reset download path display
                    if (window.pywebview) {
                        downloadPath = await window.pywebview.api.get_default_download_dir();
                        const pathElem = document.getElementById('download-path-text');
                        if (pathElem) pathElem.innerText = downloadPath;
                    }
                    
                    // Reload views
                    loadLibrary();
                    loadDownloadsHistory();
                    
                    showToast(t('toast_data_cleared'));
                } else {
                    showToast(t('toast_data_clear_failed'));
                }
            } catch (err) {
                console.error("Clear data error:", err);
                showToast(t('toast_data_clear_failed'));
            }
        });
    }



    // Library form toggles
    document.getElementById('btn-open-add-library').addEventListener('click', () => {
        document.getElementById('add-library-box').style.display = 'block';
        document.getElementById('btn-open-add-library').style.display = 'none';
    });
    
    document.getElementById('btn-cancel-library').addEventListener('click', () => {
        document.getElementById('add-library-box').style.display = 'none';
        document.getElementById('btn-open-add-library').style.display = 'block';
        clearLibraryForm();
    });

    document.getElementById('btn-save-library').addEventListener('click', saveToLibrary);

    // Library paste button click
    document.getElementById('btn-paste-library').addEventListener('click', async () => {
        try {
            const text = await window.pywebview.api.get_clipboard();
            if (text) {
                document.getElementById('lib-url').value = text.trim();
                document.getElementById('lib-url').focus();
            }
        } catch (err) {
            console.error('Clipboard paste failed:', err);
        }
    });

    // Library filter buttons
    document.getElementById('lib-filter-all').addEventListener('click', () => setLibraryFilter('all'));
    document.getElementById('lib-filter-video').addEventListener('click', () => setLibraryFilter('video'));
    document.getElementById('lib-filter-playlist').addEventListener('click', () => setLibraryFilter('playlist'));

    // Library view mode buttons
    document.getElementById('btn-view-list').addEventListener('click', () => setLibraryViewMode('list'));
    document.getElementById('btn-view-grid').addEventListener('click', () => setLibraryViewMode('grid'));

    // Downloads view mode buttons
    const btnDlList = document.getElementById('btn-dl-view-list');
    const btnDlGrid = document.getElementById('btn-dl-view-grid');
    if (btnDlList) btnDlList.addEventListener('click', () => setDownloadsViewMode('list'));
    if (btnDlGrid) btnDlGrid.addEventListener('click', () => setDownloadsViewMode('grid'));

    // Clear history button
    document.getElementById('btn-clear-history').addEventListener('click', clearHistory);

    // Initial Lucide icons render

    if (window.lucide) {
        window.lucide.createIcons();
    }
}

// Switch navigation tabs
function switchTab(tabId) {
    currentTab = tabId;
    
    // Update active class on nav buttons
    document.querySelectorAll('.nav-item').forEach(item => {
        if (item.getAttribute('data-tab') === tabId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // Update active class on panels
    document.querySelectorAll('.tab-panel').forEach(panel => {
        if (panel.id === `tab-${tabId}`) {
            panel.classList.add('active');
        } else {
            panel.classList.remove('remove'); // Reset animation state
            panel.classList.remove('active');
        }
    });

    // Refresh data when switching tabs
    if (tabId === 'library') {
        loadLibrary();
    } else if (tabId === 'downloads-list') {
        loadDownloadsHistory();
    }
}

// URL analysis handler
async function analyzeUrl() {
    const urlInput = document.getElementById('youtube-url');
    const url = urlInput.value.trim();
    
    if (!url) {
        showToast(t('toast_url_required'));
        return;
    }

    const spinner = document.getElementById('analysis-loading');
    const infoCard = document.getElementById('media-info-card');
    
    spinner.style.display = 'flex';
    infoCard.style.display = 'none';
    infoCard.innerHTML = '';

    try {
        let info = null;
        if (window.pywebview) {
            info = await window.pywebview.api.analyze_link(url);
        } else {
            // Mock mode inside generic browser
            await new Promise(r => setTimeout(r, 2000));
            info = getMockInfo(url);
        }

        spinner.style.display = 'none';

        if (info.error) {
            showToast(`${t('status_failed')}: ${info.error}`);
            return;
        }

        lastAnalyzedInfo = info;
        renderMediaInfo(info);

    } catch (e) {
        spinner.style.display = 'none';
        showToast(`${t('status_failed')}: ${e.message}`);
    }
}

// Helper to format duration
function formatSeconds(secs) {
    if (!secs) return "00:00";
    const minutes = Math.floor(secs / 60);
    const seconds = Math.floor(secs % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Helper to format file size
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// Render video/playlist analysis result
function renderMediaInfo(info) {
    const infoCard = document.getElementById('media-info-card');
    infoCard.style.display = 'flex';

    if (info.type === 'video') {
        infoCard.innerHTML = `
            <div class="media-main-info">
                <img class="media-thumbnail" src="${info.thumbnail || 'https://via.placeholder.com/200x112'}" alt="thumbnail">
                <div class="media-details">
                    <div class="media-title">${info.title || t('untitled_media')}</div>
                    <div class="media-meta">
                        <span><strong>${t('channel')}:</strong> ${info.author || t('unknown_channel')}</span>
                        <span><strong>${t('duration')}:</strong> ${formatSeconds(info.duration)}</span>
                    </div>
                </div>
            </div>
            
            <div class="download-config">
                <div class="config-row">
                    <div class="config-item">
                        <span class="config-label">${t('format')}</span>
                        <div class="format-selector">
                            <button class="format-btn active" id="btn-fmt-mp4">MP4</button>
                            <button class="format-btn" id="btn-fmt-mp3">MP3</button>
                            <button class="format-btn" id="btn-fmt-m4a">M4A (${t('format_original')})</button>
                        </div>
                    </div>
                    
                    <div class="config-item" id="resolution-config-item">
                        <span class="config-label">${t('resolution')}</span>
                        <select class="dropdown-select" id="resolution-select">
                            ${info.resolutions.map(r => `<option value="${r}">${r}</option>`).join('')}
                        </select>
                    </div>

                    <div class="config-item" style="margin-left: auto; justify-content: flex-end; align-self: flex-end;">
                        <button id="btn-start-download" class="btn-primary">
                            <i data-lucide="download"></i>
                            <span>${t('start_download')}</span>
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Format selector logic
        const mp4Btn = document.getElementById('btn-fmt-mp4');
        const mp3Btn = document.getElementById('btn-fmt-mp3');
        const m4aBtn = document.getElementById('btn-fmt-m4a');
        const resConfig = document.getElementById('resolution-config-item');
        const resSelect = document.getElementById('resolution-select');
        const resLabel = resConfig.querySelector('.config-label');
        let selectedFormat = 'mp4';

        const mp3Options = ['320kbps', '256kbps', '192kbps', '128kbps'];
        const m4aOptions = [t('original_quality'), '256kbps', '192kbps', '128kbps'];
        const mp4Options = info.resolutions || [];

        mp4Btn.addEventListener('click', () => {
            selectedFormat = 'mp4';
            mp4Btn.classList.add('active');
            mp3Btn.classList.remove('active');
            m4aBtn.classList.remove('active');
            resLabel.innerText = t('resolution');
            resSelect.innerHTML = mp4Options.map(r => `<option value="${r}">${r}</option>`).join('');
        });

        mp3Btn.addEventListener('click', () => {
            selectedFormat = 'mp3';
            mp3Btn.classList.add('active');
            mp4Btn.classList.remove('active');
            m4aBtn.classList.remove('active');
            resLabel.innerText = t('audio_quality');
            resSelect.innerHTML = mp3Options.map(k => `<option value="${k}">${k}</option>`).join('');
        });

        m4aBtn.addEventListener('click', () => {
            selectedFormat = 'm4a';
            m4aBtn.classList.add('active');
            mp4Btn.classList.remove('active');
            mp3Btn.classList.remove('active');
            resLabel.innerText = t('audio_quality');
            resSelect.innerHTML = m4aOptions.map(k => `<option value="${k}">${k}</option>`).join('');
        });

        // Start Download Trigger
        document.getElementById('btn-start-download').addEventListener('click', () => {
            const resolution = resSelect.value;
            triggerDownload(info.url, info.title, selectedFormat, resolution);
        });

    } else if (info.type === 'playlist') {
        infoCard.innerHTML = `
            <div class="media-main-info">
                <div class="media-details">
                    <div class="media-title">${info.title || t('untitled_media')}</div>
                    <div class="media-meta">
                        <span><strong>${t('format')}:</strong> ${t('type_playlist')}</span>
                        <span><strong>${t('video_count')}:</strong> ${info.entries_count}</span>
                    </div>
                </div>
            </div>
            
            <div class="download-config">
                <div class="config-row">
                    <div class="config-item">
                        <span class="config-label">${t('format')}</span>
                        <div class="format-selector">
                            <button class="format-btn active" id="btn-fmt-mp4">MP4</button>
                            <button class="format-btn" id="btn-fmt-mp3">MP3</button>
                            <button class="format-btn" id="btn-fmt-m4a">M4A (${t('format_original')})</button>
                        </div>
                    </div>
                    
                    <div class="config-item" id="resolution-config-item">
                        <span class="config-label">${t('highest_resolution')}</span>
                        <select class="dropdown-select" id="resolution-select">
                            <option value="1080p">1080p</option>
                            <option value="720p">720p</option>
                            <option value="480p">480p</option>
                            <option value="360p">360p</option>
                        </select>
                    </div>

                    <div class="config-item" style="margin-left: auto; justify-content: flex-end; align-self: flex-end;">
                        <button id="btn-start-download" class="btn-primary">
                            <i data-lucide="download"></i>
                            <span>${t('download_selected')}</span>
                        </button>
                    </div>
                </div>
            </div>

            <div class="playlist-entries-card">
                <div class="playlist-entries-header-row">
                    <span class="playlist-entries-header">${t('playlist_content')}</span>
                    <label class="playlist-select-all">
                        <input type="checkbox" id="playlist-select-all-cb" checked>
                        <span>${t('select_all')}</span>
                    </label>
                </div>
                <div class="playlist-entries-list">
                    ${info.entries.map((e, index) => `
                        <div class="playlist-entry-item">
                            <label class="playlist-entry-label">
                                <input type="checkbox" class="playlist-entry-cb" data-index="${index}" data-url="${e.url || ''}" data-title="${(e.title || 'Video ' + (index+1)).replace(/"/g, '&quot;')}" checked>
                                <img class="playlist-entry-thumb" src="${e.thumbnail || 'https://via.placeholder.com/60x34'}" alt="thumb">
                                <span class="playlist-entry-title">${index + 1}. ${e.title || t('unknown_video')}</span>
                            </label>
                            <span class="playlist-entry-duration">${e.duration ? formatSeconds(e.duration) : ''}</span>
                        </div>
                    `).join('')}
                </div>
                <div class="playlist-selection-info">
                    <span id="playlist-selected-count">${t('videos_selected', { selected: info.entries.length, total: info.entries.length })}</span>
                </div>
            </div>
        `;

        // Select All checkbox logic
        const selectAllCb = document.getElementById('playlist-select-all-cb');
        const entryCbs = document.querySelectorAll('.playlist-entry-cb');
        const selectedCountEl = document.getElementById('playlist-selected-count');
        const totalEntries = info.entries.length;

        function updateSelectedCount() {
            const checked = document.querySelectorAll('.playlist-entry-cb:checked').length;
            selectedCountEl.innerText = t('videos_selected', { selected: checked, total: totalEntries });
        }

        selectAllCb.addEventListener('change', () => {
            entryCbs.forEach(cb => cb.checked = selectAllCb.checked);
            updateSelectedCount();
        });

        entryCbs.forEach(cb => {
            cb.addEventListener('change', () => {
                const allChecked = document.querySelectorAll('.playlist-entry-cb:checked').length === totalEntries;
                selectAllCb.checked = allChecked;
                updateSelectedCount();
            });
        });

        const mp4Btn = document.getElementById('btn-fmt-mp4');
        const mp3Btn = document.getElementById('btn-fmt-mp3');
        const m4aBtn = document.getElementById('btn-fmt-m4a');
        const resConfig = document.getElementById('resolution-config-item');
        const resSelect = document.getElementById('resolution-select');
        const resLabel = resConfig.querySelector('.config-label');
        let selectedFormat = 'mp4';

        const mp3Options = ['320kbps', '256kbps', '192kbps', '128kbps'];
        const m4aOptions = [t('original_quality'), '256kbps', '192kbps', '128kbps'];
        const mp4Options = ['1080p', '720p', '480p', '360p'];

        mp4Btn.addEventListener('click', () => {
            selectedFormat = 'mp4';
            mp4Btn.classList.add('active');
            mp3Btn.classList.remove('active');
            m4aBtn.classList.remove('active');
            resLabel.innerText = t('highest_resolution');
            resSelect.innerHTML = mp4Options.map(r => `<option value="${r}">${r}</option>`).join('');
        });

        mp3Btn.addEventListener('click', () => {
            selectedFormat = 'mp3';
            mp3Btn.classList.add('active');
            mp4Btn.classList.remove('active');
            m4aBtn.classList.remove('active');
            resLabel.innerText = t('audio_quality');
            resSelect.innerHTML = mp3Options.map(k => `<option value="${k}">${k}</option>`).join('');
        });

        m4aBtn.addEventListener('click', () => {
            selectedFormat = 'm4a';
            m4aBtn.classList.add('active');
            mp4Btn.classList.remove('active');
            mp3Btn.classList.remove('active');
            resLabel.innerText = t('audio_quality');
            resSelect.innerHTML = m4aOptions.map(k => `<option value="${k}">${k}</option>`).join('');
        });


        document.getElementById('btn-start-download').addEventListener('click', () => {
            const resolution = resSelect.value;
            const selectedCbs = document.querySelectorAll('.playlist-entry-cb:checked');
            
            if (selectedCbs.length === 0) {
                showToast(t('toast_select_at_least_one'));
                return;
            }

            // If more than 1 item is selected, download into a subfolder named after the playlist title
            const subfolder = selectedCbs.length > 1 ? (info.title || 'Oynatma Listesi') : '';

            // Download each selected video individually
            selectedCbs.forEach(cb => {
                const videoUrl = cb.getAttribute('data-url');
                const videoTitle = cb.getAttribute('data-title');
                if (videoUrl) {
                    triggerDownload(videoUrl, videoTitle, selectedFormat, resolution, subfolder);
                }
            });
        });
    }

    if (window.lucide) {
        window.lucide.createIcons();
    }
}

// Trigger Backend Download Process
async function triggerDownload(url, title, format, resolution, subfolder = '') {
    if (!window.pywebview) {
        showToast("Mock download started.");
        mockDownloadFlow(title, format, resolution);
        return;
    }

    try {
        const downloadId = await window.pywebview.api.start_download(url, format, resolution, subfolder || '');
        if (downloadId) {
            showToast(t('toast_download_queued'));
            switchTab('downloads-list');
            
            // Add a card to active downloads block dynamically
            insertActiveDownloadCard(downloadId, title, format, resolution);
            incrementActiveDownloadsBadge();
            loadDownloadsHistory();
        } else {
            showToast(t('toast_download_start_error'));
        }
    } catch (e) {
        showToast(`${t('status_failed')}: ${e.message}`);
    }
}

// Dynamic Insert Active Queue UI
function insertActiveDownloadCard(id, title, format, resolution) {
    const activeContainer = document.getElementById('active-downloads-container');
    const emptyMsg = document.getElementById('active-empty');
    if (emptyMsg) emptyMsg.style.display = 'none';

    // Remove existing if any duplication
    const existing = document.getElementById(`active-dl-${id}`);
    if (existing) existing.remove();

    const card = document.createElement('div');
    card.className = 'download-item';
    card.id = `active-dl-${id}`;
    card.innerHTML = `
        <div class="dl-header">
            <div class="dl-title" title="${title}">${title}</div>
            <div style="display: flex; gap: 8px; align-items: center;">
                <span class="dl-badge-format">${format} ${resolution}</span>
                <button class="dl-action-btn btn-cancel-download" data-id="${id}" title="${t('tooltip_cancel')}">
                    <i data-lucide="x-circle"></i>
                </button>
            </div>
        </div>
        <div class="dl-progress-track">
            <div class="dl-progress-bar" id="pb-${id}" style="width: 0%;"></div>
        </div>
        <div class="dl-footer">
            <span class="dl-status" id="status-${id}">${t('status_downloading')}</span>
            <div class="dl-stats">
                <span id="size-${id}"></span>
                <span id="speed-${id}">0 KB/s</span>
                <span id="eta-${id}">--</span>
            </div>
        </div>
    `;
    activeContainer.prepend(card);

    // Cancel click listener
    card.querySelector('.btn-cancel-download').addEventListener('click', async () => {
        if (window.pywebview) {
            await window.pywebview.api.cancel_download(id);
            showToast(t('toast_download_cancelling'));
        } else {
            window.downloadCompleted(id, false, t('btn_cancel'));
        }
    });

    if (window.lucide) {
        window.lucide.createIcons();
    }
}

// Global Progress updates (Called from Python context)
window.updateDownloadProgress = function(id, data) {
    const progressBar = document.getElementById(`pb-${id}`);
    const statusText = document.getElementById(`status-${id}`);
    const sizeText = document.getElementById(`size-${id}`);
    const speedText = document.getElementById(`speed-${id}`);
    const etaText = document.getElementById(`eta-${id}`);

    if (progressBar && data.percent !== undefined) {
        progressBar.style.width = `${data.percent}%`;
    }
    if (statusText) {
        if (data.status === 'converting') {
            statusText.innerText = t('status_converting');
            const card = document.getElementById(`active-dl-${id}`);
            if (card) card.classList.add('converting');
        } else if (data.status === 'downloading') {
            statusText.innerText = `%${data.percent}`;
        }
    }
    if (sizeText) {
        sizeText.innerText = data.size || '';
    }
    if (speedText && data.speed) speedText.innerText = data.speed;
    if (etaText && data.eta) etaText.innerText = data.eta;
};

// Global Completion update (Called from Python context)
window.downloadCompleted = function(id, success, pathOrError, fileSize) {
    // Remove from active UI
    const activeCard = document.getElementById(`active-dl-${id}`);
    if (activeCard) {
        activeCard.remove();
    }
    
    decrementActiveDownloadsBadge();

    // Check if active container is empty
    const activeContainer = document.getElementById('active-downloads-container');
    if (activeContainer.children.length <= 1) { // includes empty-state hidden block
        const emptyMsg = document.getElementById('active-empty');
        if (emptyMsg) emptyMsg.style.display = 'block';
    }

    if (success) {
        const sizeStr = fileSize ? ` (${formatBytes(fileSize)})` : '';
        showToast(`${t('toast_download_completed')}${sizeStr}`);
    } else {
        showToast(`${t('toast_download_failed')}: ${pathOrError}`);
    }

    // Refresh downloads history UI
    loadDownloadsHistory();
};

// Handle Active Badges on Sidebar
function incrementActiveDownloadsBadge() {
    activeDownloadsCount++;
    const badge = document.getElementById('active-badge');
    badge.innerText = activeDownloadsCount;
    badge.style.display = 'inline-block';
}

function decrementActiveDownloadsBadge() {
    activeDownloadsCount = Math.max(0, activeDownloadsCount - 1);
    const badge = document.getElementById('active-badge');
    if (activeDownloadsCount === 0) {
        badge.style.display = 'none';
    } else {
        badge.innerText = activeDownloadsCount;
    }
}

// Settings Folder Changer
async function changeDownloadFolder() {
    if (!window.pywebview) return;
    try {
        const path = await window.pywebview.api.select_download_dir();
        if (path) {
            downloadPath = path;
            document.getElementById('download-path-text').innerText = path;
            showToast(t('toast_folder_updated'));
        }
    } catch(e) {
        showToast(t('toast_folder_error'));
    }
}

// Library Operations
async function loadLibrary() {
    if (!window.pywebview) return;
    try {
        const items = await window.pywebview.api.get_library();
        renderLibraryItems(items);
    } catch (e) {
        console.error("Error loading library:", e);
    }
}

function setLibraryFilter(filter) {
    libraryFilter = filter;
    
    // Toggle class
    document.querySelectorAll('.tabs-sub button').forEach(btn => {
        if (btn.id === `lib-filter-${filter}`) {
            btn.className = 'sub-tabactive';
        } else {
            btn.className = 'sub-tab';
        }
    });

    loadLibrary();
}

function renderLibraryItems(items) {
    const list = document.getElementById('library-list');
    list.innerHTML = '';

    // Filter items
    const filtered = items.filter(item => {
        if (libraryFilter === 'all') return true;
        return item.type === libraryFilter;
    });

    if (filtered.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <i data-lucide="folder-open"></i>
                <p>${libraryFilter === 'all' ? t('empty_library') : t('empty_library_category')}</p>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    filtered.forEach(item => {
        const div = document.createElement('div');
        div.className = 'library-item-card clickable';
        div.innerHTML = `
            <div class="lib-item-thumb-wrapper">
                <img class="lib-item-thumb" src="${getThumbnailUrl(item.url, item.thumbnail)}" alt="thumb">
                <span class="lib-item-badge">${item.type === 'playlist' ? t('type_playlist') : t('type_video')}</span>
            </div>
            <div class="lib-item-details-grid">
                <div class="lib-item-title-grid" title="${item.title || item.url}">${item.title || t('untitled_link')}</div>
                <div class="lib-item-actions-grid">
                    <button class="btn-secondary btn-analyze-lib" data-url="${item.url}">${t('btn_analyze')}</button>
                    <button class="btn-danger-flat btn-delete-lib" data-id="${item.id}">${t('btn_delete')}</button>
                </div>
            </div>
        `;
        
        // Open the link in system browser when clicking the card (excluding buttons)
        div.addEventListener('click', (e) => {
            if (e.target.closest('.lib-item-actions-grid') || e.target.closest('button')) {
                return;
            }
            if (window.pywebview) {
                window.pywebview.api.open_link(item.url);
            } else {
                window.open(item.url, '_blank');
            }
        });

        list.appendChild(div);
    });


    // Add listeners to actions
    document.querySelectorAll('.btn-analyze-lib').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const url = e.target.getAttribute('data-url');
            document.getElementById('youtube-url').value = url;
            switchTab('download');
            analyzeUrl();
        });
    });

    document.querySelectorAll('.btn-delete-lib').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = parseInt(e.target.getAttribute('data-id'));
            if (window.pywebview) {
                const ok = await window.pywebview.api.remove_from_library(id);
                if (ok) {
                    showToast(t('toast_library_deleted'));
                    loadLibrary();
                } else {
                    showToast(t('toast_library_error'));
                }
            }
        });
    });
}

// Add new library item
async function saveToLibrary() {
    const url = document.getElementById('lib-url').value.trim();
    const title = document.getElementById('lib-title').value.trim();
    
    if (!url) {
        showToast(t('toast_url_required'));
        return;
    }

    // Basic heuristic to detect playlist
    const isPlaylist = url.includes('list=');
    const type = isPlaylist ? 'playlist' : 'video';

    // Show loading style or state if needed
    if (window.pywebview) {
        showToast(t('toast_library_saving'));
        const success = await window.pywebview.api.add_to_library(url, title, type);
        if (success) {
            showToast(t('toast_library_saved'));
            clearLibraryForm();
            // Close form box
            document.getElementById('add-library-box').style.display = 'none';
            document.getElementById('btn-open-add-library').style.display = 'block';
            loadLibrary();
        } else {
            showToast(t('toast_library_error'));
        }
    } else {
        showToast(t('toast_library_saved'));
    }
}

function clearLibraryForm() {
    document.getElementById('lib-url').value = '';
    document.getElementById('lib-title').value = '';
}

// Load and Render Completed History
async function loadDownloadsHistory() {
    if (!window.pywebview) return;
    try {
        const history = await window.pywebview.api.get_downloads_history();
        renderDownloadsHistory(history);
    } catch (e) {
        console.error("Error loading downloads history:", e);
    }
}

function renderDownloadsHistory(items) {
    const container = document.getElementById('history-downloads-container');
    container.innerHTML = '';

    const completed = items.filter(i => i.status === 'completed' || i.status === 'failed');

    if (completed.length === 0) {
        container.innerHTML = `
            <div class="empty-state-small" id="history-empty">
                <p>${t('empty_history')}</p>
            </div>
        `;
        return;
    }

    const currentLocale = localeMap[getCurrentLanguage()] || 'tr-TR';

    completed.forEach(item => {
        const formattedDate = new Date(item.created_at + 'Z').toLocaleString(currentLocale);
        const isSuccess = item.status === 'completed';
        const sizeStr = item.file_size ? formatBytes(item.file_size) : '';
        
        // Check if this item is inside a subfolder
        let itemSubfolder = '';
        if (item.path) {
            let normalizedItemPath = item.path.replace(/\\/g, '/');
            let normalizedDownloadPath = (downloadPath || '').replace(/\\/g, '/');
            if (normalizedDownloadPath && normalizedItemPath.startsWith(normalizedDownloadPath)) {
                let relative = normalizedItemPath.substring(normalizedDownloadPath.length).replace(/^\/+/, '');
                let parts = relative.split('/');
                if (parts.length > 1) {
                    itemSubfolder = parts[0];
                } else if (parts.length === 1 && !parts[0].includes('.')) {
                    itemSubfolder = parts[0];
                }
            }
        }
        
        const card = document.createElement('div');
        card.className = 'download-item-history';
        if (isSuccess && item.path) {
            card.classList.add('clickable');
            card.title = t('tooltip_open_file');
        }
        card.innerHTML = `
            <div class="dl-thumb-container">
                <img class="dl-history-thumb" src="${getThumbnailUrl(item.url, item.thumbnail)}" alt="thumb">
                ${!isSuccess ? `
                    <button class="dl-retry-badge-btn" title="${t('tooltip_retry')}" data-id="${item.id}" data-url="${item.url}" data-title="${(item.title || '').replace(/"/g, '&quot;')}" data-format="${item.format}" data-resolution="${item.resolution || ''}" data-subfolder="${(itemSubfolder || '').replace(/"/g, '&quot;')}">
                        <i data-lucide="rotate-cw"></i>
                    </button>
                ` : ''}
            </div>
            <div class="dl-history-details">
                <div class="dl-header">
                    <div class="dl-title" title="${item.title}">${item.title || t('untitled_media')}</div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        ${sizeStr ? `<span class="dl-badge-size">${sizeStr}</span>` : ''}
                        <span class="dl-badge-format">${item.format} ${item.resolution || ''}</span>
                    </div>
                </div>
                <div class="dl-footer" style="margin-top: 4px;">
                    <span class="dl-status ${item.status}">${isSuccess ? t('status_completed') : t('status_failed')}</span>
                    <div class="dl-stats" style="align-items: center; gap: 8px;">
                        <span style="font-size: 0.72rem; color: var(--text-muted);">${formattedDate}</span>
                        ${isSuccess && item.path ? `
                            <button class="dl-action-btn btn-open-folder" data-path="${item.path}" title="${t('tooltip_open_folder')}">
                                <i data-lucide="folder"></i>
                            </button>
                        ` : ''}
                        <button class="dl-action-btn btn-delete-download" data-id="${item.id}" title="${t('tooltip_delete_history')}">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(card);
    });

    // Retry download trigger listeners
    document.querySelectorAll('.dl-retry-badge-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            let target = e.target;
            while (target && !target.getAttribute('data-id')) {
                target = target.parentElement;
            }
            if (target) {
                const id = parseInt(target.getAttribute('data-id'));
                const url = target.getAttribute('data-url');
                const title = target.getAttribute('data-title');
                const format = target.getAttribute('data-format');
                const resolution = target.getAttribute('data-resolution');
                const subfolder = target.getAttribute('data-subfolder') || '';

                if (!url) {
                    showToast(t('toast_retry_no_url'));
                    return;
                }

                if (window.pywebview) {
                    await window.pywebview.api.delete_download(id);
                }
                showToast(t('toast_retrying'));
                triggerDownload(url, title, format, resolution, subfolder);
            }
        });
    });

    // Folder open trigger listeners
    document.querySelectorAll('.btn-open-folder').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Traverse up to find path in case user clicked the svg child
            let target = e.target;
            while (target && !target.getAttribute('data-path')) {
                target = target.parentElement;
            }
            if (target) {
                const path = target.getAttribute('data-path');
                if (window.pywebview) {
                    window.pywebview.api.open_folder(path);
                } else {
                    showToast(`Open folder: ${path}`);
                }
            }
        });
    });

    // Delete download trigger listeners
    document.querySelectorAll('.btn-delete-download').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            let target = e.target;
            while (target && !target.getAttribute('data-id')) {
                target = target.parentElement;
            }
            if (target) {
                const id = parseInt(target.getAttribute('data-id'));
                if (window.pywebview) {
                    const ok = await window.pywebview.api.delete_download(id);
                    if (ok) {
                        showToast(t('toast_item_deleted'));
                        loadDownloadsHistory();
                    } else {
                        showToast(t('status_failed'));
                    }
                } else {
                    showToast(`Record deleted: ${id}`);
                }
            }
        });
    });

    // Click card to open file directly
    document.querySelectorAll('.download-item-history.clickable').forEach(card => {
        card.addEventListener('click', (e) => {
            // Ignore click if it's on an action button (open folder or delete or retry)
            if (e.target.closest('.dl-action-btn') || e.target.closest('.dl-retry-badge-btn')) {
                return;
            }
            const folderBtn = card.querySelector('.btn-open-folder');
            if (folderBtn) {
                const path = folderBtn.getAttribute('data-path');
                if (window.pywebview) {
                    window.pywebview.api.open_file(path);
                } else {
                    showToast(`Mock: Dosya açılıyor: ${path}`);
                }
            }
        });
    });

    if (window.lucide) {
        window.lucide.createIcons();
    }
}

// Clear Completed/Failed History
async function clearHistory() {
    if (!window.pywebview) return;
    try {
        const ok = await window.pywebview.api.clear_downloads_history();
        if (ok) {
            showToast(t('toast_history_cleared'));
            loadDownloadsHistory();
        } else {
            showToast(t('toast_history_clear_failed'));
        }
    } catch(e) {
        console.error(e);
    }
}


// --- MOCK BROWSER SIMULATIONS (For local UI tweaking) ---
function getMockInfo(url) {
    if (url.includes('list=')) {
        return {
            type: 'playlist',
            title: 'Mock Oynatma Listesi (1080p Müzikler)',
            entries_count: 3,
            url: url,
            entries: [
                { id: '1', title: 'Harika Şarkı 1 (1080p)', duration: 240 },
                { id: '2', title: 'Efsane Melodi 2 (720p)', duration: 180 },
                { id: '3', title: 'Klasik Parça 3 (Oynatma)', duration: 320 }
            ]
        };
    } else {
        return {
            type: 'video',
            title: 'Örnek YouTube Videosu Başlığı - Monokrom Tasarım Tanıtımı',
            duration: 412,
            author: 'Tasarım Kanalı',
            thumbnail: '',
            resolutions: ['1080p', '720p', '480p', '360p'],
            url: url
        };
    }
}

function mockDownloadFlow(title, format, resolution) {
    const id = Math.floor(Math.random() * 1000);
    switchTab('downloads-list');
    insertActiveDownloadCard(id, title, format, resolution);
    incrementActiveDownloadsBadge();

    let percent = 0;
    const interval = setInterval(() => {
        percent += 10;
        if (percent <= 100) {
            window.updateDownloadProgress(id, {
                status: percent === 100 ? 'converting' : 'downloading',
                percent: percent,
                size: `${(percent * 0.45).toFixed(1)} MB / 45.0 MB`,
                speed: '4.2 MB/sn',
                eta: `${Math.ceil((100 - percent) / 10)}sn`
            });
        } else {
            clearInterval(interval);
            window.downloadCompleted(id, true, `C:\\Downloads\\${title}.${format}`, 47185920);
        }
    }, 800);
}

// Set View Mode layout state
function setLibraryViewMode(mode) {
    localStorage.setItem('lib-view-mode', mode);
    const libList = document.getElementById('library-list');
    if (libList) {
        libList.className = `list-container ${mode}-view`;
    }
    updateViewModeButtons(mode);
}

function updateViewModeButtons(mode) {
    const btnList = document.getElementById('btn-view-list');
    const btnGrid = document.getElementById('btn-view-grid');
    if (btnList && btnGrid) {
        if (mode === 'list') {
            btnList.classList.add('active');
            btnGrid.classList.remove('active');
        } else {
            btnGrid.classList.add('active');
            btnList.classList.remove('active');
        }
    }
}

// Set Downloads View Mode layout state
function setDownloadsViewMode(mode) {
    localStorage.setItem('downloads-view-mode', mode);
    const historyContainer = document.getElementById('history-downloads-container');
    if (historyContainer) {
        historyContainer.className = `list-container ${mode}-view`;
    }
    updateDownloadsViewModeButtons(mode);
}

function updateDownloadsViewModeButtons(mode) {
    const btnList = document.getElementById('btn-dl-view-list');
    const btnGrid = document.getElementById('btn-dl-view-grid');
    if (btnList && btnGrid) {
        if (mode === 'list') {
            btnList.classList.add('active');
            btnGrid.classList.remove('active');
        } else {
            btnGrid.classList.add('active');
            btnList.classList.remove('active');
        }
    }
}

// --- LIBRARY UPDATES MANAGEMENT ---
async function checkLibraryUpdates() {
    const statusBox = document.getElementById('update-status-box');
    const btnCheck = document.getElementById('btn-check-updates');
    const btnUpdateAll = document.getElementById('btn-update-all');
    
    if (!statusBox) return;

    statusBox.style.display = 'block';
    statusBox.innerHTML = `
        <div class="update-status-loading">
            <div class="spinner"></div>
            <span>${t('checking_updates_loading')}</span>
        </div>
    `;

    if (btnCheck) {
        btnCheck.disabled = true;
        const icon = btnCheck.querySelector('i, svg');
        if (icon) icon.classList.add('spinning');
    }

    try {
        let res = null;
        if (window.pywebview) {
            res = await window.pywebview.api.check_library_updates();
        } else {
            // Mock mode for browser testing
            await new Promise(r => setTimeout(r, 1200));
            res = {
                success: true,
                has_any_update: true,
                packages: [
                    {
                        name: "yt-dlp",
                        display_name: "yt-dlp",
                        description: "YouTube video & audio downloader engine.",
                        installed_version: "2026.8.19",
                        latest_version: "2026.8.25",
                        has_update: true
                    },
                    {
                        name: "imageio-ffmpeg",
                        display_name: "imageio-ffmpeg",
                        description: "FFmpeg media converter and audio merger.",
                        installed_version: "0.6.0",
                        latest_version: "0.6.0",
                        has_update: false
                    },
                    {
                        name: "PyQt6",
                        display_name: "PyQt6",
                        description: "Desktop GUI runtime framework.",
                        installed_version: "6.11.0",
                        latest_version: "6.11.0",
                        has_update: false
                    }
                ]
            };
        }

        if (res && res.success) {
            renderLibraryUpdatesList(res.packages);
            if (btnUpdateAll) {
                btnUpdateAll.style.display = res.has_any_update ? 'inline-flex' : 'none';
            }
            if (res.has_any_update) {
                showToast(t('toast_updates_found'));
            } else {
                showToast(t('toast_all_updated'));
            }
        } else {
            statusBox.innerHTML = `
                <div style="color: #c62828; font-size: 0.88rem; padding: 8px;">
                    ${t('status_failed')}: ${res ? res.error : 'Unknown error'}
                </div>
            `;
        }
    } catch (e) {
        statusBox.innerHTML = `
            <div style="color: #c62828; font-size: 0.88rem; padding: 8px;">
                ${t('status_failed')}: ${e.message}
            </div>
        `;
    } finally {
        if (btnCheck) {
            btnCheck.disabled = false;
            const icon = btnCheck.querySelector('i, svg');
            if (icon) icon.classList.remove('spinning');
        }
    }
}

function renderLibraryUpdatesList(packages) {
    const statusBox = document.getElementById('update-status-box');
    if (!statusBox) return;

    let html = '<div class="update-package-list">';
    
    packages.forEach(pkg => {
        const isUpToDate = !pkg.has_update;
        const descKey = 'pkg_desc_' + pkg.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const localizedDesc = t(descKey);
        const pkgDesc = (localizedDesc && localizedDesc !== descKey) ? localizedDesc : pkg.description;

        html += `
            <div class="update-package-item" id="pkg-card-${pkg.name}">
                <div class="package-info">
                    <div class="package-name-row">
                        <span class="package-name">${pkg.display_name}</span>
                        <span class="package-badge ${isUpToDate ? 'badge-updated' : 'badge-outdated'}">
                            ${isUpToDate ? t('badge_updated') : t('badge_outdated')}
                        </span>
                    </div>
                    <span class="package-desc">${pkgDesc}</span>
                </div>
                <div class="package-actions">
                    <div class="package-versions">
                        <span><strong>${t('version_current')}:</strong> ${pkg.installed_version}</span>
                        ${!isUpToDate ? `<span>➔ <strong>${t('version_latest')}:</strong> ${pkg.latest_version}</span>` : ''}
                    </div>
                    ${!isUpToDate ? `
                        <button class="btn-update-pkg" data-name="${pkg.name}">
                            <i data-lucide="arrow-up-circle"></i>
                            <span>${t('btn_update_single')}</span>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    statusBox.innerHTML = html;

    // Attach listeners to individual package update buttons
    statusBox.querySelectorAll('.btn-update-pkg').forEach(btn => {
        btn.addEventListener('click', async () => {
            const pkgName = btn.getAttribute('data-name');
            await updateSinglePackage(pkgName, btn);
        });
    });

    if (window.lucide) {
        window.lucide.createIcons();
    }
}

async function updateSinglePackage(pkgName, btnEl) {
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = `
            <div class="spinner" style="width: 14px; height: 14px; border-width: 2px;"></div>
            <span>${t('updating_loading')}</span>
        `;
    }
    
    showToast(t('toast_updating_pkg', { pkg: pkgName }));

    try {
        let res = null;
        if (window.pywebview) {
            res = await window.pywebview.api.update_library(pkgName);
        } else {
            await new Promise(r => setTimeout(r, 1500));
            res = { success: true, new_version: "2026.8.25" };
        }

        if (res && res.success) {
            showToast(t('toast_pkg_updated', { pkg: pkgName, ver: res.new_version }));
            // Refresh list
            await checkLibraryUpdates();
        } else {
            showToast(`${t('toast_pkg_update_failed')}: ${res ? res.error : ''}`);
            if (btnEl) {
                btnEl.disabled = false;
                btnEl.innerHTML = `
                    <i data-lucide="arrow-up-circle"></i>
                    <span>${t('btn_retry_update')}</span>
                `;
                if (window.lucide) window.lucide.createIcons();
            }
        }
    } catch (e) {
        showToast(`${t('status_failed')}: ${e.message}`);
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = `
                <i data-lucide="arrow-up-circle"></i>
                <span>${t('btn_retry_update')}</span>
            `;
            if (window.lucide) window.lucide.createIcons();
        }
    }
}

async function updateAllLibraries() {
    const btnUpdateAll = document.getElementById('btn-update-all');
    if (btnUpdateAll) {
        btnUpdateAll.disabled = true;
        btnUpdateAll.innerHTML = `
            <div class="spinner" style="width: 14px; height: 14px; border-width: 2px;"></div>
            <span>${t('updating_loading')}</span>
        `;
    }

    showToast(t('toast_all_updating'));

    try {
        let res = null;
        if (window.pywebview) {
            res = await window.pywebview.api.update_all_libraries();
        } else {
            await new Promise(r => setTimeout(r, 2000));
            res = { success: true };
        }

        if (res && res.success) {
            showToast(t('toast_all_updated_success'));
            await checkLibraryUpdates();
        } else {
            showToast(`${t('status_failed')}: ${res ? res.error : ''}`);
        }
    } catch (e) {
        showToast(`${t('status_failed')}: ${e.message}`);
    } finally {
        if (btnUpdateAll) {
            btnUpdateAll.disabled = false;
            btnUpdateAll.innerHTML = `
                <i data-lucide="arrow-up-circle"></i>
                <span>${t('btn_update_all')}</span>
            `;
            if (window.lucide) window.lucide.createIcons();
        }
    }
}




