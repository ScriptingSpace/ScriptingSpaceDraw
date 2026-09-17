import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { DrawDashboard } from './DrawDashboard';
import { screenToCanvas, BASE_SPACING } from '../functions/canvasTransform';
import { formatCoordinate } from '../components/CoordinateHud';

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
// on-screen cell size (the world-anchored contract: gaps = BASE_SPACING ×
// scale, growing when zooming in, shrinking when zooming out)
const readGaps = (positions: number[]): number[] => {
    const sorted = [...positions].sort((a, b) => a - b);
    return sorted.slice(1).map((value, index) => value - sorted[index]);
};

// All gaps uniform within double-precision tolerance? The line positions
// are computed as k × spacing − origin; for non-representable spacings
// (e.g. 100/1.2) the SUBTRACTION of two large rounded products can differ
// from the exact spacing by ~1 ULP (~1e-13 relative). Visually identical;
// asserted with a tight relative tolerance instead of bit equality.
const allGapsEqual = (gaps: number[], expected: number): boolean =>
    gaps.length > 0 &&
    gaps.every((gap) => Math.abs(gap - expected) <= Math.abs(expected) * 1e-9);

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

describe('DrawDashboard — world-anchored grid: zoom grows/shrinks the cells', () => {
    it('renders 100px cells at scale 1 (BASE_SPACING = 100 world units)', () => {
        render(<DrawDashboard />);
        stubSurfaceRect();

        // Every gap between consecutive vertical/horizontal lines is exactly
        // BASE_SPACING × 1 = 100px
        expect(allGapsEqual(readGaps(readVerticalLineXs()), 100)).toBe(true);
        expect(allGapsEqual(readGaps(readHorizontalLineYs()), 100)).toBe(true);
        // Line counts: ceil(800/100)+1 = 9 vertical, ceil(600/100)+1 = 7 horizontal
        expect(readVerticalLineXs().length).toBe(9);
        expect(readHorizontalLineYs().length).toBe(7);
    });

    it('GROWS the cells when zooming in (×1.2 notch → 120px cells)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // One ×1.2 notch → spacing 100 × 1.2 = 120px
        fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaY: 100 });
        expect(allGapsEqual(readGaps(readVerticalLineXs()), 120)).toBe(true);
        expect(allGapsEqual(readGaps(readHorizontalLineYs()), 120)).toBe(true);
        // Fewer lines fit: ceil(800/120)+1 = 7 + 1 = 8? ceil(6.67)=7, +1 = 8
        expect(readVerticalLineXs().length).toBe(8);
    });

    it('SHRINKS the cells when zooming out (÷1.2 notch → 83.33px cells)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // One ÷1.2 notch → spacing 100 / 1.2 = 83.333…px. Gap positions are
        // differences of k × spacing products, which carry ~1 ULP of
        // subtraction rounding for non-representable spacings — asserted
        // via the tight 1e-9 relative tolerance in allGapsEqual.
        fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaY: -100 });
        const spacing = BASE_SPACING / 1.2;
        expect(allGapsEqual(readGaps(readVerticalLineXs()), spacing)).toBe(true);
        expect(allGapsEqual(readGaps(readHorizontalLineYs()), spacing)).toBe(true);
        // More lines fit: ceil(800/83.33)+1 = ceil(9.6)=10, +1 = 11
        expect(readVerticalLineXs().length).toBe(11);
    });

    it('keeps growing/shrinking smoothly over many notches (no re-leveling jumps)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // 3 zoom-ins: scale 1.728 → spacing 172.8px
        for (let index = 0; index < 3; index++) {
            fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaY: 100 });
        }
        const spacingIn = BASE_SPACING * Math.pow(1.2, 3);
        expect(allGapsEqual(readGaps(readVerticalLineXs()), spacingIn)).toBe(true);

        // 3 zoom-outs from there: back to scale 1 → spacing 100px
        for (let index = 0; index < 3; index++) {
            fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaY: -100 });
        }
        expect(allGapsEqual(readGaps(readVerticalLineXs()), 100)).toBe(true);
    });

    it('anchors the origin exactly on a grid intersection at every zoom', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // After ANY zoom, the origin's screen position must coincide with a
        // grid line on both axes: lines sit at world multiples of 100, and
        // world (0,0) is such a multiple — its projection IS a line.
        for (let index = 0; index < 7; index++) {
            fireEvent.wheel(surface, { clientX: 250, clientY: 180, deltaY: 100 });
        }
        const origin = readOriginCross();
        const xs = readVerticalLineXs();
        const ys = readHorizontalLineYs();
        expect(xs).toContain(origin.x);
        expect(ys).toContain(origin.y);
    });

    it('keeps the world point under the cursor pinned while zooming', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Zoom in at (200, 150): the canvas point under the cursor stays
        // there (the zoom-at-pointer contract)
        const transformBefore = { x: -400, y: -300, scale: 1 };
        const pinned = screenToCanvas({ x: 200, y: 150 }, transformBefore);
        expect(pinned).toEqual({ x: -200, y: -150 });

        fireEvent.wheel(surface, { clientX: 200, clientY: 150, deltaY: 100 });
        // Exact new origin position: pan after zoom at (200,150):
        // x = 200/1 − 200/1.2 + (−400) = −366.666… → origin.x = 366.666… × 1.2 = 440
        // y = 150/1 − 150/1.2 + (−300) = −275 → origin.y = 275 × 1.2 = 330
        const after = readOriginCross();
        expect(after.x).toBeCloseTo(440, 6);
        expect(after.y).toBeCloseTo(330, 6);
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

    it('fades the grid out gracefully at extreme zoom-out (spacing < 2px)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Zoom out until the spacing (100 × scale) drops below 2px:
        // scale < 0.02 → 24 notches: 1.2^24 ≈ 79.5 → scale ≈ 0.0126 →
        // spacing ≈ 1.26px < 2 → the grid renders empty (no grid lines)
        for (let index = 0; index < 24; index++) {
            fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaY: -100 });
        }
        expect(readVerticalLineXs().length).toBe(0);
        expect(readHorizontalLineYs().length).toBe(0);
        // The HUD keeps reporting the scale — the canvas still works
        expect(readHudScale()).toBe('×1.258e-2');
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

    it('rubber-band SELECTIONS with plain left-drag (the drag never pans)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // No space held, button 0 (left) — the default gesture is now the
        // selection marquee (the left-drag PAN was removed; right/middle/
        // space drags keep panning)
        fireEvent.pointerDown(surface, { clientX: 300, clientY: 200, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 250 });
        // The live dashed selection box tracks the drag (screen-space of the
        // world box: start (−100,−100), current (0,−50) at pan (−400,−300))
        const box = screen.getByTestId('marquee-box');
        expect(box.getAttribute('x')).toBe('300');
        expect(box.getAttribute('y')).toBe('200');
        expect(box.getAttribute('width')).toBe('100');
        expect(box.getAttribute('height')).toBe('50');
        fireEvent.pointerUp(surface, {});
        // Release over empty space (no shapes exist) → the box unmounts,
        // nothing selected — and the view NEVER panned: origin stays centered
        expect(screen.queryByTestId('marquee-box')).toBeNull();
        expect(screen.queryByTestId('selection-overlay')).toBeNull();
        expect(readOriginCross()).toEqual({ x: 400, y: 300 });
        // Scale unchanged
        expect(readHudScale()).toBe('×1.000e+0');
    });

    it('does NOT pan when the left-drag starts on the HUD (HUD stays clickable)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // The drag starts on an element inside the data-hud wrapper — the
        // gesture belongs to the HUD, not the canvas
        const hudPanel = screen.getByTestId('zoom-hud');
        fireEvent.pointerDown(hudPanel, { clientX: 760, clientY: 580, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 250 });
        fireEvent.pointerUp(surface, {});

        // No pan: origin stays centered
        expect(readOriginCross()).toEqual({ x: 400, y: 300 });
    });

    it('pans with RIGHT-button drag (the dedicated pan gesture)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.pointerDown(surface, { clientX: 300, clientY: 200, button: 2 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 250 });
        fireEvent.pointerUp(surface, {});

        // Paper follows the hand → origin moves +100/+50: (400,300) → (500, 350)
        expect(readOriginCross()).toEqual({ x: 500, y: 350 });
    });

    it('suppresses the context menu on the canvas (right button is the pan drag)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // The contextmenu event must be preventDefault-ed on the canvas
        let defaultPrevented = false;
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        surface.addEventListener('contextmenu', () => {
            defaultPrevented = event.defaultPrevented;
        });
        fireEvent(surface, event);
        expect(defaultPrevented).toBe(true);
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

    it('slides the grid with the world while panning (cells keep their size)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.keyDown(window, { code: 'Space' });
        fireEvent.pointerDown(surface, { clientX: 300, clientY: 200, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 250 });
        fireEvent.pointerUp(surface, {});
        fireEvent.keyUp(window, { code: 'Space' });

        // Cells are still exactly 100px after the pan
        expect(allGapsEqual(readGaps(readVerticalLineXs()), 100)).toBe(true);
    });

    it('moves the view the same VISUAL distance per hand pixel at any zoom', () => {
        // The zoom-compensation contract: a 100px hand drag shifts the world
        // EXACTLY 100px on screen at every zoom (grab-the-paper — the paper
        // is glued to the hand). The CANVAS units covered differ (÷scale),
        // but the visual speed is constant. The old un-compensated behavior
        // would shift the world by 100 × scale px instead (172.8px zoomed
        // in, 57.87px zoomed out) — these assertions catch that.
        //
        // Zoomed IN: 3 notches at the viewport center → scale 1.728, origin
        // still at (400, 300) (center anchor). Drag 100px right → the origin
        // cross follows the hand to exactly 500.
        const zoomedIn = render(<DrawDashboard />);
        const surfaceIn = stubSurfaceRect();
        for (let index = 0; index < 3; index++) {
            fireEvent.wheel(surfaceIn, { clientX: 400, clientY: 300, deltaY: 100 });
        }
        expect(readHudScale()).toBe('×1.728e+0');
        // Zoomed-in pan probe: space+left drag (the pan override — a plain
        // left drag is the selection marquee now). Drag 100px right → the
        // origin cross follows the hand to exactly 500.
        fireEvent.keyDown(window, { code: 'Space' });
        fireEvent.pointerDown(surfaceIn, { clientX: 300, clientY: 300, button: 0 });
        fireEvent.pointerMove(surfaceIn, { clientX: 400, clientY: 300 });
        fireEvent.pointerUp(surfaceIn, {});
        fireEvent.keyUp(window, { code: 'Space' });
        expect(readOriginCross().x).toBeCloseTo(500, 9);
        zoomedIn.unmount();

        // Zoomed OUT: 3 notches at the viewport center → scale 1/1.728,
        // origin still at (400, 300). The SAME 100px hand drag → the origin
        // cross again lands at exactly 500 (same visual speed).
        render(<DrawDashboard />);
        const surfaceOut = stubSurfaceRect();
        for (let index = 0; index < 3; index++) {
            fireEvent.wheel(surfaceOut, { clientX: 400, clientY: 300, deltaY: -100 });
        }
        expect(readHudScale()).toBe('×5.787e-1');
        // SAME zoomed-out probe with the space override
        fireEvent.keyDown(window, { code: 'Space' });
        fireEvent.pointerDown(surfaceOut, { clientX: 300, clientY: 300, button: 0 });
        fireEvent.pointerMove(surfaceOut, { clientX: 400, clientY: 300 });
        fireEvent.pointerUp(surfaceOut, {});
        fireEvent.keyUp(window, { code: 'Space' });
        expect(readOriginCross().x).toBeCloseTo(500, 9);
    });

    it('keeps the canvas point under the pointer pinned during a drag at zoom', () => {
        // Zoom in 3 notches at the center: scale 1.728, pan becomes
        // (−400/1.728, −300/1.728) (zoom-at-center solve). The canvas point
        // under the grab cursor (300, 300) must equal the canvas point under
        // the release cursor (400, 300) after the 100px drag.
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();
        for (let index = 0; index < 3; index++) {
            fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaY: 100 });
        }
        const scale = Math.pow(1.2, 3);
        // Transforms derived from the zoom-at-center math (origin cross at
        // (400, 300) → pan = (−400/scale, −300/scale))
        const before = { x: -400 / scale, y: -300 / scale, scale };
        const after = { x: -500 / scale, y: -300 / scale, scale };
        const grabbed = screenToCanvas({ x: 300, y: 300 }, before);
        const released = screenToCanvas({ x: 400, y: 300 }, after);
        expect(released).toEqual(grabbed);

        // The dashboard actually performed this drag (RIGHT-button — the
        // dedicated pan drag; a plain left drag is the selection marquee now)
        fireEvent.pointerDown(surface, { clientX: 300, clientY: 300, button: 2 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        expect(readOriginCross().x).toBeCloseTo(500, 9);
    });
});

