// TabPilot Background Service Worker
// Manages media state across all tabs

let mediaState = {
  tabs: {}, // tabId -> { title, url, isPlaying, currentTime, duration, volume, videoTitle, thumbnail, favicon, upNext }
  queue: [], // array of { tabId, title, url, videoTitle, thumbnail }
  activeTabId: null,
  currentQueueIndex: -1,
  playlists: [],
  loopMode: 'none', // 'none' | 'one' | 'all'
  activePlaylistId: null,
  activePlaylistIndex: -1
};

// Load playlists from storage on startup
chrome.storage.local.get('tabpilot_playlists', (result) => {
  if (chrome.runtime.lastError) {
    console.error('TabPilot Storage Error:', chrome.runtime.lastError);
    return;
  }
  if (result && result.tabpilot_playlists) {
    mediaState.playlists = result.tabpilot_playlists;
  }
});

function savePlaylists() {
  chrome.storage.local.set({ tabpilot_playlists: mediaState.playlists });
}

// Broadcast state to all extension pages
function broadcastState() {
  chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state: mediaState }).catch(() => {});
}

// Get all tabs with active media
async function scanForMedia() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              // Trigger content script to report state
              window.dispatchEvent(new CustomEvent('tabpilot-request-state'));
            }
          });
        } catch (e) {}
      }
    }
  } catch (e) {}
}

// Navigate to a YouTube video and play it once loaded
function navigateAndPlay(item) {
  // Find an existing YouTube tab or use the active one
  const ytTabId = mediaState.activeTabId;
  if (!ytTabId) return;

  const url = item.url || `https://www.youtube.com/watch?v=${item.videoId}`;

  chrome.tabs.sendMessage(ytTabId, {
    type: 'NAVIGATE_TO_VIDEO',
    url
  }).catch(() => {
    // Fallback: update the tab URL directly
    chrome.tabs.update(ytTabId, { url });
  });

  // Wait for the page to load, then play
  const listener = (tabId, changeInfo) => {
    if (tabId === ytTabId && changeInfo.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(listener);
      setTimeout(() => {
        chrome.tabs.sendMessage(ytTabId, {
          type: 'EXECUTE_CONTROL',
          action: 'play'
        }).catch(() => {});
      }, 1500);
    }
  };
  chrome.tabs.onUpdated.addListener(listener);
  // Safety timeout to remove listener
  setTimeout(() => chrome.tabs.onUpdated.removeListener(listener), 15000);
}

