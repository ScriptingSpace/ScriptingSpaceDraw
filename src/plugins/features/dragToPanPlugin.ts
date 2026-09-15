// ─────────────────────────────────────────────────────────────────────────────
// REMOVABLE feature plugin: DRAG TO PAN — grab-the-paper panning.
//
// Consumes the pointer core plugin's drag state (dragLast/dragButton) and
// the keyboard core plugin's held-key set to implement the pan gestures:
// - Plain left-drag on empty canvas → pan (the "drag anywhere to look
//   around" default) — ONLY when no tool is active (a tool owns left-drag
//   for drawing; cross-reference: toolRouterPlugin)
// - Space held + any-button drag → pan (power users)
// - Middle-button drag → pan
// - Right-button drag without space → NOT a pan (context menu stays
//   available)
// - Drag starting inside a `[data-hud]` subtree → belongs to the HUD (the
//   pointer plugin never records a drag there — cross-reference:
//   core/pointerPlugin.ts)
//
// HOW THE WIRING WORKS: the pointer core plugin tracks raw state; this
// plugin mounts ONE additional pointermove listener that — while a drag is
// active — computes the frame delta from dragLast, applies it to the
// transform via applyPan, and updates dragLast. Press/release bookkeeping
// stays in the core plugin; this plugin only interprets.
//
// The transform writes drive re-renders (the HUDs + grid re-execute each
// pass with the fresh transform — the plugin host model).
//
// REMOVABLE: removing it disables drag panning; wheel pan/zoom still work.
// ─────────────────────────────────────────────────────────────────────────────

import { applyPan } from '../../functions/canvasTransform';
import { mountOf } from '../core/DrawPluginRegistry';
import type { DrawPlugin, DrawPluginContext, DrawPointerState } from '../core';

// The plugin function — renders nothing; all work is in the mount slot.
export const dragToPanPlugin = mountOf(
    // Execution: nothing per-render — the gesture is event-driven
    () => null,
    // Mount: attach the pointermove interpreter + capture on pointerdown
    (surface: HTMLDivElement, context: DrawPluginContext) => {
        // Whether a drag may pan for the given button + keyboard state —
        // the gesture policy (the contract table in the header)
        const mayPan = (button: number | null): boolean => {
            if (button === null) return false;
            // Space held → any button pans (power-user override)
            if (context.keyboard().held.has('Space')) return true;
            // A TOOL OWNS THE LEFT DRAG while it is active: when a tool is
            // selected (and it draws with left-drag), left-drag means DRAW,
            // not pan. Middle-drag still pans (the tool only claims left).
            const toolActive = context.activeTool() !== null;
            if (toolActive && button === 0) return false;
            // Plain left-drag (the default look-around) or middle-drag
            return button === 0 || button === 1;
        };

        // pointerdown fires AFTER the core plugin's listener (registration
        // order: core registered first) — the drag state is already fresh.
        // Used only for pointer capture (keeps the drag alive outside the
        // surface bounds in real browsers).
        const handlePointerDown = (event: PointerEvent) => {
            const state = context.pointer() as DrawPointerState;
            if (!state || state.dragButton === null) return;
            if (!mayPan(state.dragButton)) return;
            // Never capture the pointer when a tool owns the drag (the tool
            // router drives the drawing; capture is pan-only)
            if (context.activeTool() !== null && state.dragButton === 0) return;
            // Capture the pointer so the drag continues outside the canvas
            (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
        };

        const handlePointerMove = (event: PointerEvent) => {
            const state = context.pointer() as DrawPointerState;
            if (!state) return;
            // No active drag → nothing to interpret (the core plugin
            // already tracked the cursor for the coordinate HUD)
            if (state.dragLast === null || state.dragButton === null) return;
            // Re-validate the gesture policy per move: releasing space
            // mid-drag with a right-button drag must stop panning
            if (!mayPan(state.dragButton)) return;
            // Viewport-relative current point (lazy rect read — same
            // contract as the core plugins)
            const rect = surface.getBoundingClientRect();
            const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
            // Frame delta from the last interpreted point
            const dx = point.x - state.dragLast.x;
            const dy = point.y - state.dragLast.y;
            // Grab-the-paper: pan by the pointer delta (applyPan divides by
            // scale for zoom-compensated visual speed). Read-then-write —
            // the useStateHook setter takes a VALUE (cross-reference:
            // packages/presource/react/src/hooks/local/state.ts).
            context.transform(applyPan(context.transform(), dx, dy));
            // Advance the drag anchor
            context.pointer({ ...state, dragLast: point });
        };

        const endDrag = () => {
            // Release pointer capture if we hold it (defensive — the core
            // plugin already cleared the drag state on pointerup/leave)
            const state = context.pointer() as DrawPointerState;
            if (state?.dragLast) {
                context.pointer({ ...state, dragLast: null, dragButton: null });
            }
        };

        const handlePointerUp = () => endDrag();

        surface.addEventListener('pointerdown', handlePointerDown);
        surface.addEventListener('pointermove', handlePointerMove);
        surface.addEventListener('pointerup', handlePointerUp);
        // pointerleave also ends the drag (the core plugin clears state on
        // leave; this keeps the interpreter consistent)
        surface.addEventListener('pointerleave', endDrag);

        return () => {
            surface.removeEventListener('pointerdown', handlePointerDown);
            surface.removeEventListener('pointermove', handlePointerMove);
            surface.removeEventListener('pointerup', handlePointerUp);
            surface.removeEventListener('pointerleave', endDrag);
        };
    },
) satisfies DrawPlugin;
