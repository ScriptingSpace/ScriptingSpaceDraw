// ─────────────────────────────────────────────────────────────────────────────
// Draw shapes — the pure world-coordinate shape model for the drawing tools.
//
// ALL shapes live in WORLD (canvas) coordinates: they are anchored to the
// infinite plane, so panning slides them and zooming scales them — exactly
// like the grid. The renderers (drawingLayerPlugin) project them to screen
// space with shapeToScreen at render time; nothing here touches the DOM.
//
// GRID CONTRACT (user: "This isn't free form, it is according the grid. All
// Circle, Rectangle and Lines must snapped to the grid points."):
// - There is NO freehand/path shape — every shape is grid-locked. All
//   anchors (circle centers, rect corners, curve endpoints) pass through
//   snapToGrid (cross-reference: canvasTransform.ts) so they land ON grid
//   intersections. Circle radii quantize to whole grid steps so the four
//   cardinal points of a circle sit on grid points too.
// - LINE = SHORTEST PATH FIRST (user: "update the curve tool to line tool,
//   3 nodes where the 2nd node behaves like the curve tool — change its
//   default behavior to the shortest path possible, and the user can
//   adjust to make it curved if needed"): the Line tool still stores a
//   quadratic Bézier (kind 'curve' — the 3-node data carrier: start /
//   control / end, the grid contract demands lattice-aligned geometry),
//   but the DEFAULT control node sits at the chord's EXACT MIDPOINT — a
//   degenerate Bézier that renders a geometrically straight line. There
//   is NO automatic bowing anymore; CURVING is an OPT-IN gesture: grab
//   the hollow control node (the 2nd node) and drag it off the chord
//   (adjustShape re-bends the Bézier — the old curve-tool behavior).
//
// SHAPE SET:
// - `curve` — start/control/end quadratic Bézier (the Line tool + its
//   draggable bend node)
// - `circle`— center + quantized radius. FIVE nodes: the center (1, the
//   middle) + the four cardinal rim points ( East / South / West / North
//   — the four "size" handles, all quantized grid points when the center
//   is on the grid)
// - `rect`  — min/max corners (both on the grid)
//
// The builders normalize the raw drag geometry (min/max ordering, radius
// quantization, endpoint snapping). The NODE functions (shapeNodes /
// adjustShape) expose each shape's adjustable handles for the node editor
// plugin (cross-reference: plugins/features/nodeEditorPlugin.tsx).
//
// STROKE COLOR: shapes optionally carry `color` (hex) — stamped by the tool
// layer at draft time from the active palette swatch; a committed shape
// keeps its creation-time ink (cross-reference: colorPalettePlugin.tsx).
// Pure math — fully unit-testable without a DOM.
// ─────────────────────────────────────────────────────────────────────────────

import {
    BASE_SPACING,
    canvasToScreen,
    snapToGrid,
    snapToGridAxis,
    gridSteps,
} from './canvasTransform';
import type { CanvasTransform } from './canvasTransform';

// A 2D point in world (canvas) coordinates
export type DrawPoint = { x: number; y: number };

// The stroke color a shape was drawn with (hex, e.g. '#7aa2f7'). OPTIONAL —
// the tool layer stamps it onto the draft at drag time from the ACTIVE
// palette swatch (context.drawing().color), so each committed shape keeps
// its creation-time ink regardless of later swatch changes.
type DrawShapeColor = { color?: string };

// The curve — a quadratic Bézier: start and end are grid-snapped anchors;
// control is the bend node (midpoint of the chord = straight — the Line
// tool's default; offset = curved, the opt-in user adjust).
export type DrawCurveShape = DrawShapeColor & {
    kind: 'curve';
    start: DrawPoint;
    control: DrawPoint;
    end: DrawPoint;
};

// Axis-aligned circle: center on a grid point + a radius quantized to whole
// grid steps (its cardinal points sit on grid intersections).
export type DrawCircleShape = DrawShapeColor & {
    kind: 'circle';
    center: DrawPoint;
    radius: number;
};

