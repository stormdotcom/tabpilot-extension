// TabPilot Background Service Worker
// Manages media state across all tabs

let mediaState = {
  tabs: {}, // tabId -> { title, url, isPlaying, currentTime, duration, volume, videoTitle, thumbnail, favicon }
  queue: [], // array of { tabId, title, url, videoTitle, thumbnail }
  activeTabId: null,
  currentQueueIndex: -1
};

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

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'MEDIA_STATE_UPDATE': {
      const tabId = sender.tab?.id;
      if (!tabId) break;
      if (message.hasMedia) {
        mediaState.tabs[tabId] = {
          ...message.data,
          tabId,
          favicon: sender.tab.favIconUrl,
          tabTitle: sender.tab.title,
          url: sender.tab.url
        };
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
