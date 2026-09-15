import { describe, it, expect } from 'vitest';
import {
    createPathShape,
    createCircleShape,
    createRectShape,
    createLineShape,
    shapeToScreen,
} from './shapes';
import type { DrawPoint } from './shapes';

// Deterministic transform for projection tests (origin at screen (400, 300),
// scale 1) — matches the initial dashboard state
const TRANSFORM_1 = { x: -400, y: -300, scale: 1 };
const TRANSFORM_2 = { x: -400, y: -300, scale: 2 };

describe('shapes — createPathShape (pen)', () => {
    it('builds a path from two or more points', () => {
        const points: DrawPoint[] = [
            { x: 0, y: 0 },
            { x: 10, y: 5 },
            { x: 20, y: -5 },
        ];
        expect(createPathShape(points)).toEqual({
            kind: 'path',
            points,
        });
    });

    it('returns null for a single point (a dot is not a stroke)', () => {
        expect(createPathShape([{ x: 5, y: 5 }])).toBeNull();
    });

    it('returns null for an empty point list', () => {
        expect(createPathShape([])).toBeNull();
    });
});

describe('shapes — createCircleShape', () => {
    it('computes the radius as the distance from center to edge', () => {
        // Center (0,0), edge (30, 40) → radius 50 (3-4-5 triangle ×10)
        expect(createCircleShape({ x: 0, y: 0 }, { x: 30, y: 40 })).toEqual({
            kind: 'circle',
            center: { x: 0, y: 0 },
            radius: 50,
        });
    });

    it('works with a non-origin center', () => {
        expect(createCircleShape({ x: 100, y: 100 }, { x: 100, y: 115 })).toEqual({
            kind: 'circle',
            center: { x: 100, y: 100 },
            radius: 15,
        });
    });

    it('returns null for a zero radius (click without drag)', () => {
        expect(createCircleShape({ x: 10, y: 10 }, { x: 10, y: 10 })).toBeNull();
    });
});

describe('shapes — createRectShape', () => {
    it('normalizes opposite corners regardless of drag direction', () => {
        // Drag up-left: a=(100,100) b=(40,30) → min=(40,30) max=(100,100)
        expect(createRectShape({ x: 100, y: 100 }, { x: 40, y: 30 })).toEqual({
            kind: 'rect',
            min: { x: 40, y: 30 },
            max: { x: 100, y: 100 },
        });
        // Drag down-right: same corners reversed
        expect(createRectShape({ x: 40, y: 30 }, { x: 100, y: 100 })).toEqual({
            kind: 'rect',
            min: { x: 40, y: 30 },
            max: { x: 100, y: 100 },
        });
    });

    it('returns null for a zero-area rect (click without drag)', () => {
        expect(createRectShape({ x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull();
        // Zero in ONE axis is still degenerate
        expect(createRectShape({ x: 5, y: 5 }, { x: 9, y: 5 })).toBeNull();
    });
});

describe('shapes — createLineShape', () => {
    it('builds a line from two distinct endpoints', () => {
        expect(createLineShape({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({
            kind: 'line',
            start: { x: 0, y: 0 },
            end: { x: 10, y: 20 },
        });
    });

    it('returns null for a zero-length line (click without drag)', () => {
        expect(createLineShape({ x: 7, y: 7 }, { x: 7, y: 7 })).toBeNull();
    });
});

describe('shapes — shapeToScreen (world → screen projection)', () => {
    // screen = (canvas − pan) × scale; with pan (−400, −300) the world
    // origin sits at screen (400, 300) — world 400 maps to screen 800.
    it('projects a path point-by-point at scale 1', () => {
        const shape = createPathShape([
            { x: 400, y: 300 },
            { x: 450, y: 350 },
        ])!;
        expect(shapeToScreen(shape, TRANSFORM_1)).toEqual({
            kind: 'path',
            points: [
                { x: 800, y: 600 },
                { x: 850, y: 650 },
            ],
        });
    });

    it('projects a circle: center moves, radius scales with zoom', () => {
        const shape = createCircleShape({ x: 400, y: 300 }, { x: 450, y: 300 })!;
        // radius 50 world units
        expect(shapeToScreen(shape, TRANSFORM_2)).toEqual({
            kind: 'circle',
            center: { x: 1600, y: 1200 },
            radius: 100,
        });
    });

    it('projects a rect corner-by-corner (drag direction preserved)', () => {
        const shape = createRectShape({ x: 400, y: 300 }, { x: 500, y: 400 })!;
        expect(shapeToScreen(shape, TRANSFORM_1)).toEqual({
            kind: 'rect',
            min: { x: 800, y: 600 },
            max: { x: 900, y: 700 },
        });
    });

    it('projects a line endpoint-by-endpoint', () => {
        const shape = createLineShape({ x: 400, y: 300 }, { x: 350, y: 250 })!;
        expect(shapeToScreen(shape, TRANSFORM_1)).toEqual({
            kind: 'line',
            start: { x: 800, y: 600 },
            end: { x: 750, y: 550 },
        });
    });
});
