// ─────────────────────────────────────────────────────────────────────────────
// REMOVABLE feature plugin: GRID — the world-anchored SVG grid renderer.
//
// Wraps the GridLayer component (components/GridLayer.tsx — the full math
// rationale lives in its header) as a plugin: on every execution it returns
// the <svg> node carrying the grid, recomputed from the LIVE transform +
// viewport in the context. Re-execution per render pass is what keeps the
// grid in sync with pan/zoom.
//
// REMOVABLE: pure presentation — removing it leaves a working (if bare)
// canvas. The dashboard still pans/zooms; there is just nothing to see.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { GridLayer } from '../../components/GridLayer';
import { mountOf } from '../core/DrawPluginRegistry';
import type { DrawPlugin, DrawPluginContext } from '../core';

// The plugin function — returns the grid <svg> node on every execution.
export const gridPlugin = mountOf(
    (context: DrawPluginContext) => {
        const transform = context.transform();
        const { width, height } = context.viewport();
        // No transform yet (first pass before the store plugin seeds it) or
        // zero viewport → render nothing this pass
        if (!transform || width <= 0 || height <= 0) return null;
        return (
            <svg
                width={width}
                height={height}
                data-testid="grid-svg"
                style={{
                    display: 'block',
                    // Presentation-only (the same contract as the drawing +
                    // node overlays): the whole-viewport svg — and its
                    // transient <line> children, which React replaces on
                    // every zoom re-render — must never become the
                    // event.target of a press
                    pointerEvents: 'none',
                }}
            >
                <GridLayer
                    transform={transform}
                    width={width}
                    height={height}
                    // Palette tokens from the context (plugins never import
                    // the palette module directly)
                    colors={{ line: context.palette.border, origin: context.palette.accent }}
                />
            </svg>
        );
    },
    // Mount slot: nothing to wire — pure render plugin
    () => undefined,
) satisfies DrawPlugin;
