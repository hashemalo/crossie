// src/background.js - Service worker for handling extension-wide messages

// Handle messages from content scripts and other parts of the extension
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type } = message || {};

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

    case 'AUTH_SUCCESS':
      // Internal auth success message - forward to extension pages
      chrome.tabs.query({}, function(tabs) {
        tabs.forEach(tab => {
          if (tab.url && tab.url.startsWith(chrome.runtime.getURL(''))) {
            chrome.tabs.sendMessage(tab.id, {
              type: 'AUTH_SUCCESS',
              session: message.session,
              token: message.token
            });
          }
        });
      });
      
      // Also try to send to popup if it's open
      chrome.runtime.sendMessage({
        type: 'AUTH_SUCCESS',
        session: message.session,
        token: message.token
      }).catch(() => {
        // Popup might not be open, that's ok
      });
      break;

    case 'CHECK_AUTH':
      // Check if user is authenticated
      chrome.storage.local.get(['auth_data'], (result) => {
        sendResponse({
          authenticated: !!result.auth_data,
          data: result.auth_data
        });
      });
      return true; // Keep message channel open for async response

    default:
      // Unknown message type
      break;
  }

  return true; // Keep message channel open for async responses
});

// Listen for messages from external websites (like crossie.app)
chrome.runtime.onMessageExternal.addListener(
  function(request, sender, sendResponse) {
    
    // Verify the sender - update this to match your website URL
    const allowedOrigins = ['https://crossie.app', 'http://localhost:3000'];
    if (!allowedOrigins.includes(sender.origin)) {
      console.error('Invalid sender origin:', sender.origin);
      return;
    }
    
    if (request.type === 'AUTH_SUCCESS') {
      // Store auth data with profile AND supabase config
      if (request.session) {
        const authData = {
          access_token: request.session.access_token,
          refresh_token: request.session.refresh_token,
          user: request.session.user,
          expires_at: request.session.expires_at
        };
        
        // Prepare storage data
        const storageData = {
          crossie_auth: authData,
          auth_token: request.token
        };
        
        // Add Supabase config if provided
        if (request.session.supabase_config) {
          storageData.supabase_config = request.session.supabase_config;
        }
        
        // Store everything
        chrome.storage.local.set(storageData, () => {
          
          // If profile data is included, log it
          if (request.session.profile) {
            console.log('Profile data included:', request.session.profile);
          }
        });
      }
      
      // Forward the message to any open extension popups or tabs
      chrome.runtime.sendMessage({
        type: 'AUTH_SUCCESS',
        session: request.session,
        token: request.token
      }).catch(() => {
        // Popup might not be open
      });
      
      // Also try to send to any open extension pages
      chrome.tabs.query({}, function(tabs) {
        tabs.forEach(tab => {
          if (tab.url && tab.url.startsWith(chrome.runtime.getURL(''))) {
            chrome.tabs.sendMessage(tab.id, {
              type: 'AUTH_SUCCESS',
              session: request.session,
              token: request.token
            }).catch(() => {
              // Tab might not have a listener
            });
          }
        });
      });
      
      // Broadcast auth state change to all tabs with content scripts
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, {
              type: 'AUTH_STATE_CHANGED',
              authenticated: true,
              user: request.session.user,
              profile: request.session.profile
            }).catch(() => {
              // Ignore errors for tabs without the content script
            });
          }
        });
      });
      
      sendResponse({success: true});
    }
  }
);

// Optional: Handle extension installation or updates
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Crossie extension installed!');
    // Could open a welcome page here
  } else if (details.reason === 'update') {
    console.log('Crossie extension updated!');
  }
});