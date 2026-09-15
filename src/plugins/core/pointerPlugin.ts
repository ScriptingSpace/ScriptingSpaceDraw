// ─────────────────────────────────────────────────────────────────────────────
// Core plugin: POINTER — mouse press, movement, release tracking.
//
// NON-REMOVABLE (fundamental building block): pointer press/move/release is
// the raw input stream every gesture (pan, drag-to-draw, future selection)
// is built from. The dashboard cannot deliver its interaction contract
// without it. This plugin does NOT decide what gestures mean — it only
// normalizes the raw events into the context's pointer state:
//   - `cursor`: viewport-relative point on every move (null on leave)
//   - `dragLast` + `dragButton`: set on press, cleared on release/leave
//   - `pressed`: which button is currently down
//
// COORDINATE MATH: all events are converted to viewport-relative pixels via
// the surface's getBoundingClientRect (jsdom reports clientX/Y relative to
// the viewport; the canvas may be offset in non-fullscreen embeds).
// Cross-reference: dashboards/DrawDashboard.tsx (previous getPointerPoint).
//
// GATEKEEPING: pointer-down on a `[data-hud]` subtree is recorded for the
// cursor but NOT as a drag start — HUD controls keep their own click
// behavior (cross-reference: zoomHudPlugin's data-hud wrapper).
// ─────────────────────────────────────────────────────────────────────────────

import { mountOf } from '../core/DrawPluginRegistry';
import { createPointerState } from '../core/DrawPluginContext';
import type { DrawPlugin, DrawPluginContext, DrawPointerState } from '../core';

// Viewport-relative pointer point from a raw event (reads the LIVE surface
// rect on every event — test environments stub getBoundingClientRect after
// render, so lazy reads keep measurements correct)
const getPointerPoint = (
    context: DrawPluginContext,
    event: { clientX: number; clientY: number },
): { x: number; y: number } => {
    const surface = context.surface();
    if (!surface) return { x: event.clientX, y: event.clientY };
    const rect = surface.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};

// The plugin function — renders nothing; all work is in the mount slot.
export const pointerPlugin = mountOf(
    // Execution: ensure the pointer state object exists (the host creates
    // it, but this keeps the plugin self-sufficient if re-seeded empty)
    (context: DrawPluginContext) => {
        if (!context.pointer()) {
            context.pointer(createPointerState());
        }
        return null;
    },
    // Mount: attach the pointer event listeners to the canvas surface
    (surface: HTMLDivElement, context: DrawPluginContext) => {
        // Write helper — replaces the pointer state object wholesale (the
        // handle is ref-backed: writes don't re-render; gesture plugins
        // write the TRANSFORM to drive renders)
        const write = (patch: Partial<DrawPointerState>) => {
            context.pointer({ ...(context.pointer() as DrawPointerState), ...patch });
        };

        const handlePointerDown = (event: PointerEvent) => {
            const point = getPointerPoint(context, event);
            // Cursor tracking happens regardless of gesture ownership
            write({ cursor: point });
            // The cursor is rendered state (the coordinate HUD reads it) —
            // a cursor change must re-render the host so readout plugins
            // re-execute with the fresh point (same contract as the old
            // monolithic dashboard, which kept cursorPoint in STATE)
            context.render();
            // HUD subtree → the gesture belongs to the HUD (buttons stay
            // clickable); still record cursor, never start a drag
            const target = event.target as HTMLElement | null;
            if (target?.closest?.('[data-hud]')) return;
            // NOTE: an active node adjustment (adjusting flag) is NOT gated
            // here — this listener runs BEFORE the node editor on the same
            // press (registration order), so the flag would be stale. The
            // dragToPanPlugin's mayPan consults the flag on every MOVE.
            write({ dragLast: point, dragButton: event.button });
        };

        const handlePointerMove = (event: PointerEvent) => {
            // Track the cursor on EVERY move (not just drags) — the
            // coordinate HUD follows the pointer at all times
            write({ cursor: getPointerPoint(context, event) });
            // Re-render so readout plugins re-execute with the fresh point
            // (drag moves also write the transform, which re-renders
            // anyway; React batches the two updates into one pass)
            context.render();
        };

        const handlePointerUp = () => {
            // Drag over; cursor tracking continues
            write({ dragLast: null, dragButton: null });
        };

        const handlePointerLeave = () => {
            // Pointer gone: hide cursor readouts + end any drag
            write({ cursor: null, dragLast: null, dragButton: null });
            // Re-render so the coordinate HUD unmounts (null = hidden)
            context.render();
        };

        surface.addEventListener('pointerdown', handlePointerDown);
        surface.addEventListener('pointermove', handlePointerMove);
        surface.addEventListener('pointerup', handlePointerUp);
        surface.addEventListener('pointerleave', handlePointerLeave);

        // Disposer — removes every listener (plugin removal/unmount safety)
        return () => {
            surface.removeEventListener('pointerdown', handlePointerDown);
            surface.removeEventListener('pointermove', handlePointerMove);
            surface.removeEventListener('pointerup', handlePointerUp);
            surface.removeEventListener('pointerleave', handlePointerLeave);
        };
    },
) satisfies DrawPlugin;
