import '@fontsource-variable/cairo';
import './admin.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// حماية من تضمين لوحة الإدارة داخل إطار في موقع آخر (Clickjacking)
if (window.top !== window.self) {
  document.body.innerHTML = '<p style="font-family:sans-serif;padding:2rem">لا يمكن فتح لوحة الإدارة داخل إطار.</p>';
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
