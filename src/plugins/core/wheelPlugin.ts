// ─────────────────────────────────────────────────────────────────────────────
// Core plugin: WHEEL — raw wheel input normalization.
//
// NON-REMOVABLE (fundamental building block): the wheel is the ONLY zoom
// input and (with deltaX) a primary pan input. The dashboard's "infinite
// magnification both ways" contract cannot exist without it. Like the
// pointer plugin, this does NOT decide what the input means beyond
// normalization — it writes normalized deltas into the context:
//   - `wheel.zoomFactor`: the normalized multiplicative zoom factor for
//     deltaY (normalizeWheelFactor — sub-notch fractional accumulation,
//     ±3 notch clamp; cross-reference: functions/canvasTransform.ts)
//   - `wheel.panX`: the horizontal delta in pixels (line-mode normalized
//     to ~100px per line, deltaMode 1 → ×100)
//
// GESTURE SPLIT (the contract from the old monolithic dashboard):
// - deltaX NEVER zooms — it feeds horizontal pan only.
// - deltaY NEVER pans — it feeds zoom only. A pure horizontal event has
//   deltaY === 0 → zoomFactor 1 → a no-op, so diagonal trackpad scrolls
//   compose cleanly.
//
// PASSIVE LISTENER: React attaches wheel as passive — preventDefault would
// warn and fail. This plugin attaches its listener manually with
// { passive: false } to block browser zoom/scroll and own the gesture.
//
// WHAT THIS PLUGIN DOES NOT DO: apply the deltas to the transform. That is
// the removable gesture plugins' job (zoomOnWheelPlugin / panOnWheelPlugin)
// — keeping interpretation separate from input lets users swap gesture
// mappings without touching the input substrate.
// ─────────────────────────────────────────────────────────────────────────────

import { normalizeWheelFactor } from '../../functions/canvasTransform';
import { mountOf } from '../core/DrawPluginRegistry';
import type { DrawPlugin, DrawPluginContext } from '../core';
import type { DrawWheelState } from '../core/DrawPluginContext';

// Default wheel state — exported so tests / the host can seed the handle
export const createWheelState = (): DrawWheelState => ({
    zoomFactor: 1,
    panX: 0,
    sequence: 0,
});

// The plugin function — renders nothing; all work is in the mount slot.
export const wheelPlugin = mountOf(
    // Execution: ensure the wheel state object exists
    (context: DrawPluginContext) => {
        if (!context.wheel()) {
            context.wheel(createWheelState());
        }
        return null;
    },
    // Mount: attach the non-passive wheel listener to the canvas surface
    (surface: HTMLDivElement, context: DrawPluginContext) => {
        const handleWheel = (event: WheelEvent) => {
            // Own the gesture: block browser zoom/scroll
            event.preventDefault();
            // Viewport-relative pointer point (lazy rect read — same
            // contract as the pointer plugin)
            const rect = surface.getBoundingClientRect();
            const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
            // Normalize deltas into the wheel state (read-modify-write; the
            // handle is ref-backed — no re-render, gesture plugins react on
            // the event itself)
            const previous = context.wheel() as DrawWheelState;
            context.wheel({
                // Line-mode (deltaMode 1) → ~100px per line, matching the
                // NOTCH_PIXELS convention in normalizeWheelFactor
                zoomFactor: normalizeWheelFactor(event.deltaY),
                panX: event.deltaMode === 1 ? event.deltaX * 100 : event.deltaX,
                sequence: previous.sequence + 1,
            });
            // Store the event's pointer point for zoom-at-pointer plugins
            // (they need WHERE the wheel happened, not just how much)
            context.wheelPoint(point);
        };
        surface.addEventListener('wheel', handleWheel, { passive: false });
        return () => surface.removeEventListener('wheel', handleWheel);
    },
) satisfies DrawPlugin;