describe('DrawDashboard — horizontal wheel pan', () => {
    it('pans left/right with deltaX at scale 1 (tilt wheel / Shift+wheel)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Tilt right / Shift+wheel-down: deltaX 100 → the viewport scrolls
        // right (natural scroll, like a page) → content slides LEFT → the
        // origin cross moves −100px on screen
        fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaX: 100, deltaY: 0 });
        expect(readOriginCross()).toEqual({ x: 300, y: 300 });
        // Scale untouched — horizontal wheel never zooms
        expect(readHudScale()).toBe('×1.000e+0');

        // Tilt left: back to center
        fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaX: -100, deltaY: 0 });
        expect(readOriginCross()).toEqual({ x: 400, y: 300 });
    });

    it('zoom-compensates the deltaX pan (same visual speed at high zoom)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Zoom in 3 notches at the center → scale 1.728, origin stays (400, 300)
        for (let index = 0; index < 3; index++) {
            fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaY: 100 });
        }
        // deltaX 100 at scale 1.728 → 100/1.728 ≈ 57.87 canvas units →
        // the origin cross shifts exactly −100px on screen (same visual
        // speed as at scale 1 — the ÷scale compensation in applyPan)
        fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaX: 100, deltaY: 0 });
        expect(readOriginCross().x).toBeCloseTo(300, 9);
        // Zoom level unchanged
        expect(readHudScale()).toBe('×1.728e+0');
    });

    it('vertical-only wheel does NOT pan (deltaY zooms, deltaX stays 0)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Pure vertical wheel at the center: zoom 1 → 1.2, origin pinned
        // (the ~1e-13 residue is one ULP of the zoom-at-pointer double math)
        fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaX: 0, deltaY: 100 });
        expect(readOriginCross().x).toBeCloseTo(400, 9);
        expect(readOriginCross().y).toBe(300);
        expect(readHudScale()).toBe('×1.200e+0');
    });

    it('line-mode deltaX (deltaMode 1) pans ~100px per line', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Firefox line-mode: deltaX 3 lines → 300px → origin −300px
        fireEvent.wheel(surface, {
            clientX: 400,
            clientY: 300,
            deltaX: 3,
            deltaY: 0,
            deltaMode: 1,
        });
        expect(readOriginCross()).toEqual({ x: 100, y: 300 });
    });
});

