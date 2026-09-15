// ─────────────────────────────────────────────────────────────────────────────
// Core plugin: RESIZE — viewport measurement of the canvas surface.
//
// NON-REMOVABLE (fundamental building block): the grid renderer, the
// origin-centered reset, and the zoom-at-pointer math all need the canvas
// surface's pixel size. Without measurement the dashboard cannot lay out
// its world.
//
// Measures on mount (first cycle) and on every window resize. The rect is
// read LAZILY on every invocation (not once at effect-mount) so test
// environments that stub getBoundingClientRect AFTER render still measure
// correctly on the next resize/reset — the contract inherited from the old
// monolithic dashboard's measure effect.
//
// GUARD: a zero-size rect (jsdom before layout, hidden surface) must not
// wipe the viewport to 0×0 — the grid math divides by the size. The
// previous/initial size is kept instead.
//
// Writes go through the `viewport` STATE handle (not ref) — a resize must
// re-render the grid.
// ─────────────────────────────────────────────────────────────────────────────

import { mountOf } from '../core/DrawPluginRegistry';
import type { DrawPlugin, DrawPluginContext } from '../core';

// The plugin function — renders nothing; all work is in the mount slot.
export const resizePlugin = mountOf(
    // Execution: nothing per-render — measurement is event-driven
    () => null,
    // Mount: measure once, then on every window resize
    (surface: HTMLDivElement, context: DrawPluginContext) => {
        // The measure callback — reads the rect LAZILY each time
        const measure = () => {
            const rect = surface.getBoundingClientRect();
            // Zero-size guard: keep the previous/initial size (see header)
            if (rect.width <= 0 || rect.height <= 0) return;
            context.viewport({ width: rect.width, height: rect.height });
        };

        measure();
        window.addEventListener('resize', measure);

        // Disposer — detach the resize listener
        return () => window.removeEventListener('resize', measure);
    },
) satisfies DrawPlugin;
