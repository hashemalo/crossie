import { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import Crossie from './Crossie';
import '../index.css';

const App = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Observe size changes and notify parent
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        
        // Send resize message to parent window
        window.parent.postMessage(
          {
            type: 'CROSSIE_RESIZE',
            payload: {
              width: Math.ceil(width),
              height: Math.ceil(height),
            }
          },
          '*'
        );
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Listen for messages from parent (if needed in the future)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Only handle messages from parent window
      if (event.source !== window.parent) return;

      const { type  } = event.data || {};

      switch (type) {
        // Add any frame-specific message handlers here
        default:
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full">
      <Crossie />
    </div>
  );
};

// Mount the app
const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);