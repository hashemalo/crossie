// inject.ts - Handles auth and passes user data to iframe
const iframe = document.createElement('iframe');
iframe.src = chrome.runtime.getURL('frame.html');

Object.assign(iframe.style, {
  position: 'fixed',
  bottom: '20px',
  right: '20px',
  width: '300px',
  height: '400px',
  border: 'none',
  borderRadius: '12px',
  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)',
  zIndex: '999999',
  backgroundColor: 'transparent',
  transition: 'all 0.3s ease-in-out',
  display: 'none',
});

// Create minimized button
const minimizedButton = document.createElement('div');
Object.assign(minimizedButton.style, {
  position: 'fixed',
  bottom: '20px',
  right: '20px',
  width: '60px',
  height: '60px',
  backgroundColor: 'rgba(30, 41, 59, 0.5)',
  borderRadius: '50%',
  border: 'none',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
  zIndex: '999999',
  cursor: 'pointer',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'all 0.3s ease-in-out',
  display: 'flex',
});

minimizedButton.innerHTML = `
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    <path d="M8 10h.01"/>
    <path d="M12 10h.01"/>
    <path d="M16 10h.01"/>
  </svg>
`;

// Add hover effect to minimized button
minimizedButton.addEventListener('mouseenter', () => {
  minimizedButton.style.transform = 'scale(1.1)';
});

minimizedButton.addEventListener('mouseleave', () => {
  minimizedButton.style.transform = 'scale(1)';
});

// Click to restore
minimizedButton.addEventListener('click', () => {
  showExtension();
});

document.body.appendChild(iframe);
document.body.appendChild(minimizedButton);

// Auth state management
let currentUser: any = null;
let currentProfile: any = null;

// Check auth state and create mock profile
async function checkAuthState() {
  try {
    const result = await chrome.storage.local.get(['crossie_auth']);
    const authData = result.crossie_auth;
    
    if (authData && authData.expires_at > Date.now() / 1000) {
      currentUser = authData.user;
      currentProfile = {
        username: `user_${authData.user.id.slice(-6)}`,
        full_name: authData.user.email?.split('@')[0] || 'User',
        avatar_url: `https://ui-avatars.com/api/?name=${authData.user.email?.split('@')[0] || 'User'}&background=3b82f6&color=fff`
      };
    } else {
      currentUser = null;
      currentProfile = null;
    }
    
    // Send auth state to iframe
    sendAuthStateToIframe();
  } catch (error) {
    console.error('Auth check error:', error);
    currentUser = null;
    currentProfile = null;
    sendAuthStateToIframe();
  }
}

// Send auth state to iframe
function sendAuthStateToIframe() {
  if (iframe.contentWindow) {
    iframe.contentWindow.postMessage({
      type: 'AUTH_STATE_UPDATE',
      authenticated: !!currentUser,
      user: currentUser,
      profile: currentProfile
    }, '*');
  }
}

// Open auth popup
function openAuthPopup() {
  const authUrl = chrome.runtime.getURL('auth.html');
  const authWindow = window.open(
    authUrl, 
    'crossie-auth',
    'width=400,height=600,scrollbars=yes,resizable=yes'
  );
  
  // Check for auth completion periodically
  const checkAuth = setInterval(() => {
    try {
      if (authWindow?.closed) {
        clearInterval(checkAuth);
        // Recheck auth state after popup closes
        setTimeout(() => checkAuthState(), 500);
      }
    } catch (error) {
      // Window might be cross-origin, ignore errors
    }
  }, 1000);
}


function minimizeExtension() {
  iframe.style.transform = 'scale(0)';
  iframe.style.opacity = '0';
  
  setTimeout(() => {
    iframe.style.display = 'none';
    minimizedButton.style.display = 'flex';
    
    // Animate in the minimized button
    setTimeout(() => {
      minimizedButton.style.transform = 'scale(1)';
      minimizedButton.style.opacity = '1';
    }, 50);
  }, 300);
}

function showExtension() {
  minimizedButton.style.transform = 'scale(0)';
  minimizedButton.style.opacity = '0';
  
  setTimeout(() => {
    minimizedButton.style.display = 'none';
    iframe.style.display = 'block';
    
    // Animate in the iframe
    setTimeout(() => {
      iframe.style.transform = 'scale(1)';
      iframe.style.opacity = '1';
    }, 50);
    
    // Send auth state when showing
    sendAuthStateToIframe();
  }, 200);
}

// Listen for messages from iframe
window.addEventListener('message', (event) => {
  const { type, width, height } = event.data || {};

  if (type === 'CROSSIE_RESIZE') {
    iframe.style.width = `${width}px`;
    iframe.style.height = `${height}px`;
  }
  
  if (type === 'CROSSIE_MINIMIZE') {
    minimizeExtension();
  }
  
  if (type === 'CROSSIE_RESTORE') {
    showExtension();
  }
  
  if (type === 'REQUEST_AUTH_STATE') {
    sendAuthStateToIframe();
  }
  
  if (type === 'OPEN_AUTH_POPUP') {
    openAuthPopup();
  }
  
    
});

// Listen for auth state changes from popup
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'AUTH_STATE_CHANGED') {
    checkAuthState();
  }
});

// Storage change listener for auth updates
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.crossie_auth) {
    checkAuthState();
  }
});

// Initialize auth state when iframe loads
iframe.onload = () => {
  checkAuthState();
};

// Initial auth check
checkAuthState();