// YouTube API handling module

let onYouTubeIframeAPIReadyCallbacks = [];
let ytApiLoaded = false;

// Set up global callback for YouTube API
window.onYouTubeIframeAPIReady = function () {
    ytApiLoaded = true;
    onYouTubeIframeAPIReadyCallbacks.forEach(callback => callback());
    onYouTubeIframeAPIReadyCallbacks = [];
};

/**
 * Load the YouTube IFrame API and execute callback when ready
 * @param {Function} callback - Function to call when API is ready
 */
export function loadYouTubeAPI(callback) {
    if (ytApiLoaded && typeof YT !== 'undefined' && YT.Player) {
        callback();
        return;
    }

    onYouTubeIframeAPIReadyCallbacks.push(callback);

    if (document.querySelector('script[src="https://www.youtube.com/iframe_api"]') === null) {
        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName('script')[0];
        if (firstScriptTag) {
            firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        } else {
            document.head.appendChild(tag);
        }
    }
}

/**
 * Initialize a YouTube player in the given container
 * @param {HTMLElement} container - The container element for the player
 * @param {string} videoId - The YouTube video ID
 */
export function createYouTubePlayer(container, videoId) {
    loadYouTubeAPI(() => {
        new YT.Player(container, {
            videoId: videoId,
            width: '100%',
            height: '100%',
            playerVars: {
                'autoplay': 0,
                'playsinline': 1,
                'controls': 1,
                'mute': 0
            },
            events: {
                'onReady': (event) => {
                    event.target.getIframe().className = 'video-iframe';
                    event.target.playVideo();
                }
            }
        });
    });
}
