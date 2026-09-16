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
// position — the pair locks and moves as one until the user breaks the
// junction (double-click or pull-the-node-out). The check has two tiers,
// so locking is not flaky:
// - EXACT CONTACT (any node vs any node): both on the same world point →
//   bond, no movement. Point-driven drops (line ends, circle centers,
//   rect corners) snap to the lattice, so an aimed drop coincides.
// - RIM-CONTACT HEAL (circle rim nodes only): the rim is DIMENSIONAL —
//   radius quantization puts rim nodes at fixed compass points, so a
//   drop aimed at a DIAGONAL node commits the rim up to one grid step
//   away (the classic "sometimes locks, sometimes doesn't"). When NO
//   exact contact exists, the nearest lattice node within one grid step
//   of a rim welds the DROP: the whole circle TRANSLATES (snapShapeNode)
//   so that rim lands EXACTLY on the twin — radius stays quantized, the
//   center stays on the lattice. Existing geometry never moves.
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
    snapShapeNode,
    snapToGrid,
} from '../../functions/shapes';
import { BASE_SPACING } from '../../functions/canvasTransform';
import { bondsOf, connect } from '../../functions/connection';
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

// RIM_CONTACT_WINDOW — the circle-rim drop-heal window (one grid step):
// quantized radius + fixed compass points put a diagonal-intent drop's
// rim up to one step from the aimed node; anything FURTHER is a genuinely
// different junction and stays un-bonded (the grid contract keeps the
// aim precision honest — beyond a step the user was not dropping on it).
const RIM_CONTACT_WINDOW = BASE_SPACING;

// isLatticeNodePoint — a bond weld target must sit on the grid lattice:
// sliding a circle rim onto it keeps the center lattice (twin − rim is
// then a lattice offset). Half-lattice points (straight 1-step curve
// bends) are EXCLUDED — exact contact with one still bonds (that path
// doesn't move geometry, so the grid contract is safe).
const isLatticeNodePoint = (point: { x: number; y: number }): boolean =>
    ((point.x % BASE_SPACING) + BASE_SPACING) % BASE_SPACING === 0 &&
    ((point.y % BASE_SPACING) + BASE_SPACING) % BASE_SPACING === 0;

// The circle rim node ids (the four cardinal size handles; the center is
// point-driven and never needs the heal)
const RIM_NODE_IDS = ['e', 's', 'w', 'n'];

