import { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import Crossie from './Crossie';
import '../index.css';

const App = () => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      window.parent.postMessage(
        {
          type: 'CROSSIE_RESIZE',
          width: rect.width,
          height: rect.height,
        },
        '*'
      );
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref}>
      <Crossie />
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
