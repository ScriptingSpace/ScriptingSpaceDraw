import { describe, it, expect } from 'vitest';
import {
    bondKey,
    bondExists,
    bondsOf,
    bondsTouchingShape,
    groupOf,
    connect,
    breakAt,
    breakAllTouchingShape,
    twinPoint,
} from './connection';
import type { DrawBond, BondEndpoint } from './connection';
import { createCurveShape, createCircleShape, shapeNodes, adjustShape } from './shapes';
import type { DrawShape } from './shapes';

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for functions/connection.ts — the node bond graph.
//
// Fixtures build REAL shapes so bonds resolve through shapeNodes (geometry
// is the single truth — the graph carries no coordinates). ALL nodes of
// every shape participate (the "move as one" contract): curve
// start/control/end, circle center + e/s/w/n rim, rect corners. All
// expectations below are exact.
// ─────────────────────────────────────────────────────────────────────────────

// Two curves sharing grid point (200, 0): A's END bonds B's START
const curveA = createCurveShape({ x: 0, y: 0 }, { x: 200, y: 0 })!; // start (0,0) → end (200,0)
const curveB = createCurveShape({ x: 200, y: 0 }, { x: 400, y: 0 })!; // start (200,0) → end (400,0)
// A circle whose CENTER sits on B's far endpoint (a chain: A—B—circle)
const circle = createCircleShape({ x: 420, y: 10 }, { x: 500, y: 0 })!; // center (400,0), r 100
// A dead shape ref (negative index) for the dead-ref guards
const DEAD: BondEndpoint = { shapeIndex: -1, nodeId: 'start' };

// The canonical fixture bond: A.end ↔ B.start
const AB: DrawBond = [
    { shapeIndex: 0, nodeId: 'end' },
    { shapeIndex: 1, nodeId: 'start' },
];
// The chain bond: B.end ↔ circle.center
const BC: DrawBond = [
    { shapeIndex: 1, nodeId: 'end' },
    { shapeIndex: 2, nodeId: 'center' },
];
// A isolated rect corner drawn later (shape index 3) — never bonds here
const rectShape = {
    kind: 'rect' as const,
    min: { x: -300, y: 0 },
    max: { x: -200, y: 100 },
};
const shapes: DrawShape[] = [curveA, curveB, circle, rectShape];
const bonds: DrawBond[] = [AB, BC];

