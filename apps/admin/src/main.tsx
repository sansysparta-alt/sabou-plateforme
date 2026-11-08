import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@sabou/ui/styles.css';
// Styles propres aux pages pas encore passées sur @sabou/ui (US-016, en cours)
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
