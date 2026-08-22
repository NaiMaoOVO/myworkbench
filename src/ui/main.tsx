import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { CockpitErrorBoundary } from './ErrorBoundary';
import './styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('MyWorkbench root element was not found.');
}

createRoot(root).render(
  <StrictMode>
    <CockpitErrorBoundary>
      <App />
    </CockpitErrorBoundary>
  </StrictMode>,
);
