// ─────────────────────────────────────────────────────────────────────────────
// REMOVABLE feature plugin: FLOATING TITLE — "Draw Dashboard v1.0.0".
//
// The version label pinned top-left (the user contract: "there is no header
// or footer here; the title should simply be 'Draw Dashboard v1.0.0'
// floating top left"). Click-through (pointerEvents: none) so it never
// blocks zoom/pan. The version comes from the compile-time __APP_VERSION__
// constant injected by vite.config.ts `define` (declared ambient in
// src/vite-env.d.ts).
//
// REMOVABLE: pure decoration.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { styledComponent } from '@presource/react';
import { mountOf } from '../core/DrawPluginRegistry';
import type { DrawPlugin, DrawPluginContext } from '../core';

// Floating title pill — pinned top-left, above the canvas, click-through
const FloatingTitle = styledComponent('div', {
    position: 'absolute' as const,
    top: 12,
    left: 16,
    zIndex: 10,
    fontSize: 13,
    fontWeight: 600,
    color: '#c0caf5',
    // Subtle scrim so the title stays readable over grid lines
    background: 'rgba(26, 27, 38, 0.7)',
    padding: '4px 10px',
    borderRadius: 6,
    pointerEvents: 'none' as const,
    userSelect: 'none' as const,
});

// The plugin function — returns the title node on every execution.
export const titlePlugin = mountOf(
    () => (
        <FloatingTitle data-testid="floating-title">
            Draw Dashboard v{__APP_VERSION__}
        </FloatingTitle>
    ),
    // Mount slot: nothing to wire — pure render plugin
    () => undefined,
) satisfies DrawPlugin;
