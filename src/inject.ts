// inject.ts - Static overlay version
const iframe = document.createElement('iframe');
iframe.src = chrome.runtime.getURL('frame.html');

Object.assign(iframe.style, {
  position: 'fixed',
  top: '20px',
  right: '20px',
  width: '400px',
  height: '300px',
  border: 'none',
  borderRadius: '12px',
  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)',
  zIndex: '999999',
  backgroundColor: 'transparent',
});

document.body.appendChild(iframe);

// Listen for resize messages from iframe
window.addEventListener('message', (event) => {
  const { type, width, height } = event.data || {};

  if (type === 'CROSSIE_RESIZE') {
    iframe.style.width = `${width}px`;
    iframe.style.height = `${height}px`;
  }
});