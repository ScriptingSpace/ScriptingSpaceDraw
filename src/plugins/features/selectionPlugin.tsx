// ─────────────────────────────────────────────────────────────────────────────
// REMOVABLE feature plugin: SELECTION — the left-drag rubber-band (marquee)
// + the selection highlight overlay.
//
// USER CONTRACT ("Remove the left click from draggable. Allows it to hold
// and drag to create a selection box. This allows the user to select
// multiple items by create a selection box across multiple shape. Jointed
// shapes are selected together."):
//
// - THE CANVAS DRAG IS NOW A SELECTION, NOT A PAN: a plain LEFT press+drag
//   on empty canvas (no tool armed, no space) runs the marquee — the
//   left-drag pan was REMOVED from dragToPan (cross-reference:
//   dragToPanPlugin.ts: left pans only via the space override now; right /
//   middle-drag keep panning).
// - LIVE BOX: every move writes drawing.marquee (world-space start +
//   current) → the host re-renders → this plugin draws the dashed box at
//   the box's projected screen position.
// - RELEASE: every shape whose bounding box touches the box joins the
//   selection, expanded transitively through the endpoint-bond graph —
//   "jointed shapes are selected together" (cross-reference:
//   functions/selection.ts selectShapesInBounds). A drag that never crossed
//   half a grid cell counts as a bare CLICK on empty canvas → the selection
//   CLEARS (all shape-body presses were claimed by nodeEditor's grab — a
//   press reaching this gesture's release landed on empty space).
// - SELECTION MARKERS: each selected shape gets an accent outline of its
//   bounds (drawn per pass from the LIVE geometry — markers follow the
//   shapes through pan/zoom/moves).
// - MULTI-MOVE: nodeEditorPlugin reads drawing.selection — grabbing a
//   selected shape translates EVERY selected shape by the same snapped
//   delta (bond groups ride along; grabbing an unselected shape re-skims
//   the selection to that shape's bond group).
//
// GESTURE ARBITRATION (registration order = listener order, see
// DrawDashboard.registerDefaultPlugins): this plugin registers AFTER the
// node editor and the tool router, so:
// - a press ON a shape/node was already claimed by nodeEditor
//   (stopImmediatePropagation) → no marquee on grabs;
// - a press with a TOOL armed draws (this plugin ignores left presses while
//   activeTool ≠ null);
// - a press inside a `[data-hud]` subtree never marquees (the HUD gate —
//   same check the router/pointer core use);
// - SPACE held = the power-user pan override → no marquee (space+left
//   pans via dragToPan).
// The marquee CLAIMS its press (stopImmediatePropagation) so nothing
// downstream mistakes the box drag for anything else, and sets pointer
// capture on the SURFACE so the drag keeps running outside the canvas.
//
// REMOVABLE: removing it removes the marquee gesture + the selection
// markers; shapes stay intact and the other gestures keep working.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { canvasToScreen, gridSteps, screenToCanvas } from '../../functions/canvasTransform';
import {
    marqueeBounds,
    selectShapesInBounds,
    shapeBounds,
} from '../../functions/selection';
import type { DrawBounds } from '../../functions/selection';
import { mountOf } from '../core/DrawPluginRegistry';
import type { DrawPlugin, DrawPluginContext } from '../core';

// The overlay svg — above the drawing layer + the node handles (the handles
// carry zIndex 6; this sits at 7), invisible to events (all gesture logic
// lives on the surface listeners below).
const SelectionSvg = (props: React.SVGAttributes<SVGSVGElement>): React.ReactElement => (
    <svg
        width="100%"
        height="100%"
        style={{
            display: 'block',
            position: 'absolute',
            top: 0,
            left: 0,
            zIndex: 7,
            pointerEvents: 'none',
        }}
        data-testid="selection-overlay"
        {...props}
    />
);

