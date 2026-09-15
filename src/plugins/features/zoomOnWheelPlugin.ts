// ─────────────────────────────────────────────────────────────────────────────
// REMOVABLE feature plugin: ZOOM ON WHEEL — vertical wheel zooms at pointer.
//
// Consumes the wheel core plugin's normalized state (zoomFactor + wheelPoint)
// and applies it to the transform with applyZoom — the zoom-at-pointer
// contract: the canvas point under the cursor stays pinned under the cursor.
//
// HOW THE WIRING WORKS: the wheel core plugin owns the raw listener; this
// plugin mounts a SECOND listener on the same surface (regular bubbling —
// both listeners fire for every wheel event). Order is registration order:
// the core plugin's listener normalizes the deltas FIRST (it registered
// earlier), then this plugin reads the fresh normalized state. The
// `sequence` counter guards against consuming one event twice.
//
// REMOVABLE: removing it disables zooming but the canvas still pans and
// renders.
// ─────────────────────────────────────────────────────────────────────────────

import { applyZoom } from '../../functions/canvasTransform';
import { mountOf } from '../core/DrawPluginRegistry';
import type { DrawPlugin, DrawPluginContext } from '../core';
import type { DrawWheelState } from '../core/DrawPluginContext';

// The plugin function — renders nothing; all work is in the mount slot.
export const zoomOnWheelPlugin = mountOf(
    // Execution: nothing per-render — the gesture is event-driven
    () => null,
    // Mount: attach a bubbling wheel listener that applies the zoom
    (surface: HTMLDivElement, context: DrawPluginContext) => {
        // Per-mount sequence tracker (closure state — one dashboard surface
        // per mount; remounting resets it cleanly)
        let lastSequence = -1;

        const handleWheel = (event: WheelEvent) => {
            const state = context.wheel() as DrawWheelState;
            // Only react to FRESH events (the sequence counter from the
            // core plugin — a repeat value means the event was already
            // consumed by this listener)
            if (!state || state.sequence === lastSequence) return;
            lastSequence = state.sequence;
            // deltaY 0 (pure horizontal) → zoomFactor 1 → applyZoom is a
            // no-op; skip entirely to avoid a pointless transform write
            if (state.zoomFactor === 1) return;
            // Read-then-write (the useStateHook setter takes a VALUE —
            // cross-reference: packages/presource/react/src/hooks/local/state.ts)
            const transform = context.transform();
            const point = context.wheelPoint();
            context.transform(applyZoom(transform, state.zoomFactor, point));
        };

        surface.addEventListener('wheel', handleWheel);
        return () => surface.removeEventListener('wheel', handleWheel);
    },
) satisfies DrawPlugin;