// Axis-aligned rectangle: min/max corners, both grid-snapped.
export type DrawRectShape = DrawShapeColor & {
    kind: 'rect';
    // Top-left corner in world space (min x, min y)
    min: DrawPoint;
    // Bottom-right corner in world space (max x, max y)
    max: DrawPoint;
};

// The discriminated union — the renderers/editor switch on `kind`
export type DrawShape = DrawCurveShape | DrawCircleShape | DrawRectShape;

// ── Building helpers ──

// quantizeRadius — snap a raw pixel distance into whole grid steps so the
// circle's cardinal points land on grid intersections. Radius 0 (drag did
// not clear half a cell) stays 0 — the caller discards those.
export const quantizeRadius = (distance: number, spacing: number = BASE_SPACING): number =>
    Math.max(0, Math.round(distance / spacing)) * spacing;

// createCurveShape — the LINE tool builder: a grid line between two
// endpoints. Both anchors snap to the lattice; a chord spanning ZERO
// steps (the drag never crossed a half-cell toward another intersection)
// is discarded. The control node is the chord's TRUE MIDPOINT for EVERY
// chord length — the shortest-path default (a degenerate quadratic Bézier
// renders straight). Curving is opt-in afterwards: the user drags the
// control node off the chord (adjustShape — the node editor plugin).
export const createCurveShape = (
    start: DrawPoint,
    end: DrawPoint,
    spacing: number = BASE_SPACING,
): DrawCurveShape | null => {
    const s = snapToGrid(start, spacing);
    const e = snapToGrid(end, spacing);
    if (gridSteps(e.x - s.x, e.y - s.y, spacing) === 0) return null;
    return { kind: 'curve', start: s, control: { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 }, end: e };
};

// createCircleShape — center snaps to the nearest grid point; the radius is
// the drag distance QUANTIZED to grid steps (cardinal points on the grid).
// A quantized radius of 0 (click without drag) produces null.
export const createCircleShape = (
    center: DrawPoint,
    edge: DrawPoint,
    spacing: number = BASE_SPACING,
): DrawCircleShape | null => {
    const snapped = snapToGrid(center, spacing);
    const radius = quantizeRadius(Math.hypot(edge.x - snapped.x, edge.y - snapped.y), spacing);
    if (radius <= 0) return null;
    return { kind: 'circle', center: snapped, radius };
};

// createRectShape — min/max corners from any two opposite drag corners,
// both snapped to the grid. Zero-area (both corners snap to the same
// lattice point) → not a shape.
export const createRectShape = (
    a: DrawPoint,
    b: DrawPoint,
    spacing: number = BASE_SPACING,
): DrawRectShape | null => {
    const snappedA = snapToGrid(a, spacing);
    const snappedB = snapToGrid(b, spacing);
    const min = { x: Math.min(snappedA.x, snappedB.x), y: Math.min(snappedA.y, snappedB.y) };
    const max = { x: Math.max(snappedA.x, snappedB.x), y: Math.max(snappedA.y, snappedB.y) };
    if (max.x - min.x <= 0 || max.y - min.y <= 0) return null;
    return { kind: 'rect', min, max };
};

// ── The grab-move gesture math (whole-shape translation + body hit-test) ──

// shapeInk — the presentation stroke of a shape: its stamped creation-time
// color, or `fallback` for legacy shapes drawn before the palette existed.
// Both the drawing layer (stroke rendering) and the node editor (handle
// dots read the SAME ink so "node color matches the line color") consume
// this — one resolution rule, no drift.
export const shapeInk = (shape: DrawShape, fallback: string): string => shape.color ?? fallback;

