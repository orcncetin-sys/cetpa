import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import 'leaflet/dist/leaflet.css';
import { initErrorLogger } from './services/errorLogger';

initErrorLogger();
// Not: PWA service worker kaydı index.html içinde zaten yapılıyor.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