// The plugin function — renders the marquee box + selection markers on every
// execution pass (world geometry projected per pass — markers follow the
// shapes through pan/zoom/moves).
export const selectionPlugin = mountOf(
    (context: DrawPluginContext) => {
        const transform = context.transform();
        // No transform yet (pre-seed) or nothing to show → render nothing
        if (!transform) return null;
        const drawing = context.drawing();
        const shapes = drawing?.shapes ?? [];
        const selection = drawing?.selection ?? [];
        const marquee = drawing?.marquee ?? null;
        if (selection.length === 0 && !marquee) return null;
        const { width, height } = context.viewport();
        if (width <= 0 || height <= 0) return null;

        // Selected shapes' screen-space bounding boxes (live geometry —
        // stale indices pointing past the shapes array are skipped)
        const markers: { index: number; box: DrawBounds }[] = [];
        for (const index of selection) {
            const shape = shapes[index];
            if (!shape) continue;
            markers.push({ index, box: shapeBounds(shape) });
        }

        return (
            <SelectionSvg>
                {/* One accent outline per selected shape (bounds markers) */}
                {markers.map(({ index, box }) => {
                    const min = canvasToScreen(box.min, transform);
                    const max = canvasToScreen(box.max, transform);
                    return (
                        <rect
                            key={`marker-${index}`}
                            data-testid={`selection-marker-${index}`}
                            x={min.x}
                            y={min.y}
                            width={max.x - min.x}
                            height={max.y - min.y}
                            fill="none"
                            stroke={context.palette.accent}
                            strokeWidth={1.5}
                            opacity={0.9}
                            pointerEvents="none"
                        />
                    );
                })}
                {/* The live rubber-band box (dashed accent, same projection) */}
                {marquee ? (
                    (() => {
                        const box = marqueeBounds(marquee.start, marquee.current);
                        const min = canvasToScreen(box.min, transform);
                        const max = canvasToScreen(box.max, transform);
                        return (
                            <rect
                                data-testid="marquee-box"
                                x={min.x}
                                y={min.y}
                                width={max.x - min.x}
                                height={max.y - min.y}
                                fill="none"
                                stroke={context.palette.accent}
                                strokeWidth={1.5}
                                strokeDasharray="4 3"
                                pointerEvents="none"
                            />
                        );
                    })()
                ) : null}
            </SelectionSvg>
        );
    },
    // ── The marquee gesture (mount slot) ──
    (surface: HTMLDivElement, context: DrawPluginContext) => {
        // Viewport-relative screen point from a raw event (lazy rect read —
        // test stubs stay correct; same contract as the core plugins)
        const toScreen = (
            event: { clientX: number; clientY: number },
        ): { x: number; y: number } => {
            const rect = surface.getBoundingClientRect();
            return { x: event.clientX - rect.left, y: event.clientY - rect.top };
        };

        // Screen point → world point (the shapes' coordinate space — the
        // LIVE transform per event, like every other gesture)
        const toWorld = (screen: { x: number; y: number }) =>
            screenToCanvas(screen, context.transform());

        // Whether THIS press may begin a marquee drag — the gesture policy
        // (the contract table in the header)
        const mayMarquee = (event: PointerEvent): boolean => {
            // Only the left button marquees (right/middle stay pan gestures)
            if (event.button !== 0) return false;
            // SPACE = the pan override (space+left pans, never marquees)
            if (context.keyboard().held.has('Space')) return false;
            // A tool owns the left button while armed (drawing drag)
            if (context.activeTool() !== null) return false;
            // Never fight in-flight gestures (drawing drag / grab-move /
            // node adjustment / an existing marquee)
            const state = context.drawing();
            if (state.drawing || state.adjusting) return false;
            if (state.marquee) return false;
            // HUD subtrees keep their own press behavior (toolbar buttons…)
            // — the target gate (the pointer core plugin uses the same one)
            const target = event.target as HTMLElement | null;
            if (target?.closest?.('[data-hud]')) return false;
            return true;
        };

        const handlePointerDown = (event: PointerEvent) => {
            if (!mayMarquee(event)) return;
            const start = toWorld(toScreen(event));
            // Claim the press: nothing registered after this plugin may
            // reinterpret the drag (the node editor + router ran FIRST —
            // registration order — and declined on empty canvas)
            event.stopImmediatePropagation();
            context.drawing({
                ...context.drawing(),
                marquee: { start, current: start },
            });
            // Capture onto the SURFACE (transient child targets lose capture
            // on React re-renders); guarded — a throw must never abort the
            // marquee bookkeeping
            try {
                surface.setPointerCapture?.(event.pointerId);
            } catch {
                // Capture unavailable — the drag still runs in-surface
            }
        };

        const handlePointerMove = (event: PointerEvent) => {
            const state = context.drawing();
            if (!state?.marquee) return;
            const current = toWorld(toScreen(event));
            // Same point → skip the write (no render churn)
            if (
                state.marquee.current.x === current.x &&
                state.marquee.current.y === current.y
            ) {
                return;
            }
            context.drawing({
                ...state,
                marquee: { ...state.marquee, current },
            });
        };

        // The release rule: bounds picks + transitive bond expansion.
        // A zero-step box (the drag never crossed half a cell) is a bare
        // click on empty canvas → CLEAR the selection (deselect-all).
        const finalize = () => {
            const state = context.drawing();
            if (!state?.marquee) return;
            const box = marqueeBounds(state.marquee.start, state.marquee.current);
            const clicked =
                gridSteps(box.max.x - box.min.x, box.max.y - box.min.y) === 0;
            const selection = clicked
                ? [] // bare click on empty space → deselect everything
                : selectShapesInBounds(state.shapes, state.connections ?? [], box);
            context.drawing({ ...state, marquee: null, selection });
        };

        // Silent unwind (pointer left / browser-cancelled): kill the live
        // box, PRESERVE the selection (an interrupted drag must not change
        // what the user already had)
        const unwind = () => {
            const state = context.drawing();
            if (state?.marquee) {
                context.drawing({ ...state, marquee: null });
            }
        };

        surface.addEventListener('pointerdown', handlePointerDown);
        surface.addEventListener('pointermove', handlePointerMove);
        surface.addEventListener('pointerup', finalize);
        surface.addEventListener('pointerleave', unwind);
        // Browser-cancelled pointer (touchpad gesture takeover etc.): the
        // pointerup never comes — unwind or the half-drawn box latches and
        // blocks every later marquee
        surface.addEventListener('pointercancel', unwind);

        return () => {
            surface.removeEventListener('pointerdown', handlePointerDown);
            surface.removeEventListener('pointermove', handlePointerMove);
            surface.removeEventListener('pointerup', finalize);
            surface.removeEventListener('pointerleave', unwind);
            surface.removeEventListener('pointercancel', unwind);
        };
    },
) satisfies DrawPlugin;