// moveShape — translate a WHOLE shape by a world delta (the line-grab move:
// "I should be able to move it around the canvas if I grab them and move
// around"). Every vertex re-snaps to the lattice after translating, so a
// snapped delta keeps all geometry on grid points even with float drift.
// The caller snaps the drag delta (dx, dy) before calling — snapping here
// is the safety net.
export const moveShape = (
    shape: DrawShape,
    dx: number,
    dy: number,
    spacing: number = BASE_SPACING,
): DrawShape => {
    const moved = (point: DrawPoint): DrawPoint =>
        snapToGrid({ x: point.x + dx, y: point.y + dy }, spacing);
    switch (shape.kind) {
        case 'curve':
            return { ...shape, start: moved(shape.start), control: moved(shape.control), end: moved(shape.end) };
        case 'circle':
            return { ...shape, center: moved(shape.center) };
        case 'rect':
            return { ...shape, min: moved(shape.min), max: moved(shape.max) };
    }
};

// pointToSegment — the world distance from a point to a line segment
// (standard orthogonal projection, clamped to the segment)
const pointToSegment = (point: DrawPoint, a: DrawPoint, b: DrawPoint): number => {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const length2 = abx * abx + aby * aby;
    // Degenerate segment (a == b) → plain point distance
    if (length2 === 0) return Math.hypot(point.x - a.x, point.y - a.y);
    // Projection parameter clamped into [0, 1] — outside lands on the
    // endpoints so corners measure correctly
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / length2));
    return Math.hypot(point.x - (a.x + abx * t), point.y - (a.y + aby * t));
};

// BODY_SAMPLE_STEPS — quadratic Bézier sampling density for curve
// hit-testing. 32 chords over the whole curve keep the sampling error far
// below one screen pixel at any reachable zoom.
const BODY_SAMPLE_STEPS = 32;

// distanceToShape — the distance from a world point to a shape's STROKE
// (the visible stuff: the curve path, the circle outline, the rect border).
// The node editor hit-tests GRABBING THE LINE ITSELF with this ("on the
// line itself" — the whole-shape move gesture); fills don't count, the
// shapes render transparent inside. World units — the caller converts the
// screen-px threshold via ÷ scale.
export const distanceToShape = (
    shape: DrawShape,
    point: DrawPoint,
    spacing: number = BASE_SPACING,
): number => {
    switch (shape.kind) {
        case 'curve': {
            // Sample the quadratic Bézier q(t) = (1−t)²·start + 2t(1−t)·control + t²·end
            let min = Infinity;
            let previous = shape.start;
            for (let index = 1; index <= BODY_SAMPLE_STEPS; index++) {
                const t = index / BODY_SAMPLE_STEPS;
                const current = {
                    x:
                        (1 - t) * (1 - t) * shape.start.x +
                        2 * t * (1 - t) * shape.control.x +
                        t * t * shape.end.x,
                    y:
                        (1 - t) * (1 - t) * shape.start.y +
                        2 * t * (1 - t) * shape.control.y +
                        t * t * shape.end.y,
                };
                min = Math.min(min, pointToSegment(point, previous, current));
                previous = current;
            }
            return min;
        }
        case 'circle':
            // The outline: how far the point's radius is from the shape's
            // radius (0 when exactly on the rim)
            return Math.abs(Math.hypot(point.x - shape.center.x, point.y - shape.center.y) - shape.radius);
        case 'rect':
            // The border: nearest of the four edges (a point ON the border
            // measures 0; a deep-inside point measures to its nearest wall)
            return Math.min(
                pointToSegment(point, shape.min, { x: shape.max.x, y: shape.min.y }),
                pointToSegment(point, { x: shape.max.x, y: shape.min.y }, shape.max),
                pointToSegment(point, shape.max, { x: shape.min.x, y: shape.max.y }),
                pointToSegment(point, { x: shape.min.x, y: shape.max.y }, shape.min),
            );
    }
};


