import { describe, it, expect } from 'vitest';
import {
    createCircleShape,
    createCurveShape,
    createRectShape,
    defaultCurveControl,
    quantizeRadius,
    adjustShape,
    distanceToShape,
    shapeInk,
    shapeNodes,
    moveShape,
    shapeToScreen,
} from './shapes';

// Deterministic transform for projection tests (origin at screen (400, 300),
// scale 1) — matches the initial dashboard state
const TRANSFORM_1 = { x: -400, y: -300, scale: 1 };
const TRANSFORM_2 = { x: -400, y: -300, scale: 2 };

// GRID CONTRACT: every builder snaps anchors to the lattice (multiples of
// BASE_SPACING = 100). Tests use EXACT lattice points or expect the snap.

describe('shapes — snap + quantize helpers', () => {
    it('quantizeRadius rounds a distance to whole grid steps (0 stays 0)', () => {
        expect(quantizeRadius(0)).toBe(0);
        expect(quantizeRadius(49)).toBe(0); // below half a cell → no step
        expect(quantizeRadius(50)).toBe(100); // half a cell rounds UP
        expect(quantizeRadius(149)).toBe(100);
        expect(quantizeRadius(280)).toBe(300);
    });

    it('defaultCurveControl bows perpendicular by half the chord, snapped', () => {
        // Horizontal chord (0,0) → (200,0): mid (100,0), perp (0,1),
        // bend 100 → candidate (100, 100) — already on the grid
        expect(defaultCurveControl({ x: 0, y: 0 }, { x: 200, y: 0 })).toEqual({
            x: 100,
            y: 100,
        });
    });

    it('defaultCurveControl snaps the bend onto the lattice for odd chords', () => {
        // Chord (0,0) → (300,0): mid (150,0), candidate (150,150) → snaps
        // to (200,200) (Math.round(1.5) = 2 in both axes)
        expect(defaultCurveControl({ x: 0, y: 0 }, { x: 300, y: 0 })).toEqual({
            x: 200,
            y: 200,
        });
    });
});

describe('shapes — createCurveShape (the Line tool draws a curve)', () => {
    it('snaps both anchors to the grid points', () => {
        // (83, 91) → snaps to (100,100); (521, 100) → snaps to (500,100).
        // Four steps → bent control: mid (300,100) + perpendicular bend
        // (chord/2 = 200) → (300, 300) — already on the lattice
        expect(createCurveShape({ x: 83, y: 91 }, { x: 521, y: 100 })).toEqual({
            kind: 'curve',
            start: { x: 100, y: 100 },
            control: { x: 300, y: 300 },
            end: { x: 500, y: 100 },
        });
    });

    it('multi-step chords get the bent default control (curve, not sharp)', () => {
        // Two horizontal steps: control bows to (100,100)
        expect(createCurveShape({ x: 0, y: 0 }, { x: 200, y: 0 })).toEqual({
            kind: 'curve',
            start: { x: 0, y: 0 },
            control: { x: 100, y: 100 },
            end: { x: 200, y: 0 },
        });
    });

    it('single-step chords stay straight (control at the true midpoint)', () => {
        // One horizontal step — no bend yet. (40,10)→snap (0,0);
        // (140,20)→snap (100,0); control = true midpoint (50,0)
        expect(createCurveShape({ x: 40, y: 10 }, { x: 140, y: 20 })).toEqual({
            kind: 'curve',
            start: { x: 0, y: 0 },
            control: { x: 50, y: 0 },
            end: { x: 100, y: 0 },
        });
        // One diagonal step is still a single step (Chebyshev) — straight
        expect(createCurveShape({ x: 0, y: 0 }, { x: 100, y: 100 })).toEqual({
            kind: 'curve',
            start: { x: 0, y: 0 },
            control: { x: 50, y: 50 },
            end: { x: 100, y: 100 },
        });
    });

    it('returns null when the drag never crosses a grid half-cell', () => {
        // Both ends snap to (100,100) → zero-step chord
        expect(createCurveShape({ x: 60, y: 80 }, { x: 140, y: 90 })).toBeNull();
    });
});

describe('shapes — createCircleShape', () => {
    it('snaps the center to the grid and quantizes the radius to grid steps', () => {
        // Center (120, 80) → snaps to (100,100); edge (260, 100) → raw
        // radius 160 → quantizes to 200
        expect(createCircleShape({ x: 120, y: 80 }, { x: 260, y: 100 })).toEqual({
            kind: 'circle',
            center: { x: 100, y: 100 },
            radius: 200,
        });
    });

    it('keeps an on-grid center untouched', () => {
        expect(createCircleShape({ x: 400, y: 300 }, { x: 450, y: 300 })).toEqual({
            kind: 'circle',
            center: { x: 400, y: 300 },
            radius: 100, // raw 50 (half a cell) rounds UP to one step
        });
    });

    it('returns null for a zero quantized radius (click without drag)', () => {
        // Both snap to (0,0); the raw center→edge distance 44.7 is below a
        // half cell → radius 0
        expect(createCircleShape({ x: 10, y: 10 }, { x: 40, y: 20 })).toBeNull();
    });
});

