import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, preloadCurrentPage } from './App';
import '@sabou/ui/styles.css';

preloadCurrentPage();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
