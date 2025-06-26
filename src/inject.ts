// inject.ts - Simplified with AuthService
import { authService } from './shared/authService.ts';

const iframe = document.createElement('iframe');
iframe.src = chrome.runtime.getURL('frame.html');

Object.assign(iframe.style, {
  position: 'fixed',
  bottom: '20px',
  right: '20px',
  width: '400px',
  height: '500px',
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

minimizedButton.addEventListener('mouseenter', () => {
  minimizedButton.style.transform = 'scale(1.1)';
});

minimizedButton.addEventListener('mouseleave', () => {
  minimizedButton.style.transform = 'scale(1)';
});

minimizedButton.addEventListener('click', () => {
  showExtension();
});

document.body.appendChild(iframe);
document.body.appendChild(minimizedButton);

// Subscribe to auth service for state changes
authService.subscribe((authState) => {
  // Send auth state to iframe whenever it changes
  sendAuthStateToIframe(authState);
});

// Send auth state to iframe
function sendAuthStateToIframe(authState?: any) {
  if (iframe.contentWindow) {
    const state = authState || authService.getState();
    iframe.contentWindow.postMessage({
      type: 'AUTH_STATE_UPDATE',
      authenticated: state.authenticated,
      user: state.user,
      profile: state.profile,
      loading: state.loading
    }, '*');
  }
}


// Handle sign out
async function handleSignOut() {
  await authService.signOut();
}

function minimizeExtension() {
  iframe.style.transform = 'scale(0)';
  iframe.style.opacity = '0';
  
  setTimeout(() => {
    iframe.style.display = 'none';
    minimizedButton.style.display = 'flex';
    
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
    
    setTimeout(() => {
      iframe.style.transform = 'scale(1)';
      iframe.style.opacity = '1';
    }, 50);
    
    // Send current auth state when showing
    sendAuthStateToIframe();
  }, 200);
}

// Listen for messages from iframe
window.addEventListener('message', (event) => {
  const { type, width, height } = event.data || {};

  if (type === 'CROSSIE_RESIZE') {
    // Smooth resize animation
    iframe.style.transition = 'width 0.3s ease, height 0.3s ease';
    iframe.style.width = `${width}px`;
    iframe.style.height = `${height}px`;
    
    // Remove transition after animation completes
    setTimeout(() => {
      iframe.style.transition = 'all 0.3s ease-in-out';
    }, 300);
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
  

  
  if (type === 'SIGN_OUT') {
    handleSignOut();
  }
});

// Listen for auth state changes from background/popup
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'AUTH_STATE_CHANGED') {
    // Auth service will automatically handle this through storage listener
  }
});

// Initialize auth state when iframe loads
iframe.onload = () => {
  // Send current auth state
  sendAuthStateToIframe();
};