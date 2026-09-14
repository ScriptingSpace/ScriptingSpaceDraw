import { describe, it, expect } from 'vitest';
import {
    applyPan,
    applyZoom,
    canvasToScreen,
    clampScale,
    createInitialTransform,
    formatExponent,
    gridLineCount,
    gridOffset,
    GRID_SCREEN_SPACING,
    normalizeWheelFactor,
    SCALE_MAX,
    SCALE_MIN,
    screenToCanvas,
    WHEEL_ZOOM_FACTOR,
} from './canvasTransform';

// Exactness helpers — the assertions below hardcode exact expected values.
// They were computed once with node (the deterministic-math rule: read the
// input, know the answer). E.g. 1.2² = 1.44 (as a double: 1.4399999999999999).

describe('canvasTransform — screen/canvas mapping', () => {
    it('maps screen→canvas and back (round trip) at scale 1', () => {
        const transform = { x: -400, y: -300, scale: 1 };
        // screen 400,300 → canvas 0,0 (origin at viewport center)
        expect(screenToCanvas({ x: 400, y: 300 }, transform)).toEqual({ x: 0, y: 0 });
        expect(canvasToScreen({ x: 0, y: 0 }, transform)).toEqual({ x: 400, y: 300 });
    });

    it('maps screen→canvas at scale 2 (zoomed in halves the world window)', () => {
        const transform = { x: 0, y: 0, scale: 2 };
        expect(screenToCanvas({ x: 100, y: 50 }, transform)).toEqual({ x: 50, y: 25 });
        expect(canvasToScreen({ x: 50, y: 25 }, transform)).toEqual({ x: 100, y: 50 });
    });

    it('maps screen→canvas at scale 0.5 (zoomed out doubles the world window)', () => {
        const transform = { x: 0, y: 0, scale: 0.5 };
        expect(screenToCanvas({ x: 100, y: 50 }, transform)).toEqual({ x: 200, y: 100 });
        expect(canvasToScreen({ x: 200, y: 100 }, transform)).toEqual({ x: 100, y: 50 });
    });
});

describe('canvasTransform — zoom at pointer (pin contract)', () => {
    it('keeps the canvas point under the cursor fixed while zooming in', () => {
        // Viewport center anchor, scale 1 → 1.2 (one WHEEL_ZOOM_FACTOR step)
        const before = { x: -400, y: -300, scale: 1 };
        const after = applyZoom(before, WHEEL_ZOOM_FACTOR, { x: 400, y: 300 });
        expect(after.scale).toBe(1.2);
        // The canvas point at the anchor is unchanged
        expect(screenToCanvas({ x: 400, y: 300 }, before)).toEqual(
            screenToCanvas({ x: 400, y: 300 }, after),
        );
        // Exact pan: x = 400/1 − 400/1.2 + (−400) = −333.333…
        expect(after.x).toBeCloseTo(-400 - 400 / 1.2 + 400 / 1, 10);
        expect(after.y).toBeCloseTo(-300 - 300 / 1.2 + 300 / 1, 10);
    });

    it('keeps the canvas point under the cursor fixed while zooming out', () => {
        const before = { x: 0, y: 0, scale: 2 };
        const after = applyZoom(before, 1 / WHEEL_ZOOM_FACTOR, { x: 100, y: 80 });
        expect(screenToCanvas({ x: 100, y: 80 }, before)).toEqual(
            screenToCanvas({ x: 100, y: 80 }, after),
        );
        // 2 / 1.2 = 1.6666666666666667 (exact double)
        expect(after.scale).toBe(2 / WHEEL_ZOOM_FACTOR);
    });

    it('round-trips zoom in + zoom out at the same anchor back to the start', () => {
        const start = { x: -123.5, y: 88.25, scale: 1 };
        const zoomedIn = applyZoom(start, WHEEL_ZOOM_FACTOR, { x: 250, y: 140 });
        const back = applyZoom(zoomedIn, 1 / WHEEL_ZOOM_FACTOR, { x: 250, y: 140 });
        // Round trip through the ×1.2 / ÷1.2 pair accumulates one ULP of
        // scale error and ~1e-13 of pan drift — the exact double-math floor
        expect(back.scale).toBeCloseTo(1, 12);
        expect(back.x).toBeCloseTo(start.x, 12);
        expect(back.y).toBeCloseTo(start.y, 12);
    });

    it('clamps at SCALE_MAX and keeps the cursor pinned to the clamped scale', () => {
        // SCALE_MAX × 1.2 overflows to a value ABOVE SCALE_MAX but still
        // below the IEEE double wall (1.2e+300 < 1.7976931348623157e+308) —
        // the clamp (not the float wall) is what stops the growth
        const before = { x: 0, y: 0, scale: SCALE_MAX };
        const after = applyZoom(before, WHEEL_ZOOM_FACTOR, { x: 100, y: 100 });
        expect(after.scale).toBe(SCALE_MAX);
        // Pin uses the clamped scale → the anchor does not move at all
        expect(after.x).toBe(0);
        expect(after.y).toBe(0);
    });

    it('clamps at SCALE_MIN and keeps the cursor pinned to the clamped scale', () => {
        const before = { x: 0, y: 0, scale: SCALE_MIN };
        const after = applyZoom(before, 1 / WHEEL_ZOOM_FACTOR, { x: 100, y: 100 });
        expect(after.scale).toBe(SCALE_MIN);
        expect(after.x).toBe(0);
        expect(after.y).toBe(0);
    });
});

