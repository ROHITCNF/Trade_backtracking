import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { applyTheme, readTheme } from './lib/theme.js';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/form.css';
import './styles/v2.css';

applyTheme(readTheme());

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
