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
// AUTO-CONNECT AT COMMIT (cross-reference: functions/connection.ts +
// nodeEditorPlugin's move-as-one contract): when a shape is DROPPED, ALL
// of its nodes check whether any existing shape has a node at that
// EXACT position — the pair locks and moves as one until the user breaks
// the junction (double-click or pull-the-node-out).
//
// EXACT CONTACT ONLY (any node vs any node): both nodes on the same
// world point → bond, and NO geometry moves. Point-driven drops (line
// ends, circle centers, rect corners) snap to the lattice, so an AIMED
// drop (released onto the twin's grid point) coincides and bonds.
//
// NO NEAR-DROP SNAPPING (user bug report: "when I draw close to another
// shape it gets snapped into that shape node for no reason — it
// shouldn't have done that"): the shape settles exactly where the GRID
// contract put it, never pulled TOWARD a neighbor. The former
// "rim-contact heal" (sliding a freshly dropped circle up to one grid
// step onto a nearby lattice node) is REMOVED — it snapped/teleported
// shapes into neighboring nodes on incidental proximity. Locking now
// requires the drawn node to already sit ON the twin's point; anything
// short of that stays free until the user deliberately CONNECTS it
// (node drag → proximity weld, nodeEditorPlugin) or never locks at all.
//
// SHORTCUTS: KeyC (circle), KeyR (rectangle), KeyL (line/curve) — via
// toolRouter.
// ─────────────────────────────────────────────────────────────────────────────

import {
    createCircleShape,
    createCurveShape,
    createRectShape,
    quantizeRadius,
    shapeNodes,
    snapToGrid,
} from '../../functions/shapes';
import { BASE_SPACING } from '../../functions/canvasTransform';
import { connect } from '../../functions/connection';
import type { DrawBond } from '../../functions/connection';
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

// autoLock — THE DROP CHECK, shared by BOTH lock moments (the same exact
// contact scan runs whether the nodes arrived via a fresh drawing commit
// or via a drag-release of an old shape):
//
// EXACT CONTACT: any moving-node vs any other-node point coincidence
// bonds immediately and NO geometry moves (both endpoints share the
// world point, so a bond is purely graph data).
//
// `movingIndex` — the shape that just settled ("moved"). Guard: never
// bonds two UNmoving shapes (scan targets are the other shapes only;
// the caller decides which indices were the moving set — a release
// that moved nothing skips the check entirely). Contact between two
// nodes of the SAME shape never bonds (same-shape coincidences are
// geometric facts, not junctions).
// Pure — no state handle touched.
const autoLock = (
    state: { shapes: DrawShape[]; connections: DrawBond[] },
    movingIndex: number,
): { shapes: DrawShape[]; connections: DrawBond[] } => {
    const shape = state.shapes[movingIndex];
    if (!shape) return state;
    // Every node of every OTHER shape (deterministic scan order)
    const others: { shapeIndex: number; nodeId: string; point: DrawPoint }[] = [];
    for (let s = 0; s < state.shapes.length; s++) {
        if (s === movingIndex) continue;
        for (const node of shapeNodes(state.shapes[s])) {
            others.push({ shapeIndex: s, nodeId: node.id, point: node.point });
        }
    }

    // ── Exact contact: all nodes, both directions ──
    const nodes = shapeNodes(shape);
    const exact: { node: string; other: { shapeIndex: number; nodeId: string } }[] = [];
    for (const node of nodes) {
        for (const other of others) {
            if (other.point.x === node.point.x && other.point.y === node.point.y) {
                exact.push({
                    node: node.id,
                    other: { shapeIndex: other.shapeIndex, nodeId: other.nodeId },
                });
            }
        }
    }
    // Contact wins — no geometry movement, bond them all. No contact →
    // the drop stands alone: a NEAR node (a step away, half a step …)
    // never pulls the shape (the no-near-drop-snapping contract).
    let bonds = state.connections;
    for (const contact of exact) {
        bonds = connect(bonds, { shapeIndex: movingIndex, nodeId: contact.node }, contact.other);
    }
    return { shapes: state.shapes, connections: bonds };
};

// The shared commit — validates the draft through the builder, commits on
// success, clears the draft either way. The BUILT shape is re-stamped with
// the draft's ink: the builders re-project geometry (snapping, min/max
// normalization) and carry no metadata across. On commit the DROP CHECK
// (autoLock) bonds ONLY exactly-coinciding nodes — the shape commits
// where the grid contract put it, never pulled toward a neighbor (the
// move-as-one contract, minus the removed near-drop snapping).
const commitDraft = (
    context: DrawPluginContext,
    build: () => DrawShape | null,
) => {
    const state = context.drawing() as {
        shapes: DrawShape[];
        drawing: boolean;
        draft: DrawShape | null;
        connections: DrawBond[];
    };
    const shape = build();
    // Stamp the CREATION-TIME ink from the draft onto the built shape
    const stamped =
        shape && state.draft?.color ? ({ ...shape, color: state.draft.color } as DrawShape) : shape;
    if (!stamped) {
        context.drawing({ ...state, draft: null } as never);
        return;
    }
    const shapes = [...state.shapes, stamped];
    // The DROP CHECK: every node of the new shape scans for a node at its
    // EXACT position — only real coincidence bonds (proximity never does:
    // the user bug report — "drawing close to another shape snapped it
    // into that shape node for no reason").
    const result = autoLock({ ...state, shapes }, shapes.length - 1);
    context.drawing({
        ...state,
        shapes: result.shapes,
        connections: result.connections,
        draft: null,
    } as never);
};

// autoLockShapes — the DRAG-RELEASE lock moment for nodeEditorPlugin: runs
// the SAME exact-contact check a fresh draw gets over the SETTLED geometry
// ("dragging old shapes into new positions where the nodes share a
// coordinate must lock too — not just newly drawn shapes").
// - `movingIndices` — the shapes that moved (the grabbed shape's bond
//   group for a whole-shape drag, the adjusted shape for a node drag).
//   Only movers participate; static shapes never bond each other.
// - NO heal: a released shape settles where the drag left it — a NEAR
//   node (even one grid step away) never slides the geometry onto it
//   (the no-near-drop-snapping contract; intentional junctions bond
//   per-frame via the node drag's destination scan instead).
// Idempotent (connect dedupes), so a no-op release re-running it changes
// nothing.
export const autoLockShapes = (
    state: { shapes: DrawShape[]; connections: DrawBond[] },
    movingIndices: number[],
): { shapes: DrawShape[]; connections: DrawBond[] } => {
    let result = state;
    for (const index of movingIndices) {
        result = autoLock(result, index);
    }
    return result;
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