// shapeToScreen — project a shape from world space to screen space for
// rendering. The stroke `color` is world-INDEPENDENT (hex string — no
// coordinates to transform), so it copies through; dropping it would lose
// the palette ink.
export const shapeToScreen = (
    shape: DrawShape,
    transform: CanvasTransform,
): DrawShape => {
    switch (shape.kind) {
        case 'curve':
            return {
                kind: 'curve',
                start: canvasToScreen(shape.start, transform),
                control: canvasToScreen(shape.control, transform),
                end: canvasToScreen(shape.end, transform),
                ...(shape.color ? { color: shape.color } : {}),
            };
        case 'circle':
            return {
                kind: 'circle',
                center: canvasToScreen(shape.center, transform),
                // Radius scales with zoom (a world-space circle)
                radius: shape.radius * transform.scale,
                ...(shape.color ? { color: shape.color } : {}),
            };
        case 'rect':
            return {
                kind: 'rect',
                min: canvasToScreen(shape.min, transform),
                max: canvasToScreen(shape.max, transform),
                ...(shape.color ? { color: shape.color } : {}),
            };
    }
};

// ── Nodes (the draggable adjustment handles) ──

// A shape node: a stable handle id + the world point it currently pins.
// `hollow` marks the curve control node (rendered as a ring — it bends the
// line instead of moving geometry).
export type DrawShapeNode = { id: string; point: DrawPoint; hollow?: boolean };

// shapeNodes — every adjustable handle of a shape. The node editor plugin
// renders these as dots and hit-tests drags against them (nearest node
// within the grab radius wins; later shapes win ties since they draw on
// top). Order matters for rendering only — hit-testing is geometric.
export const shapeNodes = (shape: DrawShape): DrawShapeNode[] => {
    switch (shape.kind) {
        case 'curve':
            return [
                { id: 'start', point: shape.start },
                // The bend node — hollow ring in the UI
                { id: 'control', point: shape.control, hollow: true },
                { id: 'end', point: shape.end },
            ];
        case 'circle': {
            // FIVE handles (user contract: "It should have at least 5, four
            // size and 1 in the middle"): the center node (moves the
            // circle) + the four cardinal rim nodes — East (3 o'clock,
            // kept the legacy primary edge handle), South (6 o'clock),
            // West (9 o'clock), North (12 o'clock). With an on-grid center
            // and quantized radius all five pin to grid intersections.
            const east = { x: shape.center.x + shape.radius, y: shape.center.y };
            const south = { x: shape.center.x, y: shape.center.y + shape.radius };
            const west = { x: shape.center.x - shape.radius, y: shape.center.y };
            const north = { x: shape.center.x, y: shape.center.y - shape.radius };
            return [
                { id: 'center', point: shape.center },
                { id: 'e', point: east },
                { id: 's', point: south },
                { id: 'w', point: west },
                { id: 'n', point: north },
            ];
        }
        case 'rect':
            // The four corners (a=min,min → clockwise)
            return [
                { id: 'a', point: shape.min },
                { id: 'b', point: { x: shape.max.x, y: shape.min.y } },
                { id: 'c', point: shape.max },
                { id: 'd', point: { x: shape.min.x, y: shape.max.y } },
            ];
    }
};

// Node ids: curve anchors/bend, circle center/radius, rect corners.
// RECT_FIXED_OPPOSITE_KEY: dragging corner `X` keeps the DIAGONAL OPPOSITE
// corner fixed (a↔c, b↔d), so a corner drag re-anchors the rect around it
// — fold-over works, never vanishing, because adjustShape re-normalizes.
export const RECT_FIXED_OPPOSITE_KEY: Record<string, string> = {
    a: 'c',
    b: 'd',
    c: 'a',
    d: 'b',
};

