import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppV4 } from './App';
import './styles/v4-tokens.css';
import './styles-v4.css';
import './styles/v4-primitives.css';
import './styles/v4-shell.css';
import './styles/v4-polish.css';
import './styles/v4-interactions.css';

declare const __SCT_V4_BUILD__: { version: string; sourceSha256: string; builtAt: string };
document.documentElement.dataset.sctBuild = __SCT_V4_BUILD__.sourceSha256;
document.documentElement.dataset.sctVersion = __SCT_V4_BUILD__.version;

const root = document.getElementById('root');
if (!root) throw new Error('V4 application root not found.');

createRoot(root).render(
  <StrictMode>
    <AppV4 />
  </StrictMode>,
);
