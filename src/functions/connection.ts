// ─────────────────────────────────────────────────────────────────────────────
// Draw connection graph — endpoint bonds between shapes.
//
// USER CONTRACT ("When two item connected either by node, they are move as
// one unit until the user purposely break the node"): two shapes sharing an
// endpoint form a BOND; dragging one shape moves the whole GROUP as one
// unit. The bond persists across pan/zoom (it is keyed by world endpoints)
// and only dissolves when the user deliberately DOUBLE-CLICKS the bonded
// junction node (see nodeEditorPlugin's double-click break gesture).
//
// THE ENDPOINT SPACE (what can bond): the round-trip boundary points of
// every shape:
// - curve: `start`, `end` (the control node never bonds — it bends, it
//   does not join)
// - circle: the center node bonds (a bond can sit at the center point)
// - rect: the four corners
// A bond is a pair of (shapeIndex, nodeId) refs — resolved to WORLD points
// at query time through shapeNodes, so geometry stays the single truth and
// the graph carries no coordinates.
//
// IDENTIFICATION: shapes are referenced by ARRAY INDEX (the drawing state
// stores an array; nothing mints stable ids). Indices shift only when
// shapes are removed (no removal feature yet — safe today).
//
// THE GROUP RULE (the contract): moving a bonded shape moves EVERY shape
// reachable through the bond chain — the BFS in groupOf. Dragging rides
// the delta from the grab anchor, so a group move = every member moving by
// the same (dx, dy).
// ─────────────────────────────────────────────────────────────────────────────

import { shapeNodes } from './shapes';
import type { DrawShape, DrawPoint } from './shapes';

// A half-bond: one endpoint of one shape
export type BondEndpoint = { shapeIndex: number; nodeId: string };

// A complete bond — an UNORDERED pair of endpoints that are locked together.
// Persisted in DrawDrawingState.connections (plain serializable data).
export type DrawBond = [BondEndpoint, BondEndpoint];

// Can the given (shape, node) join bonds? Only ROUND-TRIP boundary points
// join: curve start/end, circle center, rect corners. The curve control
// (the bend node) and the circle radius node are NEVER endpoints — a bend
// is internal curvature, a radius is an edge choice.
export const isEndpointNode = (shape: DrawShape, nodeId: string): boolean => {
    switch (shape.kind) {
        case 'curve':
            return nodeId === 'start' || nodeId === 'end';
        case 'circle':
            return nodeId === 'center';
        case 'rect':
            return nodeId === 'a' || nodeId === 'b' || nodeId === 'c' || nodeId === 'd';
    }
};

// bondKey — the canonical serialization of a bond (order-insensitive) for
// fast lookups + dedupe.
export const bondKey = (a: BondEndpoint, b: BondEndpoint): string => {
    const keyA = `${a.shapeIndex}:${a.nodeId}`;
    const keyB = `${b.shapeIndex}:${b.nodeId}`;
    return keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
};

// ── Pure helpers over a bonds array (the drawing state owns the array) ──

// bondExists — is this exact endpoint pair already bonded?
export const bondExists = (bonds: DrawBond[], a: BondEndpoint, b: BondEndpoint): boolean => {
    const key = bondKey(a, b);
    return bonds.some((bond) => bondKey(bond[0], bond[1]) === key);
};

// bondsOf — every bond on which this endpoint sits (order preserved)
export const bondsOf = (bonds: DrawBond[], endpoint: BondEndpoint): DrawBond[] =>
    bonds.filter(
        (bond) =>
            (bond[0].shapeIndex === endpoint.shapeIndex && bond[0].nodeId === endpoint.nodeId) ||
            (bond[1].shapeIndex === endpoint.shapeIndex && bond[1].nodeId === endpoint.nodeId),
    );

// bondsTouchingShape — every bond where the given shape participates
export const bondsTouchingShape = (bonds: DrawBond[], shapeIndex: number): DrawBond[] =>
    bonds.filter((bond) => bond[0].shapeIndex === shapeIndex || bond[1].shapeIndex === shapeIndex);

// groupOf — every shape index REACHABLE from `shapeIndex` through the bond
// chain (iterative BFS over shape→shape hops). Includes the seed itself.
export const groupOf = (bonds: DrawBond[], shapeIndex: number): number[] => {
    const group = new Set<number>([shapeIndex]);
    const frontier = [shapeIndex];
    while (frontier.length > 0) {
        const current = frontier.pop() as number;
        bondsTouchingShape(bonds, current).forEach((bond) => {
            // HOP: a bond on the current shape → its other side
            const other =
                bond[0].shapeIndex === current ? bond[1].shapeIndex : bond[0].shapeIndex;
            if (!group.has(other)) {
                group.add(other);
                frontier.push(other);
            }
        });
    }
    // Sorted ascending — deterministic order for callers that iterate
    return Array.from(group).sort((a, b) => a - b);
};

// connect — a NEW bond between two endpoints. NO-OP (returns the same
// array reference) when the pair is already bonded or when either endpoint
// is invalid (self-shape, same node, or the twin's shape doesn't exist —
// the caller validates endpoint-node-ness since it needs shape bodies).
export const connect = (
    bonds: DrawBond[],
    a: BondEndpoint,
    b: BondEndpoint,
): DrawBond[] => {
    // Degenerate refs never bond
    if (a.shapeIndex === b.shapeIndex && a.nodeId === b.nodeId) return bonds;
    if (bondExists(bonds, a, b)) return bonds;
    const next = bonds.slice();
    next.push([a, b]);
    return next;
};

// breakAt — remove every bond touching the given endpoint (the user
// "purposely breaks the node" — the nodeEditorPlugin's DOUBLE-CLICK break
// gesture on a bonded junction). Pure — returns the filtered array.
export const breakAt = (bonds: DrawBond[], endpoint: BondEndpoint): DrawBond[] =>
    bonds.filter(
        (bond) =>
            !(
                (bond[0].shapeIndex === endpoint.shapeIndex &&
                    bond[0].nodeId === endpoint.nodeId) ||
                (bond[1].shapeIndex === endpoint.shapeIndex &&
                    bond[1].nodeId === endpoint.nodeId)
            ),
    );

// breakAllTouchingShape — remove every bond where the shape participates
// (used when the whole-shape move intentionally separates the shape from
// its former partners)
export const breakAllTouchingShape = (bonds: DrawBond[], shapeIndex: number): DrawBond[] =>
    bonds.filter((bond) => bond[0].shapeIndex !== shapeIndex && bond[1].shapeIndex !== shapeIndex);

// twinPoint — the world point of the OTHER side of the FIRST bond sitting
// on `endpoint` (null when the endpoint is un-bonded or refs dead shapes).
// Resolves through shapeNodes — geometry is the single truth.
export const twinPoint = (
    shapes: DrawShape[],
    bonds: DrawBond[],
    endpoint: BondEndpoint,
): { twin: BondEndpoint; point: DrawPoint } | null => {
    const touching = bondsOf(bonds, endpoint);
    if (touching.length === 0) return null;
    const partner =
        touching[0][0].shapeIndex === endpoint.shapeIndex && touching[0][0].nodeId === endpoint.nodeId
            ? touching[0][1]
            : touching[0][0];
    const shape = shapes[partner.shapeIndex];
    if (!shape) return null;
    const node = shapeNodes(shape).find((entry) => entry.id === partner.nodeId);
    return node ? { twin: partner, point: node.point } : null;
};