// autoLock — THE DROP CHECK, shared by BOTH lock moments (the same two
// tiers run whether the nodes arrived via a fresh drawing commit or via a
// drag-release of an old shape):
//
// 1. EXACT CONTACT: any moving-node vs any other-node point coincidence
//    bonds immediately and NO movement runs (guaranteed welds first).
// 2. RIM-CONTACT HEAL (only when the caller allows it): for a moving
//    CIRCLE, one step of slack heals the dimensional rim: the nearest
//    EXISTING LATTICE node within one grid step of a rim node slides the
//    circle so that rim lands EXACTLY on it (snapShapeNode — translation,
//    radius untouched, center stays lattice). ONE weld per drop (the
//    closest rim contact), then the contacts re-read on the WELDED
//    geometry and every remaining coincidence bonds.
//
// `movingIndex` — the shape that just settled ("moved"). Guards:
// - Never bonds two UNmoving shapes (scan targets are the other shapes
//   only; the caller decides which indices were the moving set — a
//   release that moved nothing skips the check entirely).
// - Heal candidates must be LATTICE nodes AND rims with NO existing bond
//   (snatching an already-welded rim away from its twin to weld it
//   elsewhere would silently dissolve a bond — violating the "until the
//   user purposely break the node" contract).
// Pure — no state handle touched.
const autoLock = (
    state: { shapes: DrawShape[]; connections: DrawBond[] },
    movingIndex: number,
    healRims: boolean,
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
    const bondsNow = (): DrawBond[] => state.connections;

    // ── Tier 1: exact contact (all nodes, both directions) ──
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
    if (exact.length > 0) {
        // Exact contacts win — no geometry movement, bond them all
        let bonds = bondsNow();
        for (const contact of exact) {
            bonds = connect(bonds, { shapeIndex: movingIndex, nodeId: contact.node }, contact.other);
        }
        return { shapes: state.shapes, connections: bonds };
    }

    // ── Tier 2: RIM-CONTACT HEAL (moving circle only, caller-gated) ──
    let shapes = state.shapes;
    if (healRims && shape.kind === 'circle') {
        // The closest rim-vs-lattice-node contact decides the weld; the
        // rim must be UN-BONDED (never re-snatch a welded rim — the bond
        // contract beats the heal)
        let best: {
            nodeId: string;
            other: { shapeIndex: number; nodeId: string; point: DrawPoint };
            distance: number;
        } | null = null;
        for (const node of nodes) {
            if (!RIM_NODE_IDS.includes(node.id)) continue;
            if (
                bondsOf(
                    state.connections,
                    { shapeIndex: movingIndex, nodeId: node.id },
                ).length > 0
            ) {
                continue; // already welded — never drag it away from its twin
            }
            for (const other of others) {
                if (!isLatticeNodePoint(other.point)) continue;
                const distance = Math.hypot(
                    other.point.x - node.point.x,
                    other.point.y - node.point.y,
                );
                if (distance <= RIM_CONTACT_WINDOW && (!best || distance < best.distance)) {
                    best = { nodeId: node.id, other, distance };
                }
            }
        }
        if (best) {
            // Slide the circle so the rim lands EXACTLY on the twin
            // (translation: the radius stays quantized, the center stays
            // lattice — the twin is a lattice point by the guard above)
            const welded = snapShapeNode(shape, best.nodeId, best.other.point);
            const next = shapes.slice();
            next[movingIndex] = welded;
            shapes = next;
            // Re-read the contacts on the WELDED geometry — every new
            // coincidence bonds (the welded rim coincides by construction)
            const weldedNodes = shapeNodes(welded);
            let bonds = bondsNow();
            for (const node of weldedNodes) {
                for (const other of others) {
                    if (other.point.x === node.point.x && other.point.y === node.point.y) {
                        bonds = connect(
                            bonds,
                            { shapeIndex: movingIndex, nodeId: node.id },
                            { shapeIndex: other.shapeIndex, nodeId: other.nodeId },
                        );
                    }
                }
            }
            return { shapes, connections: bonds };
        }
    }
    // No contact anywhere — the drop stands alone
    return { shapes: state.shapes, connections: bondsNow() };
};

// The shared commit — validates the draft through the builder, commits on
// success, clears the draft either way. The BUILT shape is re-stamped with
// the draft's ink: the builders re-project geometry (snapping, min/max
// normalization) and carry no metadata across. On commit the DROP CHECK
// (autoConnect) locks coinciding nodes and slides dropped circles onto
// one-step-away lattice nodes (the move-as-one contract).
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
    // position — exact coincidence bonds; a circle dropping its rim near
    // (≤ one step of) a lattice node slides onto it and welds exactly.
    // A fresh draw allows the rim heal (the dimensional-rim drop case).
    const result = autoLock({ ...state, shapes }, shapes.length - 1, true);
    context.drawing({
        ...state,
        shapes: result.shapes,
        connections: result.connections,
        draft: null,
    } as never);
};

// autoLockShapes — the DRAG-RELEASE lock moment for nodeEditorPlugin: runs
// the SAME drop check that fresh draws use over the SETTLED geometry
// ("dragging old shapes into new positions where the nodes share a
// coordinate must lock too — not just newly drawn shapes").
// - `movingIndices` — the shapes that moved (the grabbed shape's bond
//   group for a whole-shape drag, the adjusted shape for a node drag).
//   Only movers participate; static shapes never bond each other and
//   static circles never heal.
// - `healRims` — the dimensional-rim one-step slide. Allowed for
//   whole-shape drags (a released circle rims onto a lattice node like a
//   committed drop). FORBIDDEN for node adjustments: the user just sized
//   the circle deliberately — a heal would teleport it after the fact
//   (intended locks during adjustments bond per-frame via the
//   destination scan instead).
// Idempotent (connect dedupes + the heal guard skips welded rims), so a
// no-op release re-running it changes nothing.
export const autoLockShapes = (
    state: { shapes: DrawShape[]; connections: DrawBond[] },
    movingIndices: number[],
    healRims: boolean,
): { shapes: DrawShape[]; connections: DrawBond[] } => {
    let result = state;
    for (const index of movingIndices) {
        result = autoLock(result, index, healRims);
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
