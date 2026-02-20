// TabPilot Popup Script

let state = { tabs: {}, queue: [], activeTabId: null, currentQueueIndex: -1 };
let activePanel = 'player';
let speedPopoverOpen = false;

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function sendControl(action, value, tabId) {
  chrome.runtime.sendMessage({ type: 'CONTROL', action, value, tabId });
}

function getDomainFromUrl(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch { return url; }
}

// ─── Panel switching ─────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activePanel = btn.dataset.panel;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`panel-${activePanel}`).classList.add('active');
  });
});

// ─── Render Player ───────────────────────────────────────────────────────────

function renderPlayer() {
  const activeTab = state.activeTabId ? state.tabs[state.activeTabId] : null;
  const tabsWithMedia = Object.values(state.tabs);

  const emptyState = document.getElementById('emptyState');
  const playerUI = document.getElementById('playerUI');

  if (tabsWithMedia.length === 0) {
    emptyState.style.display = 'flex';
    playerUI.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  playerUI.style.display = 'block';

  // Sources bar
  const sourcesBar = document.getElementById('sourcesBar');
  sourcesBar.innerHTML = '';
  tabsWithMedia.forEach(tab => {
    const chip = document.createElement('div');
    chip.className = 'source-chip' + (tab.tabId === state.activeTabId ? ' active' : '');

    const dot = tab.isPlaying ? `<div class="playing-dot"></div>` : '';
    const faviconHtml = tab.favicon
      ? `<img src="${tab.favicon}" alt="" onerror="this.style.display='none'">`
      : `<div class="favicon-fallback">▶</div>`;

    chip.innerHTML = `
      ${dot}
      ${faviconHtml}
      <span>${getDomainFromUrl(tab.url)}</span>
    `;
    chip.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'SET_ACTIVE_TAB', tabId: tab.tabId });
    });
    sourcesBar.appendChild(chip);
  });

  if (!activeTab) return;

  // Track info
  const titleEl = document.getElementById('trackTitle');
  const channelEl = document.getElementById('trackChannel');
  const trackArt = document.getElementById('trackArt');

  titleEl.textContent = activeTab.videoTitle || activeTab.tabTitle || 'Unknown Media';
  channelEl.textContent = activeTab.channel || getDomainFromUrl(activeTab.url);

  // Art
  if (activeTab.thumbnail || activeTab.favicon) {
    const src = activeTab.thumbnail || activeTab.favicon;
    trackArt.innerHTML = `<img src="${src}" alt="" onerror="this.innerHTML='<svg class=\\'default-art\\' width=\\'20\\' height=\\'20\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'1.5\\'><circle cx=\\'12\\' cy=\\'12\\' r=\\'10\\'/><polygon points=\\'10 8 16 12 10 16 10 8\\'/></svg>'">`;
  } else {
    trackArt.innerHTML = `<svg class="default-art" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>`;
  }

  // Progress
  const pct = activeTab.duration > 0 ? (activeTab.currentTime / activeTab.duration) * 100 : 0;
  document.getElementById('progressFill').style.width = `${pct}%`;
  document.getElementById('currentTime').textContent = formatTime(activeTab.currentTime);
  document.getElementById('duration').textContent = formatTime(activeTab.duration);

  // Play button
  const playIcon = document.getElementById('playIcon');
  if (activeTab.isPlaying) {
    playIcon.innerHTML = `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`;
  } else {
    playIcon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"/>`;
  }

  // Volume
  const volSlider = document.getElementById('volumeSlider');
  if (!volSlider.matches(':active')) {
    volSlider.value = activeTab.muted ? 0 : (activeTab.volume || 1);
  }

  // Speed btn
  const rate = activeTab.playbackRate || 1;
  document.getElementById('speedBtn').textContent = rate === 1 ? '1×' : `${rate}×`;
  document.querySelectorAll('.speed-option').forEach(opt => {
    opt.classList.toggle('selected', parseFloat(opt.dataset.speed) === rate);
  });
}

// ─── Render Tabs ─────────────────────────────────────────────────────────────

