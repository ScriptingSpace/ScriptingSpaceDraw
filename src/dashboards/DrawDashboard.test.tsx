import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { DrawDashboard } from './DrawDashboard';
import { screenToCanvas, GRID_SCREEN_SPACING } from '../functions/canvasTransform';

afterEach(() => {
    cleanup();
});

// Installs a deterministic getBoundingClientRect on the canvas surface
// element (must be called after render). The canvas fills the whole
// viewport (no header/footer) → the surface IS the 800×600 viewport.
const stubSurfaceRect = () => {
    const surface = screen.getByTestId('canvas-surface');
    surface.getBoundingClientRect = () =>
        ({
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 800,
            bottom: 600,
            width: 800,
            height: 600,
            toJSON: () => ({}),
        }) as DOMRect;
    return surface;
};

// Reads the HUD scale text ("×1.200e+0")
const readHudScale = (): string => screen.getByTestId('hud-scale').textContent ?? '';

// Reads the world origin's screen position off the horizontal origin cross
// (x1 = origin.x − 8 → origin.x = x1 + 8; y = y1)
const readOriginCross = (): { x: number; y: number } => {
    const cross = screen.getByTestId('origin-cross-h');
    const x1 = Number(cross.getAttribute('x1'));
    const y1 = Number(cross.getAttribute('y1'));
    return { x: x1 + 8, y: y1 };
};

// Reads the x positions of all vertical GRID lines in the layer (excluding
// the origin-cross lines, which are identified by strokeWidth=2)
const readVerticalLineXs = (): number[] => {
    const layer = screen.getByTestId('grid-layer');
    return Array.from(layer.querySelectorAll('line'))
        .filter(
            (line) =>
                line.getAttribute('x1') === line.getAttribute('x2') &&
                line.getAttribute('stroke-width') !== '2',
        )
        .map((line) => Number(line.getAttribute('x1')));
};

// Reads the y positions of all horizontal GRID lines (excluding the
// origin-cross lines, which are identified by strokeWidth=2)
const readHorizontalLineYs = (): number[] => {
    const layer = screen.getByTestId('grid-layer');
    return Array.from(layer.querySelectorAll('line'))
        .filter(
            (line) =>
                line.getAttribute('y1') === line.getAttribute('y2') &&
                line.getAttribute('stroke-width') !== '2',
        )
        .map((line) => Number(line.getAttribute('y1')));
};

// Gaps between consecutive sorted line positions — asserts the grid's
// on-screen spacing (the "one size" contract)
const readGaps = (positions: number[]): number[] => {
    const sorted = [...positions].sort((a, b) => a - b);
    return sorted.slice(1).map((value, index) => value - sorted[index]);
};

describe('DrawDashboard — shell', () => {
    it('renders the floating title, canvas surface and HUD — NO header/footer bars', () => {
        render(<DrawDashboard />);
        stubSurfaceRect();

        // Floating title top-left with the version from __APP_VERSION__
        expect(screen.getByTestId('floating-title').textContent).toBe(
            'Draw Dashboard v1.0.0',
        );
        expect(screen.getByTestId('canvas-surface')).toBeDefined();
        expect(screen.getByTestId('grid-svg')).toBeDefined();
        expect(screen.getByTestId('zoom-hud')).toBeDefined();
        expect(screen.getByTestId('hud-scale').textContent).toBe('×1.000e+0');
        // No header/footer testids exist anymore
        expect(screen.queryByTestId('dashboard-header')).toBeNull();
        expect(screen.queryByTestId('dashboard-footer')).toBeNull();
        expect(screen.queryByTestId('footer-version')).toBeNull();
    });

    it('starts with the world origin at the viewport center', () => {
        render(<DrawDashboard />);
        stubSurfaceRect();

        const origin = readOriginCross();
        expect(origin).toEqual({ x: 400, y: 300 });
    });
});

