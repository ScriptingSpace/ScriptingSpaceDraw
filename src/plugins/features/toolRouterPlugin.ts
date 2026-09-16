// ─────────────────────────────────────────────────────────────────────────────
// REMOVABLE feature plugin: TOOL ROUTER — routes pointer events to the
// active tool.
//
// This is the bridge between the core input plugins and the tool plugins:
// - The pointer core plugin tracks raw drag state (dragLast/dragButton)
// - The keyboard core plugin tracks held keys
// - THIS plugin watches the drag lifecycle and forwards the phases to the
//   ACTIVE tool's handlers (from context.tools), converting screen points
//   to world coordinates with screenToCanvas.
//
// BUTTON MAP (user contract: "Left are for tool usage unless no tool is
// selected"): ONLY the left button draws, and only when a tool is active.
// Right-drag pans (the dedicated pan gesture — cross-reference:
// dragToPanPlugin), middle-drag pans, space+drag pans.
//
// PHASE MAPPING (driven by the pointer state written by the core plugin):
// - pointerdown (drag starts, dragButton set) → tool.onDragStart(worldPoint)
// - pointermove (drawing === true)             → tool.onDragMove(current)
// - pointerup (drawing ends)                   → tool.onDragEnd(lastCursor)
//
// The router owns the `drawing` flag in the drawing state: it flips it on
// at drag start and off at drag end. The dragToPanPlugin reads the ACTIVE
// TOOL (not this flag) to yield left-drag to the tool.
//
// TOOL SHORTCUTS: tools can declare a keyboard `shortcut` (event.code). The
// router listens for keydown on window and activates the matching tool —
// the same toggle contract as the toolbar buttons (pressing the active
// tool's shortcut deactivates it).
// ─────────────────────────────────────────────────────────────────────────────

import { screenToCanvas } from '../../functions/canvasTransform';
import { mountOf } from '../core/DrawPluginRegistry';
import type { DrawPlugin, DrawPluginContext, DrawPointerState } from '../core';

