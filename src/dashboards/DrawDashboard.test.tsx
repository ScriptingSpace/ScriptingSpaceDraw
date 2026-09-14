import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { DrawDashboard } from './DrawDashboard';
import { createInitialTransform, screenToCanvas } from '../functions/canvasTransform';

// jsdom reports clientX/Y relative to the viewport; the canvas surface sits
// below the header. Stub getBoundingClientRect on the surface so the
// pointer math is deterministic: the surface occupies the full 800×600
// viewport starting at (0, 0) — i.e. header/footer collapse to zero height
// in the stub, which keeps the mapping screen = client exactly.
beforeEach(() => {
    const surface = () => document.querySelector('[data-testid="canvas-surface"]');
    // Patch AFTER mount — the element must exist. Rendered per test below.
});

afterEach(() => {
    cleanup();
});

// Installs a deterministic getBoundingClientRect on the canvas surface
// element (must be called after render)
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

// Converts a screen point to canvas coordinates using the CURRENT transform
// state — read back through the origin cross position? No: simpler and
// fully deterministic — the origin cross renders at canvasToScreen(0,0).
// Instead of reverse-engineering, tests assert on observable DOM: the HUD
// scale + the origin cross screen position (SVG attributes).
const readOriginCross = (): { x: number; y: number } => {
    const cross = screen.getByTestId('origin-cross-h');
    // x1 = origin.x − 8 → origin.x = x1 + 8
    const x1 = Number(cross.getAttribute('x1'));
    const y1 = Number(cross.getAttribute('y1'));
    return { x: x1 + 8, y: y1 };
};

describe('DrawDashboard — shell', () => {
    it('renders header, canvas surface, HUD and footer', () => {
        render(<DrawDashboard />);
        stubSurfaceRect();

        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Draw Dashboard');
        expect(screen.getByTestId('canvas-surface')).toBeDefined();
        expect(screen.getByTestId('grid-svg')).toBeDefined();
        expect(screen.getByTestId('zoom-hud')).toBeDefined();
        expect(screen.getByTestId('hud-scale').textContent).toBe('×1.000e+0');
        expect(screen.getByTestId('footer-version').textContent).toBe('Draw Dashboard v1.0.0');
        expect(screen.getByTestId('footer-cursor-info').textContent).toBe('ready');
    });

    it('renders the visible grid levels at the initial scale', () => {
        render(<DrawDashboard />);
        stubSurfaceRect();

        // Scale 1 → levels [0, 1, 2] selected; level 2's screen spacing
        // (4096px) is multiple bands past MAX(128) → opacity 0 → NOT
        // rendered. Visible set: level 0 (64px, full) + level 1 (512px,
        // fading at 4/7 opacity).
        expect(screen.getByTestId('grid-level-0')).toBeDefined();
        expect(screen.getByTestId('grid-level-1')).toBeDefined();
        expect(screen.queryByTestId('grid-level-2')).toBeNull();
    });

    it('starts with the world origin at the viewport center', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Wait one tick for the measure effect (initial state already
        // centers at 800×600 — the default matches the stubbed rect)
        const origin = readOriginCross();
        expect(origin).toEqual({ x: 400, y: 300 });
    });
});

describe('DrawDashboard — wheel zoom', () => {
    it('zooms in at the pointer on one wheel notch (×1.2)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Wheel at the viewport center (400, 300) — scale 1 → 1.2, origin
        // stays pinned under the cursor (center anchor = no pan shift; the
        // 4e-14 residue is one ULP of double-math drift)
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

    it('regenerates grid levels as the scale crosses level boundaries', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // At scale 1 → levels [0, 1, 2]. Zoom OUT 2 notches (÷1.44) →
        // scale ≈ 0.694: level 0 screen spacing = 64 × 0.694 ≈ 44.4 ≥ 12 →
        // still level 0. Zoom out more — 8 notches total: scale ≈ 0.168,
        // level 0 → 10.7px < 12 → finest visible level becomes 1.
        for (let index = 0; index < 8; index++) {
            fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaY: -100 });
        }
        // 1.2^8 = 4.2998… → scale ≈ 0.2326; level 0 → 14.9px ≥ 12 → still 0.
        // 16 notches: 1.2^16 ≈ 18.49 → scale ≈ 0.0541; level 0 → 3.46px < 12,
        // level 1 → 27.7px ≥ 12 → levels [1, 2, 3]; level 3's screen spacing
        // = 1772px → past the band → opacity 0 → only 1 and 2 render
        for (let index = 0; index < 8; index++) {
            fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaY: -100 });
        }
        expect(screen.queryByTestId('grid-level-0')).toBeNull();
        expect(screen.getByTestId('grid-level-1')).toBeDefined();
        expect(screen.getByTestId('grid-level-2')).toBeDefined();
        expect(screen.queryByTestId('grid-level-3')).toBeNull();
        expect(screen.queryByTestId('grid-level-4')).toBeNull();
    });
});

describe('DrawDashboard — panning', () => {
    it('pans with space + drag (grab-the-paper: origin follows the hand)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Arm space mode
        fireEvent.keyDown(window, { code: 'Space' });
        expect(screen.getByTestId('footer-cursor-info').textContent).toBe(
            'space held — drag to pan',
        );

        // Drag 100px right, 50px down from (300, 200)
        fireEvent.pointerDown(surface, { clientX: 300, clientY: 200, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 250 });
        fireEvent.pointerUp(surface, {});

        // Paper follows the hand → pan shifts by −100/−50 → origin moves
        // +100/+50 on screen: (400,300) → (500, 350)
        expect(readOriginCross()).toEqual({ x: 500, y: 350 });
        // Scale unchanged
        expect(readHudScale()).toBe('×1.000e+0');

        fireEvent.keyUp(window, { code: 'Space' });
        expect(screen.getByTestId('footer-cursor-info').textContent).toBe('ready');
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
        expect(screen.getByTestId('footer-cursor-info').textContent).toBe('ready');
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

        // Line count per level = ceil(width/spacing)+1 + ceil(height/spacing)+1.
        // Level 0 at scale 1 → 64px → (ceil(800/64)+1) + (ceil(600/64)+1)
        // = 14 + 11 = 25 lines.
        const level = screen.getByTestId('grid-level-0');
        expect(level.children.length).toBe(25);
        // The origin cross is long gone off-screen → hidden (transparent)
        const cross = screen.getByTestId('origin-cross-h');
        expect(cross.getAttribute('stroke')).toBe('transparent');
    });
});
