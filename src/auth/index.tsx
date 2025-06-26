import ReactDOM from 'react-dom/client';
import AuthView from './authView';
import '../index.css';

const root = ReactDOM.createRoot(document.getElementById('popup-root')!);
root.render(<AuthView />);