import { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import Crossie from './Crossie';
import '../index.css';

const App = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const isVisible = useRef(false);

  // Listen for messages from parent to track visibility
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Only handle messages from parent window
      if (event.source !== window.parent) return;

      const { type } = event.data || {};

      switch (type) {
        case 'CROSSIE_SHOW':
          isVisible.current = true;
          break;
        case 'CROSSIE_MINIMIZE':
          isVisible.current = false;
          break;
        default:
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col">
      <Crossie />
    </div>
  );
};

// Mount the app
const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);