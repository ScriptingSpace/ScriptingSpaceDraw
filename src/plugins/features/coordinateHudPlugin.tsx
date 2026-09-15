// ─────────────────────────────────────────────────────────────────────────────
// REMOVABLE feature plugin: COORDINATE HUD (bottom-left readout).
//
// Wraps the CoordinateHud component (components/CoordinateHud.tsx) as a
// plugin: on every execution it resolves the context's live pointer cursor
// (viewport-relative px) into canvas coordinates via screenToCanvas and
// returns the HUD node. The HUD hides itself when the cursor is null
// (pointer off-canvas).
//
// REMOVABLE: pure readout — removing it leaves a fully working canvas.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { CoordinateHud } from '../../components/CoordinateHud';
import { screenToCanvas } from '../../functions/canvasTransform';
import { mountOf } from '../core/DrawPluginRegistry';
import type { DrawPlugin, DrawPluginContext } from '../core';

// The plugin function — returns the coordinate HUD node on every execution.
export const coordinateHudPlugin = mountOf(
    (context: DrawPluginContext) => {
        const transform = context.transform();
        const cursor = context.pointer().cursor;
        // No transform yet, or the pointer is off-canvas → render nothing
        // (the HUD contract: never show stale numbers)
        if (!transform || !cursor) return null;
        return (
            <CoordinateHud
                // Resolve the viewport-relative cursor point to canvas
                // coordinates relative to the world origin (the accent
                // cross): canvas = screen / scale + pan
                point={screenToCanvas(cursor, transform)}
                colors={{ border: context.palette.border, text: context.palette.textFaint }}
            />
        );
    },
    // Mount slot: nothing to wire — pure render plugin
    () => undefined,
) satisfies DrawPlugin;