// The plugin function — renders nothing; all work is in the mount slot.
export const toolRouterPlugin = mountOf(
    // Execution: nothing per-render — routing is event-driven
    () => null,
    // Mount: attach pointer + keyboard listeners that route to the active tool
    (surface: HTMLDivElement, context: DrawPluginContext) => {
        // Viewport-relative → world point (lazy rect read — the same
        // contract as the core input plugins)
        const toWorld = (event: { clientX: number; clientY: number }) => {
            const rect = surface.getBoundingClientRect();
            const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
            return screenToCanvas(screen, context.transform());
        };

        // Already-viewport-relative point → world (used for the pointerup
        // cursor, which the pointer core plugin tracks in SCREEN space)
        const screenToWorld = (screen: { x: number; y: number }) =>
            screenToCanvas(screen, context.transform());

        // The active tool's definition (or undefined when no tool is active)
        const activeTool = () => {
            const id = context.activeTool();
            if (!id) return undefined;
            return context.tools.get(id);
        };

        // ── Pointer phase routing ──
        // pointerdown: the pointer core plugin has already recorded the
        // drag (registration order: core first). If a tool is active AND
        // the press can draw (left button, not on the HUD, no pan override),
        // begin the tool's drag.
        const handlePointerDown = (event: PointerEvent) => {
            const tool = activeTool();
            if (!tool) return;
            // ONLY the left button draws (right = pan, middle = pan)
            if (event.button !== 0) return;
            // SPACE = the pan override (cross-reference: dragToPanPlugin's
            // mayPan policy): space+drag must pan even with a tool active,
            // so the router never starts a drawing drag while space is held
            if (context.keyboard().held.has('Space')) return;
            // A NODE ADJUSTMENT drag owns the pointer (nodeEditorPlugin
            // grabbed a shape handle and already swallowed this press —
            // this guard is the belt for any plugin registered BEFORE the
            // editor): never start a drawing drag while it runs
            if (context.drawing().adjusting) return;
            // Presses on HUD subtrees never draw (toolbar buttons etc.)
            const target = event.target as HTMLElement | null;
            if (target?.closest?.('[data-hud]')) return;
            const world = toWorld(event);
            // Mark the drawing drag active (dragToPanPlugin yields left-drag)
            const drawingState = context.drawing();
            context.drawing({ ...drawingState, drawing: true });
            // Capture the pointer so the tool drag continues outside the
            // canvas bounds (mirrors the pan gesture's capture). Capture
            // onto the SURFACE, not event.target: the press can land on a
            // transient child (svg line/HUD fragment) that React replaces
            // mid-gesture — a capture on a removed element evaporates and
            // the drag dies with the pointer outside the canvas. Guarded:
            // a capture throw must never abort the drag bookkeeping (the
            // `drawing` flag above would latch).
            try {
                surface.setPointerCapture?.(event.pointerId);
            } catch {
                // Capture unavailable — the drag still runs in-surface
            }
            tool.handlers.onDragStart?.(world);
        };

        const handlePointerMove = (event: PointerEvent) => {
            const tool = activeTool();
            if (!tool) return;
            const state = context.drawing();
            // Only forward moves while a drawing drag is in progress
            if (!state.drawing) return;
            const world = toWorld(event);
            // The router passes the current pointer world point; each tool
            // tracks its own anchor (shape tools read their draft's center /
            // start corner — the geometry lives in functions/shapes.ts)
            tool.handlers.onDragMove?.(world);
        };

        const handlePointerUp = () => {
            const tool = activeTool();
            const state = context.drawing();
            // Only end when a drawing drag was in progress
            if (!state.drawing) return;
            // The end point comes from the POINTER STATE's tracked cursor —
            // NOT the event coords. pointerup events can lack coordinates
            // (jsdom fires them with clientX/Y 0; real browsers may too on
            // capture-less releases), and the pointer core plugin already
            // tracks the live cursor on every move — that is the reliable
            // last-known position.
            const cursor = context.pointer().cursor;
            // Flip the flag FIRST — the drag is over regardless of what the
            // tool does with the end event
            context.drawing({ ...state, drawing: false });
            if (!tool) return;
            // Convert the SCREEN-space cursor to world coordinates (the
            // tool contract: all handler points are world-space)
            tool.handlers.onDragEnd?.(cursor ? screenToWorld(cursor) : { x: 0, y: 0 });
        };

        // Safety net: if the pointer leaves the surface mid-draw (the
        // pointerup may land on another element), end the drawing drag with
        // the last tracked cursor so the draft is committed, not orphaned.
        // The pointer core plugin clears the cursor on leave — a null cursor
        // ends the drag WITHOUT calling the tool's end handler (no geometry
        // to commit to).
        const handlePointerLeave = () => {
            const state = context.drawing();
            if (!state.drawing) return;
            context.drawing({ ...state, drawing: false, draft: null });
        };

        // Browser-cancelled pointer (touchpad gesture takeover etc.): the
        // pointerup never comes — unwind the SAME way as a leave or the
        // `drawing` flag + half-drawn draft latch and every later press is
        // refused (the gesture-gate read in handlePointerDown)
        const handlePointerCancel = () => {
            const state = context.drawing();
            if (!state.drawing) return;
            context.drawing({ ...state, drawing: false, draft: null });
            // Also release the pointer capture this drag holds (paired with
            // setPointerCapture — a cancelled pointer's capture releases
            // implicitly, so this is belt for captures taken elsewhere)
        };

        surface.addEventListener('pointerdown', handlePointerDown);
        surface.addEventListener('pointermove', handlePointerMove);
        surface.addEventListener('pointerup', handlePointerUp);
        surface.addEventListener('pointerleave', handlePointerLeave);
        surface.addEventListener('pointercancel', handlePointerCancel);

        // ── Tool shortcuts ──
        // keydown on window: activate the tool whose shortcut matches
        // (toggle — pressing the active tool's shortcut deactivates it)
        const handleKeyDown = (event: KeyboardEvent) => {
            const tools = context.tools.list();
            const match = tools.find((tool) => tool.shortcut === event.code);
            if (!match) return;
            context.activeTool(context.activeTool() === match.id ? null : match.id);
        };
        window.addEventListener('keydown', handleKeyDown);

        return () => {
            surface.removeEventListener('pointerdown', handlePointerDown);
            surface.removeEventListener('pointermove', handlePointerMove);
            surface.removeEventListener('pointerup', handlePointerUp);
            surface.removeEventListener('pointerleave', handlePointerLeave);
            surface.removeEventListener('pointercancel', handlePointerCancel);
            window.removeEventListener('keydown', handleKeyDown);
        };
    },
) satisfies DrawPlugin;
