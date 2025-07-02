// index.tsx
import ReactDOM from 'react-dom/client';
import AuthView from './authView';
import '../index.css';
import React, { useRef, useEffect } from 'react';

// Wrapper component that resizes window to fit children
function AutoResizeWrapper({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const resize = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();

      // Padding/buffer to avoid scrollbars
      const newWidth = Math.min(Math.max(400, rect.width + 40), 800);
      const newHeight = Math.min(Math.max(300, rect.height + 60), 800);

      try {
        window.resizeTo(newWidth, newHeight);

        const left = (window.screen.width - newWidth) / 2;
        const top = (window.screen.height - newHeight) / 2;
        window.moveTo(left, top);
      } catch (e) {
        console.warn("Resize failed:", e);
      }
    };

    // Resize once after mount
    resize();

    // Resize again if content changes (e.g., view switch)
    const ro = new ResizeObserver(resize);
    if (containerRef.current) {
      ro.observe(containerRef.current);
    }

    return () => ro.disconnect();
  }, []);

  return <div ref={containerRef}>{children}</div>;
}

// Mount with auto-resize wrapper
const root = ReactDOM.createRoot(document.getElementById('popup-root')!);
root.render(
  <AutoResizeWrapper>
    <AuthView />
  </AutoResizeWrapper>
);