function renderTabs() {
  const tabsList = document.getElementById('tabsList');
  const tabsWithMedia = Object.values(state.tabs);

  if (tabsWithMedia.length === 0) {
    tabsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>
          </svg>
        </div>
        <h3>No media tabs</h3>
        <p>Tabs with active video or audio will appear here.</p>
      </div>`;
    return;
  }

  tabsList.innerHTML = '';
  tabsWithMedia.forEach(tab => {
    const item = document.createElement('div');
    item.className = 'media-tab-item' + (tab.tabId === state.activeTabId ? ' active-source' : '');

    const isQueued = state.queue.some(q => q.tabId === tab.tabId);

    item.innerHTML = `
      <img class="tab-item-favicon" src="${tab.favicon || ''}" alt="" onerror="this.style.display='none'">
      <div class="tab-item-info">
        <div class="tab-item-title">${tab.videoTitle || tab.tabTitle || 'Media Tab'}</div>
        <div class="tab-item-url">${getDomainFromUrl(tab.url)}</div>
      </div>
      <div class="tab-item-controls">
        <button class="mini-ctrl play-pause-mini" data-tabid="${tab.tabId}" title="${tab.isPlaying ? 'Pause' : 'Play'}">
          ${tab.isPlaying
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
            : `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`
          }
        </button>
        <button class="mini-ctrl goto-mini" data-tabid="${tab.tabId}" title="Go to tab">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </button>
        <button class="tab-queue-btn add-to-q" data-tabid="${tab.tabId}">${isQueued ? '✓ Queued' : '+ Queue'}</button>
      </div>
    `;

    item.querySelector('.play-pause-mini').addEventListener('click', (e) => {
      e.stopPropagation();
      sendControl('toggle', null, tab.tabId);
    });

    item.querySelector('.goto-mini').addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'SWITCH_TO_TAB', tabId: tab.tabId });
    });

    item.querySelector('.add-to-q').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!isQueued) {
        chrome.runtime.sendMessage({
          type: 'ADD_TO_QUEUE',
          item: {
            tabId: tab.tabId,
            title: tab.videoTitle || tab.tabTitle,
            url: tab.url,
            favicon: tab.favicon,
            thumbnail: tab.thumbnail
          }
        });
      }
    });

    item.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'SET_ACTIVE_TAB', tabId: tab.tabId });
    });

    tabsList.appendChild(item);
  });
}

// ─── Render Queue ─────────────────────────────────────────────────────────────

function renderQueue() {
  const queueList = document.getElementById('queueList');
  const queueCount = document.getElementById('queueCount');
  const queue = state.queue;

  queueCount.textContent = ` — ${queue.length} item${queue.length !== 1 ? 's' : ''}`;

  if (queue.length === 0) {
    queueList.innerHTML = `
      <div class="queue-empty">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="1.5">
          <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
          <line x1="8" y1="18" x2="21" y2="18"/>
        </svg>
        <p>Queue is empty.<br>Add tabs from the Now Playing or Tabs view.</p>
      </div>`;
    return;
  }

  queueList.innerHTML = '';
  queue.forEach((item, index) => {
    const el = document.createElement('div');
    el.className = 'queue-item' + (index === state.currentQueueIndex ? ' current' : '');
    el.draggable = true;
    el.dataset.index = index;

    el.innerHTML = `
      <span class="queue-num">${index === state.currentQueueIndex ? '▶' : index + 1}</span>
      <div class="queue-item-art">
        ${item.thumbnail ? `<img src="${item.thumbnail}" alt="">` : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4a5568" stroke-width="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>`}
      </div>
      <div class="queue-item-info">
        <div class="queue-item-title">${item.title || 'Media'}</div>
        <div class="queue-item-source">${getDomainFromUrl(item.url)}</div>
      </div>
      <div class="queue-item-actions">
        <button class="q-btn play-q" data-index="${index}" title="Play now">
          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
        <button class="q-btn del" data-index="${index}" title="Remove">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `;

    // Drag handlers
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', index);
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', (e) => { e.preventDefault(); });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = parseInt(e.dataTransfer.getData('text/plain'));
      const to = index;
      if (from !== to) {
        chrome.runtime.sendMessage({ type: 'REORDER_QUEUE', fromIndex: from, toIndex: to });
      }
    });

    el.querySelector('.play-q').addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'PLAY_QUEUE_ITEM', index });
    });

    el.querySelector('.del').addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'REMOVE_FROM_QUEUE', index });
    });

    queueList.appendChild(el);
  });
}

