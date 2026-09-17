// ─────────────────────────────────────────────────────────────────────────────
// REMOVABLE feature plugin: DRAG TO PAN — grab-the-paper panning.
//
// BUTTON MAP (updated by the SELECTION contract: "Remove the left click from
// draggable. Allows it to hold and drag to create a selection box." — the
// left-drag pan was REMOVED; the selection marquee owns the left drag,
// cross-reference: selectionPlugin.ts + nodeEditorPlugin.ts):
// - RIGHT-button drag → pan (the dedicated pan gesture — always pans,
//   regardless of tool state; the context menu is suppressed on the canvas
//   so the drag stays clean)
// - Middle-button drag → pan (regardless of tool state)
// - LEFT-button drag → NEVER pans anymore; it belongs to the tool (drawing)
//   when one is armed, to the SELECTION MARQUEE when none is, and to the
//   node editor when the press lands on a shape. Space + left-drag REMAINS
//   the power-user pan override (space+any-button pans).
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
            // An active NODE ADJUSTMENT drag owns the canvas (the node
            // editor grabbed the pointer near a shape handle) — pan yields
            // in every mode while it runs
            if (context.drawing().adjusting) return false;
            // A SELECTION MARQUEE owns a live left-drag — releasing space
            // (or pressing it) mid-box must never hijack the drag into a
            // pan (the box would tear away from its anchor)
            if (context.drawing().marquee) return false;
            // Space held → any button pans (power-user override)
            if (context.keyboard().held.has('Space')) return true;
            // RIGHT button = the dedicated pan drag — always pans
            if (button === 2) return true;
            // MIDDLE button pans
            if (button === 1) return true;
            // LEFT button never pans (the tool / selection marquee / node
            // editor own it by state; the space override above already
            // covered the power-user pan)
            return false;
        };

        // pointerdown fires AFTER the core plugin's listener (registration
        // order: core registered first) — the drag state is already fresh.
        // Used only for pointer capture (keeps the drag alive outside the
        // surface bounds in real browsers).
        const handlePointerDown = (event: PointerEvent) => {
            const state = context.pointer() as DrawPointerState;
            if (!state || state.dragButton === null) return;
            if (!mayPan(state.dragButton)) return;
            // Capture the pointer so the drag continues outside the canvas.
            // Capture onto the SURFACE, not event.target (a transient child
            // target loses capture when React re-renders the grid mid-pan)
            // and failure must never abort — capture is an optimization
            try {
                surface.setPointerCapture?.(event.pointerId);
            } catch {
                // Capture unavailable — the drag still runs in-surface
            }
        };

        // Right-click on the canvas must not open the context menu — the
        // right button IS the pan drag now (suppress on the surface only;
        // HUD elements keep their own menus)
        const handleContextMenu = (event: MouseEvent) => {
            event.preventDefault();
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
        // Browser-cancelled pointer (touchpad gesture takeover etc.): the
        // pointerup never comes — the drag state must unwind or the NEXT
        // pointermove pans without any button held (the stale dragLast
        // would interpret as a new frame delta)
        surface.addEventListener('pointercancel', endDrag);
        surface.addEventListener('contextmenu', handleContextMenu);

        return () => {
            surface.removeEventListener('pointerdown', handlePointerDown);
            surface.removeEventListener('pointermove', handlePointerMove);
            surface.removeEventListener('pointerup', handlePointerUp);
            surface.removeEventListener('pointerleave', endDrag);
            surface.removeEventListener('pointercancel', endDrag);
            surface.removeEventListener('contextmenu', handleContextMenu);
        };
    },
) satisfies DrawPlugin;
