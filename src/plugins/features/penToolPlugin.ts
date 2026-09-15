// ─────────────────────────────────────────────────────────────────────────────
// REMOVABLE feature plugin: PEN TOOL — freehand drawing.
//
// A TOOL plugin: registers a DrawToolDefinition into context.tools during
// execution. The toolbar renders its button; the toolRouter routes pointer
// phases to its handlers. The tool itself attaches NO listeners.
//
// BEHAVIOR: while active, a left-drag captures a polyline of WORLD points
// (one per pointermove — the pen follows the hand at event resolution). The
// live polyline is the DRAFT (rendered by the drawing layer as a preview);
// on release the stroke is committed to the shapes list. A click without a
// drag (fewer than 2 points) discards — a dot is not a stroke.
//
// SHORTCUT: 'KeyP' toggles the pen (the toolRouter listens).
// ─────────────────────────────────────────────────────────────────────────────

import { createPathShape } from '../../functions/shapes';
import type { DrawPoint } from '../../functions/shapes';
import { mountOf } from '../core/DrawPluginRegistry';
import type { DrawPlugin, DrawPluginContext } from '../core';

// Pen icon — a classic nib-ish pen path (24×24 viewbox)
const PEN_ICON = 'M12 19l7-7 3 3-7 7-3-3z M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z M2 2l7.586 7.586';

// The plugin function — registers the pen tool on every execution.
export const penToolPlugin = mountOf(
    (context: DrawPluginContext) => {
        // Registration is idempotent (duplicate ids rejected) — re-execution
        // on every render pass keeps the registration alive harmlessly
        context.tools.register({
            id: 'pen',
            label: 'Pen',
            icon: PEN_ICON,
            shortcut: 'KeyP',
            handlers: {
                // Drag start: begin an empty draft polyline anchored at the
                // press point
                onDragStart: (start: DrawPoint) => {
                    context.drawing({
                        ...(context.drawing() as { shapes: unknown[]; drawing: boolean }),
                        draft: { kind: 'path', points: [start] },
                    } as never);
                },
                // Drag move: append the live point to the draft polyline
                onDragMove: (current: DrawPoint) => {
                    const state = context.drawing() as {
                        draft: { kind: 'path'; points: DrawPoint[] } | null;
                    };
                    // Guard: a move without a draft (missed start) starts one
                    const points = state.draft?.kind === 'path' ? state.draft.points : [];
                    context.drawing({
                        ...(context.drawing() as { shapes: unknown[]; drawing: boolean }),
                        draft: { kind: 'path', points: [...points, current] },
                    } as never);
                },
                // Drag end: commit the polyline (≥ 2 points) to the shapes
                // list; discard degenerate strokes
                onDragEnd: () => {
                    const state = context.drawing() as {
                        shapes: unknown[];
                        draft: { kind: 'path'; points: DrawPoint[] } | null;
                    };
                    const draft = state.draft;
                    const shape =
                        draft?.kind === 'path' ? createPathShape(draft.points) : null;
                    context.drawing({
                        // Commit (or drop) the draft; clear the draft either way
                        ...(context.drawing() as { shapes: unknown[]; drawing: boolean }),
                        shapes: shape ? [...state.shapes, shape] : state.shapes,
                        draft: null,
                    } as never);
                },
            },
        });
        // The tool renders nothing itself (the toolbar + drawing layer do)
        return null;
    },
    // Mount slot: nothing to wire — the router owns the event stream
    () => undefined,
) satisfies DrawPlugin;
