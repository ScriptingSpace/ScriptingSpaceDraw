import React from 'react';
import { createRoot } from 'react-dom/client';
import { DrawDashboard } from './dashboards';
// Global viewport lock: 100vh × 100vw, no body margin, no window scrollbar
import './app.css';

// Vite app entry — mounts the dashboard into the #root element from index.html
const container = document.getElementById('root') as HTMLElement;
createRoot(container).render(
    <React.StrictMode>
        <DrawDashboard />
    </React.StrictMode>,
);
