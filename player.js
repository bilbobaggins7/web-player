document.addEventListener('DOMContentLoaded', initApp);

let player;

function initApp() {
    // Install built-in polyfills to patch browser incompatibilities
    shaka.polyfill.installAll();

    // Check to see if the browser supports the basic APIs Shaka needs
    if (shaka.Player.isBrowserSupported()) {
        initPlayer();
    } else {
        showStatus('Browser not supported!', true);
    }
}

function initPlayer() {
    const video = document.getElementById('video');
    const container = document.getElementById('videoContainer');
    
    player = new shaka.Player(video);
    
    // Attach UI overlay
    const ui = new shaka.ui.Overlay(player, container, video);
    ui.configure({
        controlPanelElements: [
            'play_pause',
            'time_and_duration',
            'spacer',
            'mute',
            'volume',
            'quality',
            'picture_in_picture',
            'fullscreen'
        ]
    });

    // Listen for error events
    player.addEventListener('error', onPlayerErrorEvent);

    // Setup form listener
    document.getElementById('configForm').addEventListener('submit', onPlayStream);
}

async function onPlayStream(e) {
    e.preventDefault();
    
    const streamUrl = document.getElementById('streamUrl').value.trim();
    const headersInput = document.getElementById('headers').value.trim();
    const drmKeysInput = document.getElementById('drmKeys').value.trim();

    if (!streamUrl) {
        showStatus('Please enter a manifest URL', true);
        return;
    }

    showStatus('Configuring player...', false);

    // 1. Reset player config
    player.configure({ drm: { clearKeys: {} } });
    player.getNetworkingEngine().clearAllRequestFilters();

    // 2. Parse and Configure DRM (ClearKey)
    if (drmKeysInput) {
        const clearKeysConfig = {};
        const lines = drmKeysInput.split('\n');
        
        for (const line of lines) {
            if (line.includes(':')) {
                const [kid, key] = line.split(':').map(s => s.trim());
                if (kid && key) {
                    clearKeysConfig[kid] = key;
                }
            }
        }

        if (Object.keys(clearKeysConfig).length > 0) {
            console.log("Applying ClearKey DRM Config:", clearKeysConfig);
            player.configure({
                drm: {
                    clearKeys: clearKeysConfig
                }
            });
        }
    }

    // 3. Parse and Configure Custom Headers
    if (headersInput) {
        const headerMap = {};
        const lines = headersInput.split('\n');
        
        for (const line of lines) {
            const colonIdx = line.indexOf(':');
            if (colonIdx > 0) {
                const key = line.substring(0, colonIdx).trim();
                const value = line.substring(colonIdx + 1).trim();
                headerMap[key] = value;
            }
        }

        console.log("Applying Custom Headers:", headerMap);

        player.getNetworkingEngine().registerRequestFilter((type, request) => {
            // Automatically append token to segment requests if it's in the base URL
            const baseUri = document.getElementById('streamUrl').value;
            let tokenToAppend = null;
            
            if (baseUri.includes('hdnea=')) {
                tokenToAppend = 'hdnea=' + baseUri.split('hdnea=')[1].split('&')[0];
            } else if (baseUri.includes('__hdnea__=')) {
                tokenToAppend = '__hdnea__=' + baseUri.split('__hdnea__=')[1].split('&')[0];
            } else if (baseUri.includes('hdntl=')) {
                tokenToAppend = 'hdntl=' + baseUri.split('hdntl=')[1].split('&')[0];
            }

            if (tokenToAppend && (type === shaka.net.NetworkingEngine.RequestType.SEGMENT || type === shaka.net.NetworkingEngine.RequestType.MANIFEST)) {
                if (!request.uris[0].includes('hdnea') && !request.uris[0].includes('hdntl')) {
                    const sep = request.uris[0].includes("?") ? "&" : "?";
                    request.uris[0] += sep + tokenToAppend;
                }
            }

            // Apply all parsed headers to the request
            for (const [key, value] of Object.entries(headerMap)) {
                
                // Browsers usually block setting the 'Cookie' header directly via JS fetch/XHR.
                // For Akamai/JioTV tokens, we MUST append the cookie directly to the URL query string.
                if (key.toLowerCase() === 'cookie') {
                    if (
                        (type === shaka.net.NetworkingEngine.RequestType.MANIFEST ||
                         type === shaka.net.NetworkingEngine.RequestType.SEGMENT) &&
                        !request.uris[0].includes("hdnea") &&
                        !request.uris[0].includes("hdntl")
                    ) {
                        const sep = request.uris[0].includes("?") ? "&" : "?";
                        // Append the cookie directly to the URL so the CDN authenticates it
                        request.uris[0] += sep + value.replace(/;\s*/g, '&'); 
                    }
                } else {
                    // For safe headers like User-Agent
                    request.headers[key] = value;
                }
            }
        });
    }

    // 4. Load the Stream
    try {
        showStatus('Loading stream...', false);
        await player.load(streamUrl);
        showStatus('Stream loaded successfully!', false);
        setTimeout(() => document.getElementById('statusMessage').classList.add('hidden'), 3000);
    } catch (e) {
        onPlayerError(e);
    }
}

function onPlayerErrorEvent(event) {
    onPlayerError(event.detail);
}

function onPlayerError(error) {
    console.error('Error code', error.code, 'object', error);
    let errorMsg = `Error ${error.code}: ${error.message || 'Playback failed'}`;
    showStatus(errorMsg, true);
}

function showStatus(msg, isError) {
    const statusEl = document.getElementById('statusMessage');
    statusEl.textContent = msg;
    statusEl.classList.remove('hidden');
    if (isError) {
        statusEl.classList.add('error');
        statusEl.classList.remove('success');
    } else {
        statusEl.classList.add('success');
        statusEl.classList.remove('error');
    }
}
