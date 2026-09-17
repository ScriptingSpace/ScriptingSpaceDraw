// ─────────────────────────────────────────────────────────────────────────────
// Selection math — the rubber-band (marquee) + bond-aware picking helpers.
//
// USER CONTRACT ("Remove the left click from draggable. Allows it to hold and
// drag to create a selection box. This allows the user to select multiple
// items by create a selection box across multiple shape. Jointed shapes are
// selected together."):
//
// - A left drag on empty canvas draws a MARQUEE BOX (world-space — the box
//   is anchored to the plane, exactly like shapes); at release every shape
//   whose bounding box TOUCHES the marquee joins the selection
//   (selectShapesInBounds).
// - "JOINTED SHAPES ARE SELECTED TOGETHER": after the bounds picks, the
//   selection expands TRANSITIVELY through the endpoint-bond graph
//   (movingSetOf — BFS over the same shape→shape hops the move-as-one
//   gesture uses, cross-reference: functions/connection.ts groupOf). A box
//   that touches only one end of a jointed pair selects BOTH — they move
//   as one unit, so they belong to the selection as one unit.
// - The same movingSetOf rule drives MULTI-MOVE: grabbing one member of the
 //  selection translates every selected shape by the same snapped delta
//   (nodeEditorPlugin consumes it for the drag + the release auto-lock).
//
// ALL pure math — no DOM, no state handles (fully unit-testable; the
// gesture + rendering live in ../plugins/features/selectionPlugin.tsx).
// ─────────────────────────────────────────────────────────────────────────────

import { groupOf } from './connection';
import type { DrawBond } from './connection';
import { shapeNodes } from './shapes';
import type { DrawPoint, DrawShape } from './shapes';

// An axis-aligned world-space box (min corner ≤ max corner, componentwise)
export type DrawBounds = { min: DrawPoint; max: DrawPoint };

// marqueeBounds — the normalized live marquee box from the drag anchor and
// the current pointer point (drag in ANY direction — the box never folds
// inside out, mirroring the rectangle tool's corner normalization)
export const marqueeBounds = (start: DrawPoint, current: DrawPoint): DrawBounds => ({
    min: { x: Math.min(start.x, current.x), y: Math.min(start.y, current.y) },
    max: { x: Math.max(start.x, current.x), y: Math.max(start.y, current.y) },
});

// shapeBounds — the axis-aligned bounding box of a shape in world space,
// computed over its NODE points (shapeNodes is the single geometry view:
// curve start/control/end, circle center + 4 cardinal rims — for a circle
// the rim points already span the full diameter, no special-casing).
// Superset semantics: a bulging Bézier control counts as inside the box —
// marquee picking is generous, matching the visual read of the shape.
export const shapeBounds = (shape: DrawShape): DrawBounds => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of shapeNodes(shape)) {
        minX = Math.min(minX, node.point.x);
        minY = Math.min(minY, node.point.y);
        maxX = Math.max(maxX, node.point.x);
        maxY = Math.max(maxY, node.point.y);
    }
    return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
};

// boundsIntersect — INCLUSIVE overlap test (a box merely TOUCHING a shape's
// bounds picks it — dragging a one-pixel sliver across an edge selects).
// Also true for degenerate boxes (a point inside the other box).
export const boundsIntersect = (a: DrawBounds, b: DrawBounds): boolean =>
    a.min.x <= b.max.x &&
    b.min.x <= a.max.x &&
    a.min.y <= b.max.y &&
    b.min.y <= a.max.y;

// movingSetOf — every shape index reachable from ANY seed through the bond
// chain (union of groupOf over the seeds, sorted ascending). "Jointed shapes
// are selected together": a bonded partner of any seed is ALWAYS part of the
// set, whether the set came from a marquee pick or a grab.
export const movingSetOf = (connections: DrawBond[], seeds: number[]): number[] => {
    const set = new Set<number>();
    for (const seed of seeds) {
        for (const member of groupOf(connections, seed)) {
            set.add(member);
        }
    }
    return Array.from(set).sort((a, b) => a - b);
};

// selectShapesInBounds — the marquee release rule: shapes whose bounds
// intersect the box are picked, then the picks expand transitively through
// the bond graph. Pure: returns the sorted selection index list the caller
// writes into the drawing state.
export const selectShapesInBounds = (
    shapes: DrawShape[],
    connections: DrawBond[],
    bounds: DrawBounds,
): number[] => {
    const picks: number[] = [];
    for (let index = 0; index < shapes.length; index++) {
        if (boundsIntersect(shapeBounds(shapes[index]), bounds)) {
            picks.push(index);
        }
    }
    return movingSetOf(connections, picks);
};