describe('DrawDashboard — the grid is ONE size (never resizes)', () => {
    it('renders vertical + horizontal lines at the constant 64px spacing', () => {
        render(<DrawDashboard />);
        stubSurfaceRect();

        // Every gap between consecutive vertical/horizontal lines is exactly
        // GRID_SCREEN_SPACING (64px) — the one grid size
        const vGaps = readGaps(readVerticalLineXs());
        const hGaps = readGaps(readHorizontalLineYs());
        expect(vGaps.every((gap) => gap === GRID_SCREEN_SPACING)).toBe(true);
        expect(hGaps.every((gap) => gap === GRID_SCREEN_SPACING)).toBe(true);
        // Line counts: gridLineCount(800)+1 = 15 vertical, gridLineCount(600)+1 = 12
        // horizontal (+1 slack each for the boundary line beyond the edge)
        expect(readVerticalLineXs().length).toBe(15);
        expect(readHorizontalLineYs().length).toBe(12);
    });

    it('keeps the SAME 64px spacing after zooming in and out (no re-leveling)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Zoom in 10 notches, then out 25 notches — the gaps must STILL be
        // exactly 64px. The grid never changes size; only its offset slides.
        for (let index = 0; index < 10; index++) {
            fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaY: 100 });
        }
        for (let index = 0; index < 25; index++) {
            fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaY: -100 });
        }
        const vGaps = readGaps(readVerticalLineXs());
        const hGaps = readGaps(readHorizontalLineYs());
        expect(vGaps.every((gap) => gap === GRID_SCREEN_SPACING)).toBe(true);
        expect(hGaps.every((gap) => gap === GRID_SCREEN_SPACING)).toBe(true);
        // Same bounded line counts — no extra lines appear at any zoom
        expect(readVerticalLineXs().length).toBe(15);
        expect(readHorizontalLineYs().length).toBe(12);
    });

    it('slides (not resizes) while panning: the origin follows the hand', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Pan 100px right, 50px down → origin moves +100/+50 on screen
        fireEvent.keyDown(window, { code: 'Space' });
        fireEvent.pointerDown(surface, { clientX: 300, clientY: 200, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 250 });
        fireEvent.pointerUp(surface, {});
        fireEvent.keyUp(window, { code: 'Space' });

        expect(readOriginCross()).toEqual({ x: 500, y: 350 });
        // Spacing unchanged
        const vGaps = readGaps(readVerticalLineXs());
        expect(vGaps.every((gap) => gap === GRID_SCREEN_SPACING)).toBe(true);
    });

    it('anchors the origin exactly on a grid intersection at every zoom', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // After ANY zoom, the origin's screen position must be an exact
        // multiple of GRID_SCREEN_SPACING away from every line origin —
        // i.e. origin.x mod 64 must equal the first line's offset. Since
        // lines are placed at multiples of 64 minus the origin's own
        // offset, the origin ALWAYS lands on an intersection: the line
        // set must contain a line exactly at origin.x and origin.y.
        for (let index = 0; index < 7; index++) {
            fireEvent.wheel(surface, { clientX: 250, clientY: 180, deltaY: 100 });
        }
        const origin = readOriginCross();
        const xs = readVerticalLineXs();
        const ys = readHorizontalLineYs();
        expect(xs).toContain(origin.x);
        expect(ys).toContain(origin.y);
    });
});

describe('DrawDashboard — wheel zoom', () => {
    it('zooms in at the pointer on one wheel notch (×1.2)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Wheel at the viewport center (400, 300) — scale 1 → 1.2, origin
        // stays pinned under the cursor (center anchor = no pan shift; the
        // residue is one ULP of double-math drift)
        fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaY: 100 });
        expect(readHudScale()).toBe('×1.200e+0');
        const origin = readOriginCross();
        expect(origin.x).toBeCloseTo(400, 9);
        expect(origin.y).toBe(300);
    });

    it('zooms out on a negative wheel notch (÷1.2)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaY: -100 });
        expect(readHudScale()).toBe('×8.333e-1');
    });

    it('pins the canvas point under an OFF-CENTER cursor while zooming', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Wheel at (200, 150): the canvas point under the cursor before the
        // zoom is (−200, −150) (transform −400/−300, scale 1). After one
        // ×1.2 step that same canvas point must still sit at screen
        // (200, 150) — the origin cross moves accordingly.
        const before = readOriginCross();
        fireEvent.wheel(surface, { clientX: 200, clientY: 150, deltaY: 100 });
        const after = readOriginCross();

        // Canvas point under the cursor is INVARIANT
        const transformBefore = { x: -400, y: -300, scale: 1 };
        const pinned = screenToCanvas({ x: 200, y: 150 }, transformBefore);
        expect(pinned).toEqual({ x: -200, y: -150 });
        // The origin moved AWAY from the cursor (zoom-in expands the world
        // around the anchor; the cursor sits left/above the origin, so the
        // origin is pushed right/down): (400,300) → (440, 330)
        expect(after.x).toBeGreaterThan(before.x);
        expect(after.y).toBeGreaterThan(before.y);
        // Exact new origin position: pan after zoom at (200,150):
        // x = 200/1 − 200/1.2 + (−400) = −366.666… → origin.x = 366.666… × 1.2 = 440
        // y = 150/1 − 150/1.2 + (−300) = −275 → origin.y = 275 × 1.2 = 330
        expect(after.x).toBeCloseTo(440, 6);
        expect(after.y).toBeCloseTo(330, 6);
    });

    it('reaches unbounded magnification over repeated notches (no zoom ceiling)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // 400 notches of ×1.2 → scale 1.2^400 ≈ 4.7e31 — far past any
        // "reasonable" product limit; the only ceiling is the float edge
        for (let index = 0; index < 400; index++) {
            fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaY: 100 });
        }
        expect(readHudScale()).toBe('×4.704e+31');
    });

    it('reaches unbounded minification over repeated notches (no zoom floor)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // 400 notches of ÷1.2 → scale 1.2^-400 ≈ 2.13e-32
        for (let index = 0; index < 400; index++) {
            fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaY: -100 });
        }
        expect(readHudScale()).toBe('×2.126e-32');
    });
});

