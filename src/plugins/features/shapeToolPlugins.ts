// ─────────────────────────────────────────────────────────────────────────────
// REMOVABLE feature plugin: SHAPE TOOLS — circle, rectangle, line.
//
// Three TOOL plugins in one module (they share the same drag-geometry
// pattern): each registers a DrawToolDefinition into context.tools during
// execution. While active, a left-drag defines the shape:
// - CIRCLE: press = center, current distance = radius (grows from the
//   center under the hand)
// - RECTANGLE: press + current = opposite corners (normalized min/max —
//   drag in any direction)
// - LINE: press = start, current = end
//
// The live geometry is the DRAFT (rendered by the drawing layer as a
// preview); on release the builder (functions/shapes.ts) validates + commits
// (degenerate zero-size drags are discarded).
//
// SHORTCUTS: KeyC (circle), KeyR (rectangle), KeyL (line) — via toolRouter.
// ─────────────────────────────────────────────────────────────────────────────

import { createCircleShape, createRectShape, createLineShape } from '../../functions/shapes';
import type { DrawPoint, DrawShape } from '../../functions/shapes';
import { mountOf } from '../core/DrawPluginRegistry';
import type { DrawPlugin, DrawPluginContext } from '../core';

// Icons (24×24 viewbox paths)
const CIRCLE_ICON = 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z';
const RECT_ICON = 'M4 5h16v14H4z';
const LINE_ICON = 'M4 20L20 4';

// The shared drag-draft writer — sets the draft shape for the current drag
const writeDraft = (context: DrawPluginContext, draft: DrawShape | null) => {
    context.drawing({
        ...(context.drawing() as { shapes: unknown[]; drawing: boolean }),
        draft,
    } as never);
};

// The shared commit — validates the draft through the builder, commits on
// success, clears the draft either way
const commitDraft = (
    context: DrawPluginContext,
    build: () => DrawShape | null,
) => {
    const state = context.drawing() as { shapes: unknown[]; drawing: boolean };
    const shape = build();
    context.drawing({
        ...state,
        shapes: shape ? [...state.shapes, shape] : state.shapes,
        draft: null,
    } as never);
};

// ── CIRCLE TOOL ──
// Press = center; the radius grows to the live pointer distance
export const circleToolPlugin = mountOf(
    (context: DrawPluginContext) => {
        context.tools.register({
            id: 'circle',
            label: 'Circle',
            icon: CIRCLE_ICON,
            shortcut: 'KeyC',
            handlers: {
                onDragStart: (start: DrawPoint) => {
                    // Zero-radius draft (the live preview updates on move)
                    writeDraft(context, { kind: 'circle', center: start, radius: 0 });
                },
                onDragMove: (current: DrawPoint) => {
                    // The router passes the press point as the anchor for
                    // shape tools — but the draft's center IS the anchor, so
                    // read it from the draft (single source of truth)
                    const draft = context.drawing().draft;
                    if (draft?.kind !== 'circle') return;
                    const radius = Math.hypot(current.x - draft.center.x, current.y - draft.center.y);
                    writeDraft(context, { kind: 'circle', center: draft.center, radius });
                },
                onDragEnd: () => {
                    const draft = context.drawing().draft;
                    if (draft?.kind !== 'circle') {
                        writeDraft(context, null);
                        return;
                    }
                    // Commit from the DRAFT (center + latest radius from
                    // onDragMove) — the end cursor equals the last move
                    // point, but the draft already holds the fresh geometry
                    commitDraft(context, () =>
                        draft.radius > 0
                            ? { kind: 'circle', center: draft.center, radius: draft.radius }
                            : null,
                    );
                },
            },
        });
        return null;
    },
    () => undefined,
) satisfies DrawPlugin;

// ── RECTANGLE TOOL ──
// Press + live pointer = opposite corners (normalized)
export const rectangleToolPlugin = mountOf(
    (context: DrawPluginContext) => {
        context.tools.register({
            id: 'rectangle',
            label: 'Rectangle',
            icon: RECT_ICON,
            shortcut: 'KeyR',
            handlers: {
                onDragStart: (start: DrawPoint) => {
                    // Zero-area draft anchored at the press point
                    writeDraft(context, { kind: 'rect', min: start, max: start });
                },
                onDragMove: (current: DrawPoint) => {
                    const draft = context.drawing().draft;
                    if (draft?.kind !== 'rect') return;
                    // Normalize per move (drag in any direction)
                    writeDraft(context, {
                        kind: 'rect',
                        min: { x: Math.min(draft.min.x, current.x), y: Math.min(draft.min.y, current.y) },
                        max: { x: Math.max(draft.min.x, current.x), y: Math.max(draft.min.y, current.y) },
                    });
                },
                onDragEnd: () => {
                    const draft = context.drawing().draft;
                    if (draft?.kind !== 'rect') {
                        writeDraft(context, null);
                        return;
                    }
                    // Commit from the DRAFT's normalized corners — NOT from
                    // the end cursor: after an up-left drag the cursor equals
                    // draft.min, and pairing min with itself would be a
                    // zero-area discard. draft.max already holds the latest
                    // opposite corner from onDragMove.
                    commitDraft(context, () => createRectShape(draft.min, draft.max));
                },
            },
        });
        return null;
    },
    () => undefined,
) satisfies DrawPlugin;

// ── LINE TOOL ──
// Press = start, live pointer = end
export const lineToolPlugin = mountOf(
    (context: DrawPluginContext) => {
        context.tools.register({
            id: 'line',
            label: 'Line',
            icon: LINE_ICON,
            shortcut: 'KeyL',
            handlers: {
                onDragStart: (start: DrawPoint) => {
                    // Zero-length draft anchored at the press point
                    writeDraft(context, { kind: 'line', start, end: start });
                },
                onDragMove: (current: DrawPoint) => {
                    const draft = context.drawing().draft;
                    if (draft?.kind !== 'line') return;
                    writeDraft(context, { kind: 'line', start: draft.start, end: current });
                },
                onDragEnd: () => {
                    const draft = context.drawing().draft;
                    if (draft?.kind !== 'line') {
                        writeDraft(context, null);
                        return;
                    }
                    // Commit from the DRAFT (start + latest end from
                    // onDragMove) — the end cursor may lack coordinates
                    commitDraft(context, () => createLineShape(draft.start, draft.end));
                },
            },
        });
        return null;
    },
    () => undefined,
) satisfies DrawPlugin;
