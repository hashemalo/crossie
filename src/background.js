// src/background.js - Service worker for handling extension-wide messages

// Handle messages from content scripts and other parts of the extension
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, } = message || {};

  switch (type) {
    case 'OPEN_AUTH_POPUP':
      // Open the extension popup programmatically
      chrome.action.openPopup().catch(() => {
        // If openPopup fails (not supported in all contexts), 
        // create a new window with the auth page
        chrome.windows.create({
          url: chrome.runtime.getURL('auth.html'),
          type: 'popup',
          width: 420,
          height: 600,
          left: Math.round((screen.width - 420) / 2),
          top: Math.round((screen.height - 600) / 2)
        });
      });
      sendResponse({ success: true });
      break;

    case 'AUTH_STATE_CHANGED':
      // Broadcast auth state changes to all tabs
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, message).catch(() => {
              // Ignore errors for tabs without the content script
            });
          }
        });
      });
      break;

    default:
      // Unknown message type
      break;
  }

  return true; // Keep message channel open for async responses
});

// Optional: Handle extension installation or updates
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Crossie extension installed!');
  } else if (details.reason === 'update') {
    console.log('Crossie extension updated!');
  }
});