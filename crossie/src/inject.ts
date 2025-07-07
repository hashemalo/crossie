// inject.ts - Pure content script without modules
(() => {
  // Create iframe element
  const iframe = document.createElement("iframe");
  
  const hostUrl = encodeURIComponent(window.location.href);
  iframe.src = chrome.runtime.getURL(`frame.html?host=${hostUrl}`);

  // Apply iframe styles
  Object.assign(iframe.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    width: "300px",
    height: "400px",
    border: "none",
    borderRadius: "12px",
    boxShadow: "0 10px 30px rgba(0, 0, 0, 0.3)",
    zIndex: "999999",
    backgroundColor: "transparent",
    transition: "all 0.3s ease-in-out",
    display: "none",
  });

  // Create minimized button
  const minimizedButton = document.createElement("div");
  Object.assign(minimizedButton.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    width: "60px",
    height: "60px",
    backgroundColor: "rgba(30, 41, 59, 0.6)",
    borderRadius: "50%",
    border: "none",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
    zIndex: "999999",
    cursor: "pointer",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.3s ease-in-out",
    display: "flex",
  });

  // Add icon to minimized button
  minimizedButton.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      <path d="M8 10h.01"/>
      <path d="M12 10h.01"/>
      <path d="M16 10h.01"/>
    </svg>
  `;

  // Button hover effects
  minimizedButton.addEventListener("mouseenter", () => {
    minimizedButton.style.transform = "scale(1.1)";
    minimizedButton.style.backgroundColor = "rgba(30, 41, 59, 1)";
  });

  minimizedButton.addEventListener("mouseleave", () => {
    minimizedButton.style.transform = "scale(1)";
    minimizedButton.style.backgroundColor = "rgba(30, 41, 59, 0.5)";
  });

  minimizedButton.addEventListener("click", () => {
    showExtension();
  });

  // Append elements to DOM
  document.body.appendChild(iframe);
  document.body.appendChild(minimizedButton);

  // Extension visibility functions
  function minimizeExtension() {
    iframe.style.transform = "scale(0)";
    iframe.style.opacity = "0";

    setTimeout(() => {
      iframe.style.display = "none";
      minimizedButton.style.display = "flex";

      setTimeout(() => {
        minimizedButton.style.transform = "scale(1)";
        minimizedButton.style.opacity = "1";
      }, 50);
    }, 300);
  }

  function showExtension() {
    minimizedButton.style.transform = "scale(0)";
    minimizedButton.style.opacity = "0";

    setTimeout(() => {
      minimizedButton.style.display = "none";
      iframe.style.display = "block";

      setTimeout(() => {
        iframe.style.transform = "scale(1)";
        iframe.style.opacity = "1";
      }, 50);
    }, 200);
  }

  // Function to send auth state to iframe
  async function sendAuthToIframe() {
    
    // Request auth state from background
    chrome.runtime.sendMessage({ type: 'GET_AUTH_STATE' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Inject] Error getting auth state:', chrome.runtime.lastError);
        // Send empty auth state on error
        iframe.contentWindow?.postMessage({
          type: 'AUTH_STATE_UPDATE',
          payload: {
            authData: null,
            profile: null
          }
        }, '*');
        return;
      }



      if (response && iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          type: 'AUTH_STATE_UPDATE',
          payload: {
            authData: response.authData,
            profile: response.profile
          }
        }, '*');
      }
    });
  }

  // Message handler for iframe communication
  window.addEventListener("message", (event) => {
    // Only accept messages from our extension
    if (event.source !== iframe.contentWindow) return;

    const { type, payload } = event.data || {};

    switch (type) {
      case "CROSSIE_RESIZE":
        if (payload?.width && payload?.height) {
          iframe.style.transition = "width 0.3s ease, height 0.3s ease";
          iframe.style.width = `${payload.width}px`;
          iframe.style.height = `${payload.height}px`;

          setTimeout(() => {
            iframe.style.transition = "all 0.3s ease-in-out";
          }, 300);
        }
        break;

      case "CROSSIE_MINIMIZE":
        minimizeExtension();
        break;

      case "CROSSIE_SHOW":
        showExtension();
        break;

      case "REQUEST_AUTH_STATE":
        // Iframe is requesting auth state
        sendAuthToIframe();
        break;

      default:
        // Unknown message type
        break;
    }
  });

  // Listen for messages from extension (popup/background)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { type, payload } = message || {};
    
    switch (type) {
      case "SHOW_EXTENSION":
        showExtension();
        sendResponse({ success: true });
        break;

      case "HIDE_EXTENSION":
        minimizeExtension();
        sendResponse({ success: true });
        break;

      case "TOGGLE_EXTENSION":
        if (iframe.style.display === "none") {
          showExtension();
        } else {
          minimizeExtension();
        }
        sendResponse({ success: true });
        break;

      case "AUTH_STATE_CHANGED":
        // Auth state changed, send update to iframe
        sendAuthToIframe();
        break;

      default:
        // Unknown message type
        break;
    }

    return true; // Keep message channel open for async response
  });

  // Send initial auth state when iframe loads
  iframe.addEventListener('load', () => {
    // Wait a bit for iframe to initialize
    setTimeout(() => {
      sendAuthToIframe();
    }, 100);
  });

  // Initial setup - start minimized
  setTimeout(() => {
    minimizedButton.style.transform = "scale(1)";
    minimizedButton.style.opacity = "1";
  }, 500);
})();