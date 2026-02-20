// TabPilot Content Script
// Detects and controls media elements on each page

let reportInterval = null;
let lastReportedState = null;

function getYouTubeInfo() {
  try {
    // YouTube specific selectors
    const titleEl = document.querySelector('h1.ytd-video-primary-info-renderer yt-formatted-string, .ytd-watch-metadata h1 yt-formatted-string, h1.style-scope.ytd-watch-metadata');
    const channelEl = document.querySelector('#channel-name a, .ytd-channel-name a');
    const thumbnail = document.querySelector('link[rel="shortcut icon"]')?.href || '';
    
    return {
      videoTitle: titleEl?.textContent?.trim() || document.title,
      channel: channelEl?.textContent?.trim() || '',
      isYouTube: true,
      thumbnail
    };
  } catch (e) {
    return { videoTitle: document.title, isYouTube: true };
  }
}

function getMediaState() {
  const videos = Array.from(document.querySelectorAll('video')).filter(v => v.readyState > 0 && v.duration > 0);
  const audios = Array.from(document.querySelectorAll('audio')).filter(a => a.readyState > 0 && a.duration > 0);
  
  const media = [...videos, ...audios];
  if (media.length === 0) return null;

  // Prefer playing media, else take first
  const activeMedia = media.find(m => !m.paused) || media[0];
  
  const isYT = location.hostname.includes('youtube.com');
  const ytInfo = isYT ? getYouTubeInfo() : {};
  
  return {
    isPlaying: !activeMedia.paused,
    currentTime: activeMedia.currentTime,
    duration: activeMedia.duration || 0,
    volume: activeMedia.volume,
    muted: activeMedia.muted,
    playbackRate: activeMedia.playbackRate,
    videoTitle: ytInfo.videoTitle || document.title,
    channel: ytInfo.channel || '',
    isYouTube: isYT,
    hasVideo: videos.length > 0,
    thumbnail: ytInfo.thumbnail || ''
  };
}

function reportState() {
  const state = getMediaState();
  const hasMedia = state !== null;
  
  const stateKey = JSON.stringify(state);
  if (stateKey === lastReportedState) return;
  lastReportedState = stateKey;
  
  chrome.runtime.sendMessage({
    type: 'MEDIA_STATE_UPDATE',
    hasMedia,
    data: state || {}
  }).catch(() => {});
}

function executeControl(action, value) {
  const videos = Array.from(document.querySelectorAll('video')).filter(v => v.readyState > 0);
  const audios = Array.from(document.querySelectorAll('audio')).filter(a => a.readyState > 0);
  const media = [...videos, ...audios];
  
  if (media.length === 0) return;
  const activeMedia = media.find(m => !m.paused) || media[0];
  
  switch (action) {
    case 'play':
      activeMedia.play();
      break;
    case 'pause':
      activeMedia.pause();
      break;
    case 'toggle':
      if (activeMedia.paused) activeMedia.play();
      else activeMedia.pause();
      break;
    case 'seek':
      activeMedia.currentTime = value;
      break;
    case 'seekForward':
      activeMedia.currentTime = Math.min(activeMedia.duration, activeMedia.currentTime + (value || 10));
      break;
    case 'seekBackward':
      activeMedia.currentTime = Math.max(0, activeMedia.currentTime - (value || 10));
      break;
    case 'volume':
      activeMedia.volume = value;
      break;
    case 'mute':
      activeMedia.muted = !activeMedia.muted;
      break;
    case 'rate':
      activeMedia.playbackRate = value;
      break;
    case 'fullscreen':
      if (activeMedia.requestFullscreen) activeMedia.requestFullscreen();
      break;
  }
  
  setTimeout(reportState, 100);
}

// Listen for control messages from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'EXECUTE_CONTROL') {
    executeControl(message.action, message.value);
  }
});

// Listen for state requests
window.addEventListener('tabpilot-request-state', reportState);

// Watch for media changes
function attachMediaListeners() {
  const allMedia = document.querySelectorAll('video, audio');
  allMedia.forEach(media => {
    if (media._tabpilot) return;
    media._tabpilot = true;
    ['play', 'pause', 'timeupdate', 'volumechange', 'ended', 'loadedmetadata'].forEach(event => {
      media.addEventListener(event, () => {
        if (event !== 'timeupdate' || Math.random() < 0.1) {
          setTimeout(reportState, 50);
        }
      });
    });
  });
}

// MutationObserver to catch dynamically added media
const observer = new MutationObserver(() => {
  attachMediaListeners();
  reportState();
});

observer.observe(document.documentElement, { childList: true, subtree: true });

// Initial setup
attachMediaListeners();
reportState();

// Periodic report
setInterval(reportState, 2000);