describe('DrawDashboard — panning', () => {
    it('pans with space + drag (grab-the-paper: origin follows the hand)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Arm space mode
        fireEvent.keyDown(window, { code: 'Space' });

        // Drag 100px right, 50px down from (300, 200)
        fireEvent.pointerDown(surface, { clientX: 300, clientY: 200, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 250 });
        fireEvent.pointerUp(surface, {});

        // Paper follows the hand → origin moves +100/+50: (400,300) → (500, 350)
        expect(readOriginCross()).toEqual({ x: 500, y: 350 });
        // Scale unchanged
        expect(readHudScale()).toBe('×1.000e+0');

        fireEvent.keyUp(window, { code: 'Space' });
    });

    it('pans with middle-button drag without space held', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.pointerDown(surface, { clientX: 300, clientY: 200, button: 1 });
        fireEvent.pointerMove(surface, { clientX: 250, clientY: 260 });
        fireEvent.pointerUp(surface, {});

        // Drag −50/+60 → origin moves −50/+60: (400,300) → (350, 360)
        expect(readOriginCross()).toEqual({ x: 350, y: 360 });
    });

    it('ignores plain left-drag without space (leaves zoom to the wheel)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.pointerDown(surface, { clientX: 300, clientY: 200, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 250 });
        fireEvent.pointerUp(surface, {});

        expect(readOriginCross()).toEqual({ x: 400, y: 300 });
    });

    it('stops panning when the pointer leaves the surface', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.keyDown(window, { code: 'Space' });
        fireEvent.pointerDown(surface, { clientX: 300, clientY: 200, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 250 });
        // Pointer leaves mid-drag → pan ends; the next move is ignored
        fireEvent.pointerLeave(surface, {});
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.keyUp(window, { code: 'Space' });

        expect(readOriginCross()).toEqual({ x: 500, y: 350 });
    });
});

describe('DrawDashboard — HUD reset', () => {
    it('snaps back to origin-centered, scale 1 after zoom + pan', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Mess up the view: zoom out 3 notches + pan
        for (let index = 0; index < 3; index++) {
            fireEvent.wheel(surface, { clientX: 200, clientY: 150, deltaY: -100 });
        }
        fireEvent.keyDown(window, { code: 'Space' });
        fireEvent.pointerDown(surface, { clientX: 300, clientY: 200, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 400 });
        fireEvent.pointerUp(surface, {});
        fireEvent.keyUp(window, { code: 'Space' });
        expect(readHudScale()).not.toBe('×1.000e+0');

        // Reset → exactly the initial transform
        fireEvent.click(screen.getByTestId('hud-reset'));
        expect(readHudScale()).toBe('×1.000e+0');
        expect(readOriginCross()).toEqual({ x: 400, y: 300 });
    });
});

describe('DrawDashboard — grid line culling', () => {
    it('keeps the grid DOM bounded regardless of pan distance', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Pan 1,000,000 canvas-units away — the grid must NOT grow: only
        // the lines intersecting the viewport render (bounded count)
        fireEvent.keyDown(window, { code: 'Space' });
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        // One huge synthetic move: 1e6 px
        fireEvent.pointerMove(surface, { clientX: 400 + 1e6, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        fireEvent.keyUp(window, { code: 'Space' });

        // Line count: (gridLineCount(800)+1) vertical + (gridLineCount(600)+1)
        // horizontal = 15 + 12 = 27 lines, PLUS the 2 origin-cross lines
        // (hidden but still mounted) = 29 total in the layer
        const layer = screen.getByTestId('grid-layer');
        expect(layer.children.length).toBe(29);
        // The origin cross is long gone off-screen → hidden (transparent)
        const cross = screen.getByTestId('origin-cross-h');
        expect(cross.getAttribute('stroke')).toBe('transparent');
    });
});
