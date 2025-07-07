// src/background.js - Service worker for handling extension-wide messages

// Helper function to get auth state from storage
async function getAuthState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['crossie_auth'], (result) => {
      if (chrome.runtime.lastError) {
        console.error('Storage error:', chrome.runtime.lastError);
        resolve({ authData: null, profile: null });
        return;
      }

      const authData = result.crossie_auth;
      if (authData && authData.user) {
        // Check if token is still valid
        const isTokenValid = authData.expires_at > Date.now() / 1000;
        if (isTokenValid) {
          // Fetch profile if we have auth
          fetchProfile(authData.user.id, authData.access_token)
            .then(profile => {
              resolve({ authData, profile });
            })
            .catch(err => {
              console.error('Profile fetch error:', err);
              resolve({ authData, profile: null });
            });
        } else {
          // Token expired
          resolve({ authData: null, profile: null });
        }
      } else {
        resolve({ authData: null, profile: null });
      }
    });
  });
}

// Fetch profile from Supabase
async function fetchProfile(userId, accessToken) {
  
  try {
    // Get Supabase config from storage
    const configResult = await chrome.storage.local.get(['supabase_config']);
    const config = configResult.supabase_config || {
      url: 'https://sxargqkknhkcfvhbttrh.supabase.co',
      anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4YXJncWtrbmhrY2Z2aGJ0dHJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA3MzEyMDAsImV4cCI6MjA2NjMwNzIwMH0.Q70cLGf69Al2prKMDSkCTnCGTuiKGY-MFK2tQ1g2T-k'
    };

    const url = `${config.url}/rest/v1/profiles?id=eq.${userId}&select=id,username,email`;

    const response = await fetch(url, {
      headers: {
        'apikey': config.anonKey,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      }
    });

    if (response.ok) {
      const data = await response.json();
      if (data && data.length > 0) {
        return data[0];
      }
    }
    return null;
  } catch (error) {
    console.error('[Background] Profile fetch failed:', error);
    return null;
  }
}

// Handle messages from content scripts and other parts of the extension
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type } = message || {};

  switch (type) {
    case 'GET_AUTH_STATE':
      // Get auth state for content script
      getAuthState().then(authState => {
        sendResponse(authState);
      });
      return true; // Keep message channel open for async response

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
    const allowedOrigins = ['https://trycrossie.vercel.app', 'http://localhost:3000'];
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

// Listen for storage changes and broadcast auth state changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.crossie_auth) {
    // Auth state changed, notify all tabs
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, {
            type: 'AUTH_STATE_CHANGED'
          }).catch(() => {
            // Ignore errors for tabs without the content script
          });
        }
      });
    });
  }
});

// Optional: Handle extension installation or updates
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Crossie extension installed!');
    // Could open a welcome page here
  } else if (details.reason === 'update') {
    console.log('Crossie extension updated!');
  }
});