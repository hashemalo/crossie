// inject.ts - Pure content script without modules
(() => {
  // Create iframe element
  const iframe = document.createElement("iframe");

  const hostUrl = encodeURIComponent(window.location.href);
  iframe.src = chrome.runtime.getURL(`frame.html?host=${hostUrl}`);

  // Apply iframe styles for fixed sidebar layout
  Object.assign(iframe.style, {
    position: "fixed",
    top: "0px",
    right: "0px",
    width: "350px",
    height: "100vh",
    border: "none",
    borderLeft: "1px solid rgba(0, 0, 0, 0.1)",
    zIndex: "999999",
    backgroundColor: "transparent",
    transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
    display: "none",
    boxShadow: "-4px 0 20px rgba(0, 0, 0, 0.15)",
    transform: "translateX(100%)", // Start off-screen
  });

  // Create toggle button (minimal, Apollo-style)
  const toggleButton = document.createElement("div");
  Object.assign(toggleButton.style, {
    position: "fixed",
    top: "5%",
    right: "0px",
    transform: "translateY(-50%)",
    width: "40px",
    height: "40px",
    backgroundColor: "rgba(30, 41, 59, 0.5)",
    border: "1px solid rgba(255, 255, 255, 0.6)",
    borderRight: "none",
    borderTopLeftRadius: "8px",
    borderBottomLeftRadius: "8px",
    zIndex: "999999",
    cursor: "pointer",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.2s ease",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "8px 4px",
  });

  // Add icon to toggle button
  toggleButton.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      <path d="M8 10h.01"/>
      <path d="M12 10h.01"/>
      <path d="M16 10h.01"/>
    </svg>
  `;

  // Button hover effects
  toggleButton.addEventListener("mouseenter", () => {
    toggleButton.style.backgroundColor = "rgba(30, 41, 59, 0.8)";
    toggleButton.style.transform = "translateY(-50%) scale(1.05)";
  });

  toggleButton.addEventListener("mouseleave", () => {
    toggleButton.style.backgroundColor = "rgba(30, 41, 59, 0.5)";
    toggleButton.style.transform = "translateY(-50%) scale(1)";
  });

  // Append elements to DOM
  document.body.appendChild(iframe);
  document.body.appendChild(toggleButton);

  // Track sidebar state
  let isSidebarOpen = false;

  // Sidebar visibility functions
  function closeSidebar() {
    isSidebarOpen = false;
    iframe.style.transform = "translateX(100%)";

    // Notify iframe it's being closed
    iframe.contentWindow?.postMessage(
      {
        type: "CROSSIE_MINIMIZE",
      },
      "*"
    );

    setTimeout(() => {
      iframe.style.display = "none";
      toggleButton.style.display = "flex";
      
      // Ensure toggle button is visible and properly positioned
      setTimeout(() => {
        toggleButton.style.transform = "translateY(-50%)";
        toggleButton.style.opacity = "1";
      }, 50);
    }, 300);
  }

  function openSidebar() {
    isSidebarOpen = true;
    toggleButton.style.transform = "translateY(-50%) scale(0.9)";
    toggleButton.style.opacity = "0";

    setTimeout(() => {
      toggleButton.style.display = "none";
      iframe.style.display = "block";

      // Notify iframe it's being opened
      iframe.contentWindow?.postMessage(
        {
          type: "CROSSIE_SHOW",
        },
        "*"
      );

      // Trigger the slide-in animation
      requestAnimationFrame(() => {
        iframe.style.transform = "translateX(0)";
      });
    }, 200);
  }

  // Toggle function
  function toggleSidebar() {
    if (isSidebarOpen) {
      closeSidebar();
    } else {
      openSidebar();
    }
  }

  // Event listeners
  toggleButton.addEventListener("click", toggleSidebar);

  // Function to send auth state to iframe
  async function sendAuthToIframe() {
    // Request auth state from background
    chrome.runtime.sendMessage({ type: "GET_AUTH_STATE" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error(
          "[Inject] Error getting auth state:",
          chrome.runtime.lastError
        );
        // Send empty auth state on error
        iframe.contentWindow?.postMessage(
          {
            type: "AUTH_STATE_UPDATE",
            payload: {
              authData: null,
              profile: null,
            },
          },
          "*"
        );
        return;
      }

      if (response && iframe.contentWindow) {
        iframe.contentWindow.postMessage(
          {
            type: "AUTH_STATE_UPDATE",
            payload: {
              authData: response.authData,
              profile: response.profile,
            },
          },
          "*"
        );
      }
    });
  }

  // Message handler for iframe communication
  window.addEventListener("message", (event) => {
    // Only accept messages from our extension
    if (event.source !== iframe.contentWindow) return;

    const { type, payload } = event.data || {};

    switch (type) {
      case "CROSSIE_MINIMIZE":
        closeSidebar();
        break;

      case "CROSSIE_SHOW":
        openSidebar();
        break;

      case "REQUEST_AUTH_STATE":
        // Iframe is requesting auth state
        sendAuthToIframe();
        break;

      case "HIGHLIGHT_TEXT":
        // Highlight text on the page
        const { text } = event.data.payload || {};
        if (text) {
          highlightTextOnPage(text);
        }
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
        openSidebar();
        sendResponse({ success: true });
        break;

      case "HIDE_EXTENSION":
        closeSidebar();
        sendResponse({ success: true });
        break;

      case "TOGGLE_EXTENSION":
        toggleSidebar();
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
  iframe.addEventListener("load", () => {
    // Wait a bit for iframe to initialize
    setTimeout(() => {
      sendAuthToIframe();
    }, 100);
  });

  // Text selection and annotation functionality
  let currentSelection: { text: string; range: Range } | null = null;

  // Handle text selection when iframe is open
  function handleTextSelection() {
    if (!isSidebarOpen) return; // Only handle selection when sidebar is open

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    // Normalize the text (trim whitespace, handle line breaks)
    const normalizedText = selectedText
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 200); // Limit length for display

    // Send selected text to iframe
    iframe.contentWindow?.postMessage(
      {
        type: "TEXT_SELECTION",
        payload: {
          selectedText: normalizedText,
          originalText: selectedText,
        },
      },
      "*"
    );
  }

  // Handle text selection events
  document.addEventListener("selectionchange", () => {
    // Only handle selection when sidebar is open
    if (isSidebarOpen) {
      handleTextSelection();
    }
  });

  // Function to highlight text on the page
  function highlightTextOnPage(text: string) {
    // Find all text nodes that contain the highlighted text
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );

    const textNodes: Text[] = [];
    let node;
    while (node = walker.nextNode()) {
      if (node.textContent?.includes(text)) {
        textNodes.push(node as Text);
      }
    }

    // Highlight each occurrence
    textNodes.forEach((textNode) => {
      const content = textNode.textContent || "";
      const index = content.indexOf(text);
      
      if (index !== -1) {
        const before = content.substring(0, index);
        const after = content.substring(index + text.length);
        
        const span = document.createElement("span");
        span.style.backgroundColor = "#fef08a"; // Yellow highlight
        span.style.borderRadius = "2px";
        span.textContent = text;
        
        const fragment = document.createDocumentFragment();
        fragment.appendChild(document.createTextNode(before));
        fragment.appendChild(span);
        fragment.appendChild(document.createTextNode(after));
        
        textNode.parentNode?.replaceChild(fragment, textNode);
      }
    });
  }

  // Initial setup - start closed
  setTimeout(() => {
    toggleButton.style.transform = "translateY(-50%)";
    toggleButton.style.opacity = "1";
  }, 500);
})();