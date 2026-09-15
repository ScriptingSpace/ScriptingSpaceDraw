// ─────────────────────────────────────────────────────────────────────────────
// REMOVABLE feature plugin: ZOOM HUD (bottom-right readout + Reset view).
//
// Wraps the ZoomHud component (components/ZoomHud.tsx) as a plugin: returns
// the HUD node (scientific-notation scale readout + Reset view button) on
// every execution, reading the LIVE transform from the context.
//
// The panel is wrapped in a `data-hud` container — the pointer core plugin
// treats pointer-downs inside any `[data-hud]` subtree as HUD-owned (no
// canvas drag starts there), so the Reset button stays clickable.
//
// REMOVABLE: pure presentation + one convenience control — removing it
// leaves a fully working canvas (reset is also reachable programmatically
// via context.resetTransform).
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { ZoomHud } from '../../components/ZoomHud';
import { mountOf } from '../core/DrawPluginRegistry';
import type { DrawPlugin, DrawPluginContext } from '../core';

// The plugin function — returns the zoom HUD node on every execution.
export const zoomHudPlugin = mountOf(
    (context: DrawPluginContext) => {
        const transform = context.transform();
        // No transform yet (first pass before the store plugin seeds it)
        if (!transform) return null;
        return (
            // data-hud wrapper — the pointer plugin's gesture gate reads it
            <div data-hud="zoom-hud">
                <ZoomHud
                    transform={transform}
                    onReset={context.resetTransform}
                    colors={{
                        border: context.palette.border,
                        text: context.palette.textFaint,
                        textBright: context.palette.textBright,
                        hover: context.palette.surfaceHover,
                    }}
                />
            </div>
        );
    },
    // Mount slot: nothing to wire — pure render plugin
    () => undefined,
) satisfies DrawPlugin;