describe('canvasTransform — pan', () => {
    it('shifts the pan opposite to the drag direction (grab-the-paper)', () => {
        const before = { x: -400, y: -300, scale: 1 };
        expect(applyPan(before, 10, -5)).toEqual({ x: -410, y: -295, scale: 1 });
    });

    it('panning does not touch the scale', () => {
        const before = { x: 0, y: 0, scale: 12345 };
        expect(applyPan(before, 50, 50).scale).toBe(12345);
    });

    it('pan + inverse pan restores the original transform', () => {
        const start = { x: -17.5, y: 900.125, scale: 3.5 };
        const moved = applyPan(applyPan(start, 33, -21), -33, 21);
        expect(moved).toEqual(start);
    });
});

describe('canvasTransform — one-size grid helpers', () => {
    it('GRID_SCREEN_SPACING is the single constant grid size', () => {
        expect(GRID_SCREEN_SPACING).toBe(64);
    });

    it('gridOffset wraps any origin position into [0, 64)', () => {
        // Origin exactly on a line → offset 0
        expect(gridOffset(0)).toBe(0);
        expect(gridOffset(64)).toBe(0);
        expect(gridOffset(-64)).toBe(0);
        // Origin between lines → offset = origin mod 64
        expect(gridOffset(16)).toBe(16);
        expect(gridOffset(70)).toBe(6);
        // Negative origins wrap forward (double-mod keeps the result positive)
        expect(gridOffset(-16)).toBe(48);
        // -1000400 = −15632×64 + 48 → the line at-or-before it sits 48px back
        expect(gridOffset(-1000400)).toBe(48);
    });

    it('gridLineCount is bounded by the viewport size (+1 boundary line)', () => {
        expect(gridLineCount(800)).toBe(14); // ceil(800/64)=12.5→13, +1 = 14
        expect(gridLineCount(600)).toBe(11); // ceil(600/64)=9.375→10, +1 = 11
        expect(gridLineCount(0)).toBe(1);
        expect(gridLineCount(64)).toBe(2);
    });
});

describe('canvasTransform — scale clamping', () => {
    it('keeps valid scales untouched', () => {
        expect(clampScale(1)).toBe(1);
        expect(clampScale(0.5)).toBe(0.5);
        expect(clampScale(1e100)).toBe(1e100);
        expect(clampScale(1e-100)).toBe(1e-100);
    });

    it('clamps to the float edge and repairs pathological inputs', () => {
        expect(clampScale(2e300)).toBe(SCALE_MAX);
        expect(clampScale(1e-320)).toBe(SCALE_MIN);
        expect(clampScale(0)).toBe(1);
        // NaN passes the !isFinite guard first → 1
        expect(clampScale(Number.NaN)).toBe(1);
        // Infinity is finite-guarded OUT (returns 1) — NOT clamped to MAX
        expect(clampScale(Number.POSITIVE_INFINITY)).toBe(1);
    });
});

describe('canvasTransform — wheel normalization', () => {
    it('one full notch (100px delta) produces exactly one WHEEL_ZOOM_FACTOR step', () => {
        expect(normalizeWheelFactor(100)).toBe(WHEEL_ZOOM_FACTOR);
        expect(normalizeWheelFactor(-100)).toBe(1 / WHEEL_ZOOM_FACTOR);
    });

    it('fractional deltas produce fractional steps (trackpad smoothness)', () => {
        // 50px → half notch → sqrt(1.2)
        expect(normalizeWheelFactor(50)).toBeCloseTo(Math.sqrt(1.2), 12);
        expect(normalizeWheelFactor(0)).toBe(1);
    });

    it('giant deltas clamp to ±3 notches', () => {
        expect(normalizeWheelFactor(10000)).toBe(Math.pow(WHEEL_ZOOM_FACTOR, 3));
        expect(normalizeWheelFactor(-10000)).toBe(Math.pow(WHEEL_ZOOM_FACTOR, -3));
    });
});

describe('canvasTransform — HUD + initial state', () => {
    it('createInitialTransform centers the origin at scale 1', () => {
        expect(createInitialTransform(800, 600)).toEqual({ x: -400, y: -300, scale: 1 });
        expect(createInitialTransform(1920, 1080)).toEqual({ x: -960, y: -540, scale: 1 });
    });

    it('formatExponent renders scientific notation with 4 significant digits', () => {
        expect(formatExponent(1)).toBe('×1.000e+0');
        expect(formatExponent(1.2)).toBe('×1.200e+0');
        expect(formatExponent(1234.5)).toBe('×1.235e+3');
        expect(formatExponent(0.001)).toBe('×1.000e-3');
        // Float-edge scales stay readable
        expect(formatExponent(1e300)).toBe('×1.000e+300');
        expect(formatExponent(1e-300)).toBe('×1.000e-300');
        // Pathological inputs clamp instead of producing NaN text
        expect(formatExponent(Number.NaN)).toBe('×1.000e+0');
    });
});
