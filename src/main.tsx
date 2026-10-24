import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

// StrictMode double-invokes effects in development, which would create two
// WebGL contexts and two AudioContexts. The renderer disposes cleanly, so this
// is safe, but it doubles start-up cost — hence dev-only.
createRoot(root).render(
  import.meta.env.DEV ? (
    <StrictMode>
      <App />
    </StrictMode>
  ) : (
    <App />
  ),
);