describe('shapes — createRectShape', () => {
    it('snaps both corners to the grid and normalizes (drag direction free)', () => {
        // a=(90,90)→(100,100); b=(440,31)→(400,0)
        expect(createRectShape({ x: 90, y: 90 }, { x: 440, y: 31 })).toEqual({
            kind: 'rect',
            min: { x: 100, y: 0 },
            max: { x: 400, y: 100 },
        });
        // Same corners reversed — identical rect
        expect(createRectShape({ x: 440, y: 31 }, { x: 90, y: 90 })).toEqual({
            kind: 'rect',
            min: { x: 100, y: 0 },
            max: { x: 400, y: 100 },
        });
    });

    it('returns null when both corners snap to the same grid point', () => {
        // (10,10) and (49,49) both snap to (0,0) → zero-area
        expect(createRectShape({ x: 10, y: 10 }, { x: 49, y: 49 })).toBeNull();
    });
});

describe('shapes — shapeNodes (adjustment handles)', () => {
    it('a curve exposes start + hollow control + end', () => {
        const shape = createCurveShape({ x: 0, y: 0 }, { x: 200, y: 0 })!;
        expect(shapeNodes(shape)).toEqual([
            { id: 'start', point: { x: 0, y: 0 } },
            { id: 'control', point: { x: 100, y: 100 }, hollow: true },
            { id: 'end', point: { x: 200, y: 0 } },
        ]);
    });

    it('a circle exposes its center and the radius edge node (3 o\'clock)', () => {
        const shape = createCircleShape({ x: 400, y: 300 }, { x: 500, y: 300 })!;
        expect(shapeNodes(shape)).toEqual([
            { id: 'center', point: { x: 400, y: 300 } },
            { id: 'radius', point: { x: 500, y: 300 } },
        ]);
    });

    it('a rect exposes its four corners clockwise from min-min', () => {
        const shape = createRectShape({ x: 100, y: 100 }, { x: 300, y: 200 })!;
        expect(shapeNodes(shape)).toEqual([
            { id: 'a', point: { x: 100, y: 100 } },
            { id: 'b', point: { x: 300, y: 100 } },
            { id: 'c', point: { x: 300, y: 200 } },
            { id: 'd', point: { x: 100, y: 200 } },
        ]);
    });
});

describe('shapes — adjustShape (node drags)', () => {
    it('curve: dragging an endpoint snaps it and keeps other nodes absolute', () => {
        const shape = createCurveShape({ x: 0, y: 0 }, { x: 200, y: 0 })!;
        // Drag the end toward (400, 300) → snaps to (400, 300); control
        // stays where the shape's curve put it
        expect(adjustShape(shape, 'end', { x: 400, y: 300 })).toEqual({
            kind: 'curve',
            start: { x: 0, y: 0 },
            control: { x: 100, y: 100 },
            end: { x: 400, y: 300 },
        });
    });

    it('curve: dragging the bend node re-curves it (snapped)', () => {
        const shape = createCurveShape({ x: 0, y: 0 }, { x: 200, y: 0 })!;
        // Drag the control toward (150, -45) → snaps to (200, 0)... on the
        // chord line → straightens the curve
        expect(adjustShape(shape, 'control', { x: 150, y: -45 })).toEqual({
            kind: 'curve',
            start: { x: 0, y: 0 },
            control: { x: 200, y: 0 },
            end: { x: 200, y: 0 },
        });
    });

    it('circle: dragging the center node snaps the center, radius follows', () => {
        const shape = createCircleShape({ x: 400, y: 300 }, { x: 500, y: 300 })!;
        expect(adjustShape(shape, 'center', { x: 455, y: 250 })).toEqual({
            kind: 'circle',
            center: { x: 500, y: 300 }, // snapToGrid(455, 250)
            radius: 100,
        });
    });

    it('circle: dragging the radius node re-quantizes with a 1-step floor', () => {
        const shape = createCircleShape({ x: 400, y: 300 }, { x: 500, y: 300 })!;
        // Pointer at raw distance 38 → below half a cell → clamped to 1 step
        expect(adjustShape(shape, 'radius', { x: 438, y: 300 })).toEqual({
            kind: 'circle',
            center: { x: 400, y: 300 },
            radius: 100,
        });
        // Pointer at raw distance 260 → 3 steps
        expect(adjustShape(shape, 'radius', { x: 660, y: 300 })).toEqual({
            kind: 'circle',
            center: { x: 400, y: 300 },
            radius: 300,
        });
    });

    it('rect: dragging a corner keeps the opposite corner and re-normalizes', () => {
        const shape = createRectShape({ x: 100, y: 100 }, { x: 300, y: 200 })!;
        // Drag corner 'a' (min-min) across to (500, 50) — snapped (500,100):
        // folds the rect over corner 'c'
        expect(adjustShape(shape, 'a', { x: 500, y: 50 })).toEqual({
            kind: 'rect',
            min: { x: 300, y: 100 },
            max: { x: 500, y: 200 },
        });
        // Drag corner 'd' (min-max) to (200, 350) — snapped (200,400):
        // folds over corner 'b' (fixed at max x, min y)
        expect(adjustShape(shape, 'd', { x: 200, y: 350 })).toEqual({
            kind: 'rect',
            min: { x: 200, y: 100 },
            max: { x: 300, y: 400 },
        });
    });
});