// adjustShape — apply a node drag: reassign the dragged node to the snapped
// pointer position and rebuild the shape's geometry around it. Pure — the
// node editor writes the result back into the drawing state.
// Rules (all grid-locked — "This isn't free form"):
// - circle/center → the center snaps to the lattice (radius follows).
// - circle/radius → the radius re-quantizes to grid steps from the center;
//   clamped to ≥ 1 step so the circle never collapses away entirely.
// - rect corner   → the dragged corner snaps; the opposite corner stays;
//   min/max re-normalize (drag across = fold over, never vanish).
// - curve start/end/control → that node snaps (dragging an endpoint keeps
//   the OTHER nodes absolute — the bend survives endpoint moves).
export const adjustShape = (
    shape: DrawShape,
    nodeId: string,
    point: DrawPoint,
    spacing: number = BASE_SPACING,
): DrawShape | null => {
    switch (shape.kind) {
        case 'curve': {
            const snapped = snapToGrid(point, spacing);
            if (nodeId === 'start') return { ...shape, start: snapped };
            if (nodeId === 'end') return { ...shape, end: snapped };
            if (nodeId === 'control') return { ...shape, control: snapped };
            return shape;
        }
        case 'circle': {
            if (nodeId === 'center') {
                const center = snapToGrid(point, spacing);
                return { ...shape, center };
            }
            // All FOUR cardinal rim handles act as the radius edge: the
            // radius relies on the center→pointer distance (drag direction
            // irrelevant — an East drag behaves like a North drag),
            // re-quantized to grid steps; clamped to ≥ 1 step so the
            // circle never collapses away entirely.
            if (nodeId === 'e' || nodeId === 's' || nodeId === 'w' || nodeId === 'n') {
                const distance = Math.hypot(point.x - shape.center.x, point.y - shape.center.y);
                const radius = Math.max(spacing, quantizeRadius(distance, spacing));
                return { ...shape, radius };
            }
            return shape;
        }
        case 'rect': {
            const fixedKey = RECT_FIXED_OPPOSITE_KEY[nodeId];
            if (!fixedKey) return shape;
            // The fixed corner by dragged-node id (a↔c, b↔d diagonals)
            const fixed =
                fixedKey === 'a'
                    ? shape.min
                    : fixedKey === 'c'
                      ? shape.max
                      : fixedKey === 'b'
                        ? { x: shape.max.x, y: shape.min.y }
                        : { x: shape.min.x, y: shape.max.y };
            const dragged = snapToGrid(point, spacing);
            // Re-normalize: min/max from the dragged + fixed corners
            const min = {
                x: Math.min(dragged.x, fixed.x),
                y: Math.min(dragged.y, fixed.y),
            };
            const max = {
                x: Math.max(dragged.x, fixed.x),
                y: Math.max(dragged.y, fixed.y),
            };
            return { ...shape, min, max };
        }
    }
};

// snapShapeNode — force one node EXACTLY onto a world point (the BOND
// weld from nodeEditorPlugin: two locked nodes must COINCIDE, not sit
// within half a cell of each other). Curves/rects route through
// adjustShape — every adjustable node snaps to the lattice and bond
// twins are lattice points, so the result is exact. CIRCLE RIM nodes
// must NOT route through adjustShape for a weld: it re-quantizes the
// radius to whole grid steps, so a twin at a non-step distance (a
// diagonal lattice point — center→twin = step·√2) would land up to half
// a cell short of the twin and the junction would LOOK open while the
// bond already reports it locked. Instead the whole circle TRANSLATES
// (moveShape) until the rim lands exactly on the twin: the quantized
// radius and the grid-locked radius both survive, and the center roll
// STAYS on the lattice (twin − oldRim is a lattice−lattice offset, and
// oldCenter + a lattice offset is a lattice point).
export const snapShapeNode = (
    shape: DrawShape,
    nodeId: string,
    point: DrawPoint,
    spacing: number = BASE_SPACING,
): DrawShape => {
    if (shape.kind === 'circle' && nodeId !== 'center') {
        const node = shapeNodes(shape).find((entry) => entry.id === nodeId);
        if (!node) return shape;
        return moveShape(shape, point.x - node.point.x, point.y - node.point.y, spacing);
    }
    const adjusted = adjustShape(shape, nodeId, point, spacing);
    return adjusted ?? shape;
};

// Re-export the snapping helpers the tool/editor layers consume so callers
// stay inside the shapes module's public surface
export { snapToGrid, snapToGridAxis, gridSteps };
