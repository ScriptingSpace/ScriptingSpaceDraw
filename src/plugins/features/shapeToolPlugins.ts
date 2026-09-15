// ─────────────────────────────────────────────────────────────────────────────
// REMOVABLE feature plugin: SHAPE TOOLS — circle, rectangle, line (curve).
//
// Three TOOL plugins in one module (they share the same drag-geometry
// pattern): each registers a DrawToolDefinition into context.tools during
// execution. While active, a left-drag defines the shape:
// - CIRCLE: press = center, current distance = radius (grows from the
//   center under the hand)
// - RECTANGLE: press + current = opposite corners (normalized min/max —
//   drag in any direction)
// - LINE: press = start, current = end — but "more like curve": the shape
//   is a quadratic Bézier (see functions/shapes.ts createCurveShape). A
//   chord across a single grid step stays straight; a chord across
//   MULTIPLE grid points is bowed by the default control node — "gets
//   curve instead of sharp". The curve's control node stays adjustable
//   afterwards (cross-reference: nodeEditorPlugin.tsx).
//
// GRID CONTRACT (user: "This isn't free form, it is according the grid. All
// Circle, Rectangle and Lines must snapped to the grid points."): every
// drag point is snapped through the builders (snapToGrid inside
// functions/shapes.ts) — anchors land on grid intersections, circle radii
// quantize to grid steps, rect corners lock to the lattice. NO freehand
// path shape exists in this dashboard.
//
// The live geometry is the DRAFT (rendered by the drawing layer as a
// preview); on release the builder validates + commits (drags that never
// cross a grid half-cell are discarded).
//
// STROKE COLOR (cross-reference: colorPalettePlugin.tsx): writeDraft stamps
// the ACTIVE ink (context.drawing().color — the swatch selected in the
// right-side palette) onto every draft; the committed shape keeps its
// creation-time color. The builders are pure geometry — they drop metadata,
// so commitDraft re-stamps from the draft after building.
//
// SHORTCUTS: KeyC (circle), KeyR (rectangle), KeyL (line/curve) — via
// toolRouter.
// ─────────────────────────────────────────────────────────────────────────────

import {
    createCircleShape,
    createCurveShape,
    createRectShape,
    quantizeRadius,
    snapToGrid,
} from '../../functions/shapes';
import type { DrawPoint, DrawShape } from '../../functions/shapes';
import { mountOf } from '../core/DrawPluginRegistry';
import type { DrawPlugin, DrawPluginContext } from '../core';

// Icons (24×24 viewbox paths)
const CIRCLE_ICON = 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z';
const RECT_ICON = 'M4 5h16v14H4z';
// Line icon — a bent segment (the tool draws a quadratic curve, not a
// rigid straight line)
const CURVE_ICON = 'M4 19Q12 3 20 19';

// The shared drag-draft writer — sets the draft shape for the current drag,
// STAMPED with the active ink (context.drawing().color). Raw geometry in,
// inked draft out — null passes through untouched (draft-cancel writes).
const writeDraft = (context: DrawPluginContext, draft: DrawShape | null) => {
    const state = context.drawing() as {
        shapes: unknown[];
        drawing: boolean;
        color?: string;
    };
    context.drawing({
        ...(context.drawing() as { shapes: unknown[]; drawing: boolean }),
        draft: draft
            ? ({ ...draft, ...(state.color ? { color: state.color } : {}) } as DrawShape)
            : null,
    } as never);
};

// The shared commit — validates the draft through the builder, commits on
// success, clears the draft either way. The BUILT shape is re-stamped with
// the draft's ink: the builders re-project geometry (snapping, min/max
// normalization) and carry no metadata across.
const commitDraft = (
    context: DrawPluginContext,
    build: () => DrawShape | null,
) => {
    const state = context.drawing() as {
        shapes: unknown[];
        drawing: boolean;
        draft: DrawShape | null;
    };
    const shape = build();
    // Stamp the CREATION-TIME ink from the draft onto the built shape
    const stamped =
        shape && state.draft?.color ? ({ ...shape, color: state.draft.color } as DrawShape) : shape;
    context.drawing({
        ...state,
        shapes: stamped ? [...state.shapes, stamped] : state.shapes,
        draft: null,
    } as never);
};