describe('shapes — moveShape (whole-shape grab-move)', () => {
    it('translates a curve by an exact lattice delta', () => {
        const shape = createCurveShape({ x: 0, y: 0 }, { x: 200, y: 0 })!;
        expect(moveShape(shape, 100, 100)).toEqual({
            kind: 'curve',
            start: { x: 100, y: 100 },
            control: { x: 200, y: 200 },
            end: { x: 300, y: 100 },
        });
    });

    it('moves a circle (center) and a rect (both corners) with snap-back', () => {
        const circle = createCircleShape({ x: 400, y: 300 }, { x: 500, y: 300 })!;
        // Drifted delta 95.7 → snaps to 100
        expect(moveShape(circle, 95.7, 0)).toEqual({
            kind: 'circle',
            center: { x: 500, y: 300 },
            radius: 100,
        });

        const rect = createRectShape({ x: 0, y: 0 }, { x: 100, y: 200 })!;
        expect(moveShape(rect, 200, -100)).toEqual({
            kind: 'rect',
            min: { x: 200, y: -100 },
            max: { x: 300, y: 100 },
        });
    });
});

describe('shapes — distanceToShape (the line-grab hit test)', () => {
    it('measures the curve by its geometry (apex is closest)', () => {
        const shape = createCurveShape({ x: 0, y: 0 }, { x: 200, y: 0 })!;
        // The apex sits at (100, 50) (control at (100,100) pulls t=½ up by
        // half the control offset) — measure 0 there, 50 from the apex back
        // onto the chord line, and > 60 far away
        expect(distanceToShape(shape, { x: 100, y: 50 })).toBeCloseTo(0, 6);
        expect(distanceToShape(shape, { x: 100, y: 100 })).toBeCloseTo(50, 4);
        expect(distanceToShape(shape, { x: 100, y: 160 })).toBeGreaterThan(60);
    });

    it('measures a circle by the rim (radius offset)', () => {
        const shape = createCircleShape({ x: 400, y: 300 }, { x: 500, y: 300 })!;
        expect(distanceToShape(shape, { x: 400, y: 400 })).toBe(0); // on the rim
        expect(distanceToShape(shape, { x: 400, y: 450 })).toBe(50); // 50 outside
        expect(distanceToShape(shape, { x: 400, y: 300 })).toBe(100); // dead center
    });

    it('measures a rect by its border (corners project correctly)', () => {
        const shape = createRectShape({ x: 0, y: 0 }, { x: 200, y: 100 })!;
        expect(distanceToShape(shape, { x: 100, y: 0 })).toBe(0); // on an edge
        expect(distanceToShape(shape, { x: 100, y: 40 })).toBe(40); // inside → nearest wall
        expect(distanceToShape(shape, { x: 100, y: 140 })).toBe(40); // outside → nearest edge
        expect(distanceToShape(shape, { x: 250, y: 100 })).toBe(50); // off the corner
    });

    it('shapeInk resolves the stroke color (stamped ink or fallback)', () => {
        const shape = createCircleShape({ x: 400, y: 300 }, { x: 500, y: 300 })!;
        expect(shapeInk(shape, '#a9b1d6')).toBe('#a9b1d6');
        expect(shapeInk({ ...shape, color: '#f7768e' }, '#a9b1d6')).toBe('#f7768e');
    });
});

describe('shapes — shapeToScreen (world → screen projection)', () => {
    // screen = (canvas − pan) × scale; with pan (−400, −300) the world
    // origin sits at screen (400, 300) — world 400 maps to screen 800.
    it('projects a curve node-by-node and carries the color through', () => {
        const shape = { ...createCurveShape({ x: 0, y: 0 }, { x: 200, y: 0 })!, color: '#f7768e' };
        expect(shapeToScreen(shape, TRANSFORM_1)).toEqual({
            kind: 'curve',
            start: { x: 400, y: 300 },
            control: { x: 500, y: 400 },
            end: { x: 600, y: 300 },
            color: '#f7768e',
        });
    });

    it('projects a circle: center moves, radius scales with zoom', () => {
        const shape = createCircleShape({ x: 400, y: 300 }, { x: 500, y: 300 })!;
        expect(shapeToScreen(shape, TRANSFORM_2)).toEqual({
            kind: 'circle',
            center: { x: 1600, y: 1200 },
            radius: 200, // 100 world units × scale 2
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
});