describe('DrawDashboard — coordinate HUD', () => {
    it('shows the cursor canvas position relative to the origin (canvas center)', () => {
        render(<DrawDashboard />);
        stubSurfaceRect();

        // HUD hidden before any pointer event (no stale numbers)
        expect(screen.queryByTestId('coord-hud')).toBeNull();

        // Pointer at the viewport center = the world origin (0, 0) at the
        // initial transform → the readout is exactly "x +0.0  y +0.0"
        const surface = screen.getByTestId('canvas-surface');
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 300 });
        expect(screen.getByTestId('coord-value').textContent).toBe('x +0.0  y +0.0');

        // Pointer 100px right, 50px up from the center → canvas (100, −50)
        // at scale 1 (screen = canvas at scale 1)
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 250 });
        expect(screen.getByTestId('coord-value').textContent).toBe('x +100.0  y −50.0');

        // Pointer 200px left, 100px down from the center → canvas (−200, 100)
        fireEvent.pointerMove(surface, { clientX: 200, clientY: 400 });
        expect(screen.getByTestId('coord-value').textContent).toBe('x −200.0  y +100.0');
    });

    it('coordinates account for pan and zoom (relative to the world origin)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Zoom in 1 notch at the center (scale 1.2, origin stays at center)
        fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaY: 100 });
        // Pan right 100px (space+drag): the origin moves to (500, 300)
        fireEvent.keyDown(window, { code: 'Space' });
        fireEvent.pointerDown(surface, { clientX: 300, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        fireEvent.keyUp(window, { code: 'Space' });

        // Pointer at screen (400, 300) → canvas = screen/scale + pan.
        // Transform derivation (all steps zoom-compensated):
        //   zoom at center: pan = P/scale₁ + pan₁ − P/scale₂
        //     = (400 − 400 − 400/1.2, 300 − 300 − 300/1.2) = (−333.33…, −250)
        //   drag +100px: applyPan divides by scale → pan.x −= 100/1.2
        //     = −333.33… − 83.33… = −416.66… (= −500/1.2 exactly)
        //   canvas at screen (400, 300) = (400/1.2 − 500/1.2, 0) = (−83.33…, 0)
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 300 });
        expect(screen.getByTestId('coord-value').textContent).toBe('x −83.3  y +0.0');
        // Cross-check against the pure helper with the derived transform
        const scale = 1.2;
        const pan = { x: -500 / scale, y: -300 / scale };
        const expected = screenToCanvas({ x: 400, y: 300 }, { ...pan, scale });
        expect(expected.x).toBeCloseTo(-100 / scale, 9);
        expect(expected.y).toBe(0);
    });

    it('hides the coordinate HUD when the pointer leaves the canvas', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.pointerMove(surface, { clientX: 400, clientY: 300 });
        expect(screen.getByTestId('coord-hud')).toBeDefined();
        fireEvent.pointerLeave(surface, {});
        expect(screen.queryByTestId('coord-hud')).toBeNull();
    });

    it('formatCoordinate renders sign-padded 1-decimal readouts', () => {
        expect(formatCoordinate(120, 'x')).toBe('x +120.0');
        expect(formatCoordinate(-50.25, 'y')).toBe('y −50.3');
        expect(formatCoordinate(0, 'x')).toBe('x +0.0');
        expect(formatCoordinate(Number.NaN, 'y')).toBe('y +0.0');
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
        // Grid back to 100px cells
        expect(allGapsEqual(readGaps(readVerticalLineXs()), 100)).toBe(true);
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

        // Line count: (ceil(800/100)+1) vertical + (ceil(600/100)+1)
        // horizontal = 9 + 7 = 16 lines, PLUS the 2 origin-cross lines
        // (hidden but still mounted) = 18 total in the layer
        const layer = screen.getByTestId('grid-layer');
        expect(layer.children.length).toBe(18);
        // The origin cross is long gone off-screen → hidden (transparent)
        const cross = screen.getByTestId('origin-cross-h');
        expect(cross.getAttribute('stroke')).toBe('transparent');
    });
});