describe('connection — the bondable node set (every node locks)', () => {
    it('a curve exposes 3 bondable nodes, a circle 5, a rect 4 — shapeNodes is the node space', () => {
        expect(shapeNodes(curveA).map((node) => node.id)).toEqual(['start', 'control', 'end']);
        expect(shapeNodes(circle).map((node) => node.id)).toEqual([
            'center',
            'e',
            's',
            'w',
            'n',
        ]);
        expect(shapeNodes(rectShape).map((node) => node.id)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('any node id rides the graph: a bond on a rect corner resolves like a curve end', () => {
        const cornerBond: DrawBond = [
            { shapeIndex: 3, nodeId: 'c' },
            { shapeIndex: 0, nodeId: 'start' },
        ];
        expect(twinPoint(shapes, [cornerBond], { shapeIndex: 3, nodeId: 'c' })).toEqual({
            twin: { shapeIndex: 0, nodeId: 'start' },
            point: { x: 0, y: 0 }, // curveA's start
        });
    });
});

describe('connection — bondKey', () => {
    it('is order-insensitive: swapping the pair yields the same key', () => {
        const a: BondEndpoint = { shapeIndex: 0, nodeId: 'end' };
        const b: BondEndpoint = { shapeIndex: 1, nodeId: 'start' };
        expect(bondKey(a, b)).toBe('0:end|1:start');
        expect(bondKey(b, a)).toBe('0:end|1:start');
        expect(bondKey(a, b)).toBe(bondKey(b, a));
    });

    it('sorts lexicographically between the two serialized halves', () => {
        // '1' sorts before '3' as raw strings ("10:d" < "3:c")
        expect(bondKey({ shapeIndex: 3, nodeId: 'c' }, { shapeIndex: 10, nodeId: 'd' })).toBe(
            '10:d|3:c',
        );
    });
});

describe('connection — bondExists', () => {
    it('finds an existing bond regardless of pair order', () => {
        expect(bondExists(bonds, AB[0], AB[1])).toBe(true);
        expect(bondExists(bonds, AB[1], AB[0])).toBe(true);
    });

    it('rejects a pair that never bonded', () => {
        expect(bondExists(bonds, { shapeIndex: 0, nodeId: 'start' }, AB[0])).toBe(false);
        expect(bondExists(bonds, AB[0], DEAD)).toBe(false);
    });
});

describe('connection — bondsOf / bondsTouchingShape', () => {
    it('bondsOf lists every bond sitting on the endpoint (order preserved)', () => {
        const endpoint: BondEndpoint = { shapeIndex: 1, nodeId: 'start' };
        expect(bondsOf(bonds, endpoint)).toEqual([AB]);
        const hub: BondEndpoint = { shapeIndex: 1, nodeId: 'end' };
        expect(bondsOf(bonds, hub)).toEqual([BC]);
        const unbonded: BondEndpoint = { shapeIndex: 3, nodeId: 'a' };
        expect(bondsOf(bonds, unbonded)).toEqual([]);
    });

    it('bondsTouchingShape lists every bond the shape participates in', () => {
        const compact = (list: DrawBond[]) =>
            list.map((bond) =>
                bondKey(bond[0], bond[1]),
            );
        expect(compact(bondsTouchingShape(bonds, 0))).toEqual(['0:end|1:start']);
        expect(compact(bondsTouchingShape(bonds, 1))).toEqual(['0:end|1:start', '1:end|2:center']);
        expect(bondsTouchingShape(bonds, 3)).toEqual([]);
    });
});

describe('connection — groupOf (the move-as-one BFS)', () => {
    it('walks the whole bond chain from any seed member', () => {
        expect(groupOf(bonds, 0)).toEqual([0, 1, 2]);
        expect(groupOf(bonds, 1)).toEqual([0, 1, 2]);
        expect(groupOf(bonds, 2)).toEqual([0, 1, 2]);
    });

    it('a shape outside the chain forms its own singleton group', () => {
        expect(groupOf(bonds, 3)).toEqual([3]);
    });

    it('an un-bonded graph collapses to the seed only', () => {
        expect(groupOf([], 0)).toEqual([0]);
    });
});

describe('connection — connect', () => {
    it('appends a new bond (pure — a fresh array back)', () => {
        const base: DrawBond[] = [];
        const next = connect(base, { shapeIndex: 0, nodeId: 'end' }, {
            shapeIndex: 1,
            nodeId: 'start',
        });
        expect(next).toEqual([AB]);
        expect(next).not.toBe(base); // immutability
        // The input array is untouched
        expect(base).toEqual([]);
    });

    it('is idempotent: an existing bond returns the SAME array reference', () => {
        expect(connect(bonds, AB[0], AB[1])).toBe(bonds);
        // Order-insensitive: reversed pair still dedupes
        expect(connect(bonds, AB[1], AB[0])).toBe(bonds);
        expect(connect(bonds, BC[0], BC[1])).toBe(bonds);
    });

    it('never bonds a degenerate pair (same shape + same node)', () => {
        expect(connect(bonds, AB[0], AB[0])).toBe(bonds);
    });
});

describe('connection — breakAt', () => {
    it('removes every bond on the endpoint and keeps the rest', () => {
        const remaining = breakAt(bonds, { shapeIndex: 0, nodeId: 'end' });
        expect(remaining).toEqual([BC]);
        const suffix = breakAt(bonds, { shapeIndex: 2, nodeId: 'center' });
        expect(suffix).toEqual([AB]);
    });

    it('severs BOTH bonds at a junction node (the hub loses everything)', () => {
        // A synthetic 3-way: A.end ↔ B.start, A.end ↔ circle.center
        const hub = bondsOf(bonds, { shapeIndex: 0, nodeId: 'start' });
        expect(hub).toEqual([]);
        const fork: DrawBond[] = [
            AB,
            [
                { shapeIndex: 0, nodeId: 'end' },
                { shapeIndex: 2, nodeId: 'center' },
            ],
        ];
        const after = breakAt(fork, { shapeIndex: 0, nodeId: 'end' });
        expect(after).toEqual([]);
    });

    it('returns the array unchanged (still a filtered copy) when no bond touches', () => {
        const remaining = breakAt(bonds, { shapeIndex: 3, nodeId: 'a' });
        expect(remaining).toEqual(bonds);
        expect(remaining).not.toBe(bonds);
    });
});

describe('connection — breakAllTouchingShape', () => {
    it('removes every bond where the shape participates (both sides)', () => {
        const remaining = breakAllTouchingShape(bonds, 1);
        expect(remaining).toEqual([]);
        expect(breakAllTouchingShape(bonds, 0)).toEqual([BC]);
        expect(breakAllTouchingShape(bonds, 3)).toEqual(bonds);
    });
});

describe('connection — twinPoint (resolve the other side of a bond)', () => {
    it('resolves the FIRST bond partner and its world point through shapeNodes', () => {
        expect(twinPoint(shapes, bonds, { shapeIndex: 0, nodeId: 'end' })).toEqual({
            twin: { shapeIndex: 1, nodeId: 'start' },
            point: { x: 200, y: 0 },
        });
        expect(twinPoint(shapes, bonds, { shapeIndex: 2, nodeId: 'center' })).toEqual({
            twin: { shapeIndex: 1, nodeId: 'end' },
            point: { x: 400, y: 0 },
        });
    });

    it('is null for an un-bonded endpoint', () => {
        expect(twinPoint(shapes, bonds, { shapeIndex: 3, nodeId: 'a' })).toBeNull();
        expect(twinPoint(shapes, bonds, { shapeIndex: 0, nodeId: 'start' })).toBeNull();
    });

    it('is null when the partner shape no longer exists', () => {
        const dangling: DrawBond = [
            { shapeIndex: 0, nodeId: 'end' },
            { shapeIndex: 42, nodeId: 'start' },
        ];
        expect(twinPoint(shapes, [dangling], { shapeIndex: 0, nodeId: 'end' })).toBeNull();
    });

    it('follows the LIVE geometry (adjustShape moves the twin point)', () => {
        // Move B's start one cell left — the twin read updates behind it
        const movedB = adjustShape(curveB, 'start', { x: 100, y: 0 });
        expect(movedB).toEqual({
            kind: 'curve',
            start: { x: 100, y: 0 },
            control: { x: 300, y: 100 }, // B's original control (kept absolute)
            end: { x: 400, y: 0 },
        });
        expect(twinPoint([curveA, movedB, circle, rectShape], bonds, {
            shapeIndex: 0,
            nodeId: 'end',
        })).toEqual({ twin: { shapeIndex: 1, nodeId: 'start' }, point: { x: 100, y: 0 } });
    });

    it('resolves against shapeNodes positions even across shape kinds', () => {
        // Fixture where the TWIN is the circle's center (a chain end)
        const point = twinPoint(shapes, bonds, { shapeIndex: 1, nodeId: 'end' });
        expect(point).toEqual({ twin: { shapeIndex: 2, nodeId: 'center' }, point: { x: 400, y: 0 } });
        // Cross-check the resolved point against the shape's own node read
        const nodes = shapeNodes(circle);
        expect(nodes[0].id).toBe('center');
        expect(nodes[0].point).toEqual({ x: 400, y: 0 });
    });
});
