// ─────────────────────────────────────────────────────────────────────────────
// Core plugin: TRANSFORM STORE.
//
// NON-REMOVABLE (fundamental building block): the transform store IS the
// dashboard's state. Every other plugin reads pan/zoom from it and every
// gesture writes through it. Without it the canvas has no world at all.
//
// What this plugin contributes:
// - Initializes the context's transform handle to the origin-centered
//   resting state (createInitialTransform) on first execution.
// - Exposes `resetTransform` on the context so removable plugins (the zoom
//   HUD's Reset view button) can snap back without owning state.
//
// The handle itself is created by the HOST (it is a React hook call — the
// host must own hook ordering); this plugin only seeds + manages the value.
// ─────────────────────────────────────────────────────────────────────────────

import {
    createInitialTransform,
} from '../../functions/canvasTransform';
import type { CanvasTransform } from '../../functions/canvasTransform';
import { mountOf } from '../core/DrawPluginRegistry';
import type { DrawPlugin, DrawPluginContext } from '../core';

// The transform plugin — a standalone function. On every execution it
// guarantees the transform handle holds a valid transform (seeds the
// initial value exactly once; later executions see the live value and
// leave it alone).
export const transformStorePlugin = mountOf(
    (context: DrawPluginContext) => {
        // Seed once: an unset handle starts at the pre-seed sentinel value.
        // Reading + checking here (instead of in the host) keeps ALL state
        // ownership inside plugins — the host stays a pure executor.
        const current = context.transform();
        if (!current) {
            // Measure the surface if it exists (real browser mount); fall
            // back to the 800×600 design size (jsdom pre-layout, and the
            // resize core plugin corrects the real size right after mount).
            const surface = context.surface();
            const width = surface?.clientWidth || 800;
            const height = surface?.clientHeight || 600;
            context.transform(createInitialTransform(width, height) as CanvasTransform);
        }
        // Rendering plugins return a node; this is a behavior plugin → null
        return null;
    },
    // Mount slot: nothing to wire — the store is pure state. Registered so
    // the runtime treats the plugin uniformly.
    () => undefined,
) satisfies DrawPlugin;