// ── CIRCLE TOOL ──
// Press = center (snaps to the grid); the radius quantizes to whole grid
// steps so the circle's cardinal points sit on grid points.
export const circleToolPlugin = mountOf(
    (context: DrawPluginContext) => {
        // The pressed anchor for the CURRENT drag (closure state — the tool
        // registry keeps the FIRST registered closure alive; reset on every
        // drag start; null = no drag running)
        let press: DrawPoint | null = null;
        context.tools.register({
            id: 'circle',
            label: 'Circle',
            icon: CIRCLE_ICON,
            shortcut: 'KeyC',
            handlers: {
                onDragStart: (start: DrawPoint) => {
                    press = snapToGrid(start);
                    // Zero-radius draft anchored at the SNAPPED center — the
                    // center is grid-locked for the entire drag
                    writeDraft(context, { kind: 'circle', center: press, radius: 0 });
                },
                onDragMove: (current: DrawPoint) => {
                    const center = press ?? snapToGrid(current);
                    // The pressed center stays the anchor (single source of
                    // truth); the radius quantizes to grid steps
                    const radius = quantizeRadius(
                        Math.hypot(current.x - center.x, current.y - center.y),
                    );
                    writeDraft(context, { kind: 'circle', center, radius });
                },
                onDragEnd: (end: DrawPoint) => {
                    const center = press ?? snapToGrid(end);
                    press = null;
                    // Commit the exact end geometry — the router passes the
                    // last tracked cursor (reliable: pointerup events can
                    // lack coordinates). A quantized radius of 0 (drag never
                    // crossed a grid half-cell) discards the shape.
                    commitDraft(context, () => {
                        const radius = quantizeRadius(
                            Math.hypot(end.x - center.x, end.y - center.y),
                        );
                        return radius > 0 ? { kind: 'circle', center, radius } : null;
                    });
                },
            },
        });
        return null;
    },
    () => undefined,
) satisfies DrawPlugin;

// ── RECTANGLE TOOL ──
// Press + live pointer = opposite corners (normalized), both snapped to
// the grid lattice
export const rectangleToolPlugin = mountOf(
    (context: DrawPluginContext) => {
        // The pressed corner (see circleToolPlugin — closure state)
        let press: DrawPoint | null = null;
        context.tools.register({
            id: 'rectangle',
            label: 'Rectangle',
            icon: RECT_ICON,
            shortcut: 'KeyR',
            handlers: {
                onDragStart: (start: DrawPoint) => {
                    press = snapToGrid(start);
                    // Zero-area draft anchored at the SNAPPED press corner
                    writeDraft(context, { kind: 'rect', min: press, max: press });
                },
                onDragMove: (current: DrawPoint) => {
                    const pressPoint = press ?? snapToGrid(current);
                    // Snap the live corner, then normalize against the
                    // pressed corner (drag in any direction — fold-overs
                    // included; the running corners never ratchet)
                    const snapped = snapToGrid(current);
                    writeDraft(context, {
                        kind: 'rect',
                        min: {
                            x: Math.min(pressPoint.x, snapped.x),
                            y: Math.min(pressPoint.y, snapped.y),
                        },
                        max: {
                            x: Math.max(pressPoint.x, snapped.x),
                            y: Math.max(pressPoint.y, snapped.y),
                        },
                    });
                },
                onDragEnd: (end: DrawPoint) => {
                    const pressPoint = press ?? snapToGrid(end);
                    press = null;
                    // Commit the press↔end box; the builder snaps + discards
                    // zero-area pairs
                    commitDraft(context, () => createRectShape(pressPoint, end));
                },
            },
        });
        return null;
    },
    () => undefined,
) satisfies DrawPlugin;

// ── LINE TOOL (CURVE) ──
// Press = start, live pointer = end; both anchors snap to the grid and the
// chord's default control node bows multi-step chords ("curve instead of
// sharp" — the pure geometry lives in createCurveShape)
export const lineToolPlugin = mountOf(
    (context: DrawPluginContext) => {
        // The pressed anchor (see circleToolPlugin — closure state)
        let press: DrawPoint | null = null;
        context.tools.register({
            id: 'line',
            label: 'Line',
            icon: CURVE_ICON,
            shortcut: 'KeyL',
            handlers: {
                onDragStart: (start: DrawPoint) => {
                    press = snapToGrid(start);
                    // Zero-length draft anchored at the SNAPPED press point
                    writeDraft(context, {
                        kind: 'curve',
                        start: press,
                        control: press,
                        end: press,
                    });
                },
                onDragMove: (current: DrawPoint) => {
                    const pressPoint = press ?? snapToGrid(current);
                    // The builder snaps the endpoint + re-derives the
                    // default control (straight for 1 step, bent for
                    // multi-step chords); null (no cell crossed yet) clears
                    // the draft — the dashed preview appears a half-cell
                    // away from the anchor, never before
                    writeDraft(context, createCurveShape(pressPoint, current));
                },
                onDragEnd: (end: DrawPoint) => {
                    const pressPoint = press ?? snapToGrid(end);
                    press = null;
                    // Commit press↔end; a zero-step chord (drag never
                    // crossed a grid half-cell) discards
                    commitDraft(context, () => createCurveShape(pressPoint, end));
                },
            },
        });
        return null;
    },
    () => undefined,
) satisfies DrawPlugin;
