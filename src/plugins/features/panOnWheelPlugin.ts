// ─────────────────────────────────────────────────────────────────────────────
// REMOVABLE feature plugin: PAN ON WHEEL — horizontal wheel pans left/right.
//
// Consumes the wheel core plugin's raw `panX` delta and applies it to the
// transform with applyPan (negated — NATURAL SCROLL convention, like a
// page: tilting/scrolling right scrolls the viewport right, i.e. the
// content slides LEFT → the paper moves −dx, opposite of the drag gesture
// where the paper follows the hand). applyPan ÷scales the delta for
// zoom-compensated visual speed (same contract as dragging).
//
// deltaX NEVER zooms; deltaY never pans (this plugin ignores zoomFactor
// entirely — the zoomOnWheelPlugin owns it).
//
// REMOVABLE: removing it disables horizontal wheel panning; everything else
// keeps working.
// ─────────────────────────────────────────────────────────────────────────────

import { applyPan } from '../../functions/canvasTransform';
import { mountOf } from '../core/DrawPluginRegistry';
import type { DrawPlugin, DrawPluginContext } from '../core';
import type { DrawWheelState } from '../core/DrawPluginContext';

// The plugin function — renders nothing; all work is in the mount slot.
export const panOnWheelPlugin = mountOf(
    // Execution: nothing per-render — the gesture is event-driven
    () => null,
    // Mount: attach a bubbling wheel listener that applies the pan
    (surface: HTMLDivElement, context: DrawPluginContext) => {
        // Per-mount sequence tracker (closure state — see zoomOnWheelPlugin)
        let lastSequence = -1;

        const handleWheel = (event: WheelEvent) => {
            const state = context.wheel() as DrawWheelState;
            // Fresh-event guard (same contract as the zoom plugin)
            if (!state || state.sequence === lastSequence) return;
            lastSequence = state.sequence;
            // deltaX 0 (pure vertical) → nothing to pan
            if (state.panX === 0) return;
            // Negated deltaX → natural-scroll horizontal pan (see header).
            // applyPan divides by scale for zoom-compensated visual speed.
            const transform = context.transform();
            context.transform(applyPan(transform, -state.panX, 0));
        };

        surface.addEventListener('wheel', handleWheel);
        return () => surface.removeEventListener('wheel', handleWheel);
    },
) satisfies DrawPlugin;