// ─── Render Status ────────────────────────────────────────────────────────────

function renderStatus() {
  const tabsWithMedia = Object.values(state.tabs);
  const playingTabs = tabsWithMedia.filter(t => t.isPlaying);
  const dot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const mediaCount = document.getElementById('mediaCount');

  if (playingTabs.length > 0) {
    dot.className = 'status-dot live';
    statusText.textContent = 'Live';
    mediaCount.textContent = `${tabsWithMedia.length} tab${tabsWithMedia.length !== 1 ? 's' : ''} w/ media`;
  } else if (tabsWithMedia.length > 0) {
    dot.className = 'status-dot';
    statusText.textContent = 'Paused';
    mediaCount.textContent = `${tabsWithMedia.length} tab${tabsWithMedia.length !== 1 ? 's' : ''} w/ media`;
  } else {
    dot.className = 'status-dot';
    statusText.textContent = 'No media';
    mediaCount.textContent = '';
  }
}

function renderAll() {
  renderPlayer();
  renderTabs();
  renderQueue();
  renderStatus();
}

// ─── Controls ────────────────────────────────────────────────────────────────

document.getElementById('playBtn').addEventListener('click', () => {
  sendControl('toggle');
});

document.getElementById('skipBackBtn').addEventListener('click', () => {
  sendControl('seekBackward', 10);
});

document.getElementById('skipFwdBtn').addEventListener('click', () => {
  sendControl('seekForward', 10);
});

document.getElementById('muteBtn').addEventListener('click', () => {
  sendControl('mute');
});

document.getElementById('gotoTabBtn').addEventListener('click', () => {
  if (state.activeTabId) {
    chrome.runtime.sendMessage({ type: 'SWITCH_TO_TAB', tabId: state.activeTabId });
  }
});

document.getElementById('volumeSlider').addEventListener('input', (e) => {
  sendControl('volume', parseFloat(e.target.value));
});

// Progress bar seek
document.getElementById('progressBar').addEventListener('click', (e) => {
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  const activeTab = state.activeTabId ? state.tabs[state.activeTabId] : null;
  if (activeTab && activeTab.duration) {
    sendControl('seek', pct * activeTab.duration);
  }
});

// Speed popover
document.getElementById('speedBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  speedPopoverOpen = !speedPopoverOpen;
  document.getElementById('speedPopover').classList.toggle('open', speedPopoverOpen);
});

document.querySelectorAll('.speed-option').forEach(opt => {
  opt.addEventListener('click', (e) => {
    e.stopPropagation();
    sendControl('rate', parseFloat(opt.dataset.speed));
    speedPopoverOpen = false;
    document.getElementById('speedPopover').classList.remove('open');
  });
});

document.addEventListener('click', () => {
  if (speedPopoverOpen) {
    speedPopoverOpen = false;
    document.getElementById('speedPopover').classList.remove('open');
  }
});

// Add current to queue
document.getElementById('addCurrentToQueue').addEventListener('click', () => {
  const activeTab = state.activeTabId ? state.tabs[state.activeTabId] : null;
  if (activeTab) {
    chrome.runtime.sendMessage({
      type: 'ADD_TO_QUEUE',
      item: {
        tabId: activeTab.tabId,
        title: activeTab.videoTitle || activeTab.tabTitle,
        url: activeTab.url,
        favicon: activeTab.favicon,
        thumbnail: activeTab.thumbnail
      }
    });
  }
});

// Clear queue
document.getElementById('clearQueueBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CLEAR_QUEUE' });
});

// ─── State sync ───────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'STATE_UPDATE') {
    state = message.state;
    renderAll();
  }
});

// Initial load
chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
  if (response?.state) {
    state = response.state;
    renderAll();
  }
});