function handleVideoEnded(tabId) {
  // Loop One: seek back to start and play
  if (mediaState.loopMode === 'one') {
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { type: 'EXECUTE_CONTROL', action: 'seek', value: 0 }).catch(() => {});
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, { type: 'EXECUTE_CONTROL', action: 'play' }).catch(() => {});
      }, 200);
    }, 300);
    return;
  }

  // Active playlist: advance to next item
  if (mediaState.activePlaylistId) {
    const playlist = mediaState.playlists.find(p => p.id === mediaState.activePlaylistId);
    if (!playlist || playlist.items.length === 0) return;

    let nextIndex = mediaState.activePlaylistIndex + 1;
    if (nextIndex >= playlist.items.length) {
      if (mediaState.loopMode === 'all') {
        nextIndex = 0;
      } else {
        // End of playlist, stop
        mediaState.activePlaylistId = null;
        mediaState.activePlaylistIndex = -1;
        broadcastState();
        return;
      }
    }

    mediaState.activePlaylistIndex = nextIndex;
    const nextItem = playlist.items[nextIndex];
    broadcastState();
    navigateAndPlay(nextItem);
  }
}

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'MEDIA_STATE_UPDATE': {
      const tabId = sender.tab?.id;
      if (!tabId) break;
      if (message.hasMedia) {
        const existing = mediaState.tabs[tabId];
        mediaState.tabs[tabId] = {
          ...message.data,
          tabId,
          favicon: sender.tab.favIconUrl,
          tabTitle: sender.tab.title,
          url: sender.tab.url
        };
        // Preserve upNext when not included in this report
        if (!message.data.upNext && existing?.upNext) {
          mediaState.tabs[tabId].upNext = existing.upNext;
        }
        if (message.data.isPlaying && mediaState.activeTabId !== tabId) {
          mediaState.activeTabId = tabId;
        }
      } else {
        delete mediaState.tabs[tabId];
        if (mediaState.activeTabId === tabId) {
          const remainingTabs = Object.keys(mediaState.tabs);
          mediaState.activeTabId = remainingTabs.length > 0 ? parseInt(remainingTabs[0]) : null;
        }
      }
      broadcastState();
      break;
    }

    case 'MEDIA_ENDED': {
      const tabId = sender.tab?.id;
      if (tabId) {
        handleVideoEnded(tabId);
      }
      break;
    }

    case 'GET_STATE': {
      sendResponse({ state: mediaState });
      break;
    }

    case 'CONTROL': {
      const targetTabId = message.tabId || mediaState.activeTabId;
      if (targetTabId) {
        chrome.tabs.sendMessage(targetTabId, {
          type: 'EXECUTE_CONTROL',
          action: message.action,
          value: message.value
        }).catch(() => {});
      }
      break;
    }

    case 'ADD_TO_QUEUE': {
      const item = message.item;
      if (!mediaState.queue.find(q => q.tabId === item.tabId && q.url === item.url)) {
        mediaState.queue.push(item);
        broadcastState();
      }
      sendResponse({ success: true });
      break;
    }

    case 'REMOVE_FROM_QUEUE': {
      mediaState.queue = mediaState.queue.filter((_, i) => i !== message.index);
      broadcastState();
      sendResponse({ success: true });
      break;
    }

    case 'REORDER_QUEUE': {
      const { fromIndex, toIndex } = message;
      const [item] = mediaState.queue.splice(fromIndex, 1);
      mediaState.queue.splice(toIndex, 0, item);
      broadcastState();
      break;
    }

    case 'PLAY_QUEUE_ITEM': {
      const queueItem = mediaState.queue[message.index];
      if (queueItem) {
        mediaState.currentQueueIndex = message.index;
        chrome.tabs.update(queueItem.tabId, { active: true }).catch(() => {});
        setTimeout(() => {
          chrome.tabs.sendMessage(queueItem.tabId, {
            type: 'EXECUTE_CONTROL',
            action: 'play'
          }).catch(() => {});
        }, 300);
        broadcastState();
      }
      break;
    }

    case 'SWITCH_TO_TAB': {
      chrome.tabs.update(message.tabId, { active: true }).catch(() => {});
      break;
    }

    case 'SET_ACTIVE_TAB': {
      mediaState.activeTabId = message.tabId;
      broadcastState();
      break;
    }

    case 'CLEAR_QUEUE': {
      mediaState.queue = [];
      mediaState.currentQueueIndex = -1;
      broadcastState();
      break;
    }

    // ─── Playlist messages ──────────────────────────────────────────────

    case 'CREATE_PLAYLIST': {
      const newPlaylist = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: message.name || 'Untitled Playlist',
        createdAt: Date.now(),
        items: []
      };
      mediaState.playlists.push(newPlaylist);
      savePlaylists();
      broadcastState();
      sendResponse({ success: true, playlist: newPlaylist });
      break;
    }

    case 'DELETE_PLAYLIST': {
      mediaState.playlists = mediaState.playlists.filter(p => p.id !== message.playlistId);
      if (mediaState.activePlaylistId === message.playlistId) {
        mediaState.activePlaylistId = null;
        mediaState.activePlaylistIndex = -1;
      }
      savePlaylists();
      broadcastState();
      sendResponse({ success: true });
      break;
    }

    case 'RENAME_PLAYLIST': {
      const pl = mediaState.playlists.find(p => p.id === message.playlistId);
      if (pl) {
        pl.name = message.name;
        savePlaylists();
        broadcastState();
      }
      sendResponse({ success: true });
      break;
    }

    case 'ADD_TO_PLAYLIST': {
      const targetPl = mediaState.playlists.find(p => p.id === message.playlistId);
      if (targetPl && message.item) {
        targetPl.items.push(message.item);
        savePlaylists();
        broadcastState();
      }
      sendResponse({ success: true });
      break;
    }

    case 'REMOVE_FROM_PLAYLIST': {
      const rmPl = mediaState.playlists.find(p => p.id === message.playlistId);
      if (rmPl) {
        rmPl.items = rmPl.items.filter((_, i) => i !== message.itemIndex);
        savePlaylists();
        broadcastState();
      }
      sendResponse({ success: true });
      break;
    }

    case 'REORDER_PLAYLIST': {
      const roPl = mediaState.playlists.find(p => p.id === message.playlistId);
      if (roPl) {
        const [movedItem] = roPl.items.splice(message.fromIndex, 1);
        roPl.items.splice(message.toIndex, 0, movedItem);
        savePlaylists();
        broadcastState();
      }
      break;
    }

    case 'PLAY_PLAYLIST': {
      const playPl = mediaState.playlists.find(p => p.id === message.playlistId);
      if (playPl && playPl.items.length > 0) {
        const startIdx = message.itemIndex || 0;
        mediaState.activePlaylistId = playPl.id;
        mediaState.activePlaylistIndex = startIdx;
        broadcastState();
        navigateAndPlay(playPl.items[startIdx]);
      }
      sendResponse({ success: true });
      break;
    }

    case 'SET_LOOP_MODE': {
      mediaState.loopMode = message.mode;
      broadcastState();
      break;
    }

    case 'NAVIGATE_YOUTUBE': {
      const navTabId = message.tabId || mediaState.activeTabId;
      if (navTabId && message.url) {
        chrome.tabs.sendMessage(navTabId, {
          type: 'NAVIGATE_TO_VIDEO',
          url: message.url
        }).catch(() => {});
      }
      break;
    }
    
    case 'SCAN_FOR_MEDIA': {
      scanForMedia();
      sendResponse({ success: true });
      break;
    }
  }
  return true;
});

// Clean up when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (mediaState.tabs[tabId]) {
    delete mediaState.tabs[tabId];
    if (mediaState.activeTabId === tabId) {
      const remainingTabs = Object.keys(mediaState.tabs);
      mediaState.activeTabId = remainingTabs.length > 0 ? parseInt(remainingTabs[0]) : null;
    }
    // Remove from queue
    mediaState.queue = mediaState.queue.filter(q => q.tabId !== tabId);
    broadcastState();
  }
});

// Scan periodically for media
setInterval(scanForMedia, 5000);
scanForMedia();
