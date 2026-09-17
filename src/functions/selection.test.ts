import { describe, it, expect } from 'vitest';
import {
    shapeBounds,
    boundsIntersect,
    marqueeBounds,
    selectShapesInBounds,
    movingSetOf,
} from './selection';
import type { DrawShape, DrawBond } from './shapes';

// ─────────────────────────────────────────────────────────────────────────────
// The selection math (pure — no DOM): marquee box normalization, shape
// bounding boxes, inclusive bounds intersect, and the bond-aware selection
// / moving-set rules ("jointed shapes are selected together").
//
// GEOMETRY NOTE: all shape fixtures here are grid-locked like the tools
// build them — curve anchors/control on the lattice, circle center on a
// grid point with a radius quantized to whole grid steps, rect corners
// snapped (cross-reference: shapes.ts builders + the grid contract).
// ─────────────────────────────────────────────────────────────────────────────

// Reusable fixtures — the three shape kinds
const CIRCLE: DrawShape = { kind: 'circle', center: { x: 0, y: 0 }, radius: 200 };
// A BULGING curve: control off the chord — bounds must CONTAIN the control
const CURVE: DrawShape = {
    kind: 'curve',
    start: { x: 0, y: 0 },
    control: { x: 100, y: -100 },
    end: { x: 200, y: 0 },
};
const RECT: DrawShape = { kind: 'rect', min: { x: 200, y: -200 }, max: { x: 300, y: -100 } };

describe('marqueeBounds — drag-direction-proof box normalization', () => {
    it('normalizes a down-right drag (natural order)', () => {
        expect(marqueeBounds({ x: 0, y: 0 }, { x: 100, y: 50 })).toEqual({
            min: { x: 0, y: 0 },
            max: { x: 100, y: 50 },
        });
    });

    it('normalizes an up-left drag (fold-over never inverts the box)', () => {
        expect(marqueeBounds({ x: 100, y: 50 }, { x: 0, y: 0 })).toEqual({
            min: { x: 0, y: 0 },
            max: { x: 100, y: 50 },
        });
    });

    it('a degenerate marquee (start == current) is a zero box', () => {
        expect(marqueeBounds({ x: 40, y: -40 }, { x: 40, y: -40 })).toEqual({
            min: { x: 40, y: -40 },
            max: { x: 40, y: -40 },
        });
    });
});

describe('shapeBounds — axis-aligned world box over the shape nodes', () => {
    it('a circle spans the full diameter (rims bound the outline)', () => {
        expect(shapeBounds(CIRCLE)).toEqual({
            min: { x: -200, y: -200 },
            max: { x: 200, y: 200 },
        });
    });

    it('a bulging curved line contains its control node', () => {
        expect(shapeBounds(CURVE)).toEqual({
            min: { x: 0, y: -100 },
            max: { x: 200, y: 0 },
        });
    });

    it('a rectangle returns its corners verbatim (already normalized)', () => {
        expect(shapeBounds(RECT)).toEqual({
            min: { x: 200, y: -200 },
            max: { x: 300, y: -100 },
        });
    });
});

describe('boundsIntersect — inclusive overlap (touching counts)', () => {
    it('overlapping boxes intersect', () => {
        expect(
            boundsIntersect(
                { min: { x: 0, y: 0 }, max: { x: 100, y: 100 } },
                { min: { x: 50, y: 50 }, max: { x: 150, y: 150 } },
            ),
        ).toBe(true);
    });

    it('merely TOUCHING at an edge or corner picks too (drag a sliver across)', () => {
        expect(
            boundsIntersect(
                { min: { x: 0, y: 0 }, max: { x: 100, y: 100 } },
                { min: { x: 100, y: 40 }, max: { x: 200, y: 60 } },
            ),
        ).toBe(true);
    });

    it('disjoint boxes do not intersect', () => {
        expect(
            boundsIntersect(
                { min: { x: 0, y: 0 }, max: { x: 100, y: 100 } },
                { min: { x: 200, y: 0 }, max: { x: 300, y: 100 } },
            ),
        ).toBe(false);
    });

    it('a degenerate (point) box inside another intersects', () => {
        expect(
            boundsIntersect(
                { min: { x: 0, y: 0 }, max: { x: 100, y: 100 } },
                { min: { x: 40, y: 40 }, max: { x: 40, y: 40 } },
            ),
        ).toBe(true);
    });
});

describe('movingSetOf — the bond-group union ("jointed selected together")', () => {
    const BONDS: DrawBond[] = [
        [{ shapeIndex: 0, nodeId: 'end' }, { shapeIndex: 1, nodeId: 'start' }],
        [{ shapeIndex: 1, nodeId: 'end' }, { shapeIndex: 2, nodeId: 'a' }],
    ];

    it('expands one seed through the whole bond chain (transitive)', () => {
        expect(movingSetOf(BONDS, [0])).toEqual([0, 1, 2]);
    });

    it('unions multiple seeds and stays sorted + dedupe-free', () => {
        // Shape 3 is a lone shape joining the set
        expect(movingSetOf(BONDS, [3, 0])).toEqual([0, 1, 2, 3]);
        // Both ends of one chain dedupe into the same single chain
        expect(movingSetOf(BONDS, [0, 2])).toEqual([0, 1, 2]);
    });

    it('unbonded seeds stand alone', () => {
        expect(movingSetOf([], [4, 2])).toEqual([2, 4]);
    });
});

describe('selectShapesInBounds — the marquee release rule', () => {
    it('picks every shape the box touches (union across kinds)', () => {
        // Box touching all three fixtures
        expect(
            selectShapesInBounds([CIRCLE, CURVE, RECT], [], {
                min: { x: -10, y: -210 },
                max: { x: 80, y: 10 },
            }),
        ).toEqual([0, 1]);
    });

    it('expands a box round ONE jointed member into its partner', () => {
        // Line 0 bonded to circle 1; the box covers only the LINE
        const bonds: DrawBond[] = [
            [{ shapeIndex: 0, nodeId: 'end' }, { shapeIndex: 1, nodeId: 'e' }],
        ];
        const line: DrawShape = {
            kind: 'curve',
            start: { x: -300, y: 0 },
            control: { x: -250, y: 0 },
            end: { x: -200, y: 0 },
        };
        expect(
            selectShapesInBounds([line, CIRCLE], bonds, {
                min: { x: -310, y: -50 },
                max: { x: -290, y: 50 },
            }),
        ).toEqual([0, 1]);
    });

    it('selects nothing on an empty region (the click-to-deselect case)', () => {
        expect(
            selectShapesInBounds([CIRCLE, CURVE, RECT], [], {
                min: { x: 1000, y: 1000 },
                max: { x: 1100, y: 1100 },
            }),
        ).toEqual([]);
    });
});
