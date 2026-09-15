import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { DrawDashboard } from './DrawDashboard';

afterEach(() => {
    cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool-system tests for the DrawDashboard: the toolbar (bottom-center, tool-
// agnostic), the tool plugins (pen, circle, rectangle, line), the router,
// and the drawing layer.
// ─────────────────────────────────────────────────────────────────────────────

// Installs a deterministic getBoundingClientRect on the canvas surface
// (must be called after render). The canvas fills the whole viewport.
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

// Reads the world origin's screen position off the horizontal origin cross
const readOriginCross = (): { x: number; y: number } => {
    const cross = screen.getByTestId('origin-cross-h');
    return { x: Number(cross.getAttribute('x1')) + 8, y: Number(cross.getAttribute('y1')) };
};

// All committed shape elements in the drawing layer. The layer only mounts
// when there is something to draw (shapes or draft) — an empty canvas has
// NO drawing-layer element at all.
const committedElements = (): Element[] => {
    const layer = screen.queryByTestId('drawing-layer');
    if (!layer) return [];
    return Array.from(layer.children).filter(
        (element) => element.getAttribute('stroke-dasharray') === null,
    );
};

// The draft element (dashed stroke) — null when no draft is live
const draftElement = (): Element | null =>
    screen
        .queryByTestId('drawing-layer')
        ?.querySelector('[stroke-dasharray]') ?? null;

describe('toolbar — the tool-agnostic bar', () => {
    it('renders the bottom-center toolbar with all default tool buttons', () => {
        render(<DrawDashboard />);
        stubSurfaceRect();

        // The bar exists and carries every default tool button (pen,
        // circle, rectangle, line — the four registered tool plugins)
        expect(screen.getByTestId('toolbar')).toBeDefined();
        expect(screen.getByTestId('tool-pen')).toBeDefined();
        expect(screen.getByTestId('tool-circle')).toBeDefined();
        expect(screen.getByTestId('tool-rectangle')).toBeDefined();
        expect(screen.getByTestId('tool-line')).toBeDefined();
    });

    it('activates a tool on click and deactivates on second click', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Activate the pen
        fireEvent.click(screen.getByTestId('tool-pen'));
        // aria-pressed flips on the button
        expect(screen.getByTestId('tool-pen').getAttribute('aria-pressed')).toBe('true');

        // While a tool is active, left-drag no longer pans (the tool owns it)
        fireEvent.pointerDown(surface, { clientX: 300, clientY: 200, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 250 });
        fireEvent.pointerUp(surface, {});
        expect(readOriginCross()).toEqual({ x: 400, y: 300 });

        // Deactivate (toggle back)
        fireEvent.click(screen.getByTestId('tool-pen'));
        expect(screen.getByTestId('tool-pen').getAttribute('aria-pressed')).toBe('false');

        // Left-drag pans again
        fireEvent.pointerDown(surface, { clientX: 300, clientY: 200, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 250 });
        fireEvent.pointerUp(surface, {});
        expect(readOriginCross()).toEqual({ x: 500, y: 350 });
    });

    it('switches directly between tools (click circle while pen is active)', () => {
        render(<DrawDashboard />);
        stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-pen'));
        fireEvent.click(screen.getByTestId('tool-circle'));
        // Pen off, circle on
        expect(screen.getByTestId('tool-pen').getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByTestId('tool-circle').getAttribute('aria-pressed')).toBe('true');
    });

    it('activates tools via keyboard shortcuts (P/C/R/L)', () => {
        render(<DrawDashboard />);
        stubSurfaceRect();

        fireEvent.keyDown(window, { code: 'KeyP' });
        expect(screen.getByTestId('tool-pen').getAttribute('aria-pressed')).toBe('true');
        // Toggling: pressing the active tool's shortcut deactivates it
        fireEvent.keyDown(window, { code: 'KeyP' });
        expect(screen.getByTestId('tool-pen').getAttribute('aria-pressed')).toBe('false');
        // Direct switch: C activates the circle
        fireEvent.keyDown(window, { code: 'KeyC' });
        expect(screen.getByTestId('tool-circle').getAttribute('aria-pressed')).toBe('true');
        fireEvent.keyDown(window, { code: 'KeyC' });
        expect(screen.getByTestId('tool-circle').getAttribute('aria-pressed')).toBe('false');
    });
});

describe('pen tool — freehand strokes', () => {
    it('draws a committed polyline following the drag path', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Activate the pen
        fireEvent.click(screen.getByTestId('tool-pen'));

        // Drag a 3-point path: (100,100) → (150,120) → (200,140)
        fireEvent.pointerDown(surface, { clientX: 100, clientY: 100, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 150, clientY: 120 });
        fireEvent.pointerMove(surface, { clientX: 200, clientY: 140 });
        fireEvent.pointerUp(surface, {});

        // One committed polyline in the drawing layer. World points: the
        // initial transform is pan (−400,−300) scale 1 → world = screen − 400/300
        // → (−300,−200), (−250,−180), (−200,−160)
        const shapes = committedElements();
        expect(shapes.length).toBe(1);
        expect(shapes[0].tagName).toBe('polyline');
        // Screen projection of world (−300,−200) at pan (−400,−300) scale 1:
        // (world − pan) × scale = (100, 100) — the stroke re-projects back
        // onto the exact screen points it was drawn at (world-anchored)
        expect(shapes[0].getAttribute('points')).toBe('100,100 150,120 200,140');
    });

    it('shows a dashed live draft while dragging and clears it on release', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-pen'));
        fireEvent.pointerDown(surface, { clientX: 100, clientY: 100, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 150, clientY: 120 });

        // The draft is live (dashed) and no committed shape exists yet
        expect(committedElements().length).toBe(0);
        expect(draftElement()).not.toBeNull();
        expect(draftElement()?.getAttribute('points')).toBe('100,100 150,120');

        fireEvent.pointerUp(surface, {});
        // Draft cleared, shape committed
        expect(draftElement()).toBeNull();
        expect(committedElements().length).toBe(1);
    });

    it('discards a click without drag (no dot strokes)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-pen'));
        fireEvent.pointerDown(surface, { clientX: 100, clientY: 100, button: 0 });
        fireEvent.pointerUp(surface, {});
        // Single point → no committed shape, no draft
        expect(committedElements().length).toBe(0);
        expect(draftElement()).toBeNull();
    });

    it('strokes are world-anchored: panning slides them, zooming scales them', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Draw a two-point stroke at screen (100,100) → (200,100)
        fireEvent.click(screen.getByTestId('tool-pen'));
        fireEvent.pointerDown(surface, { clientX: 100, clientY: 100, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 200, clientY: 100 });
        fireEvent.pointerUp(surface, {});

        // Pan 100px right: the stroke slides WITH the world
        fireEvent.keyDown(window, { code: 'Space' });
        fireEvent.pointerDown(surface, { clientX: 300, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        fireEvent.keyUp(window, { code: 'Space' });
        expect(screen.getByTestId('drawing-layer').querySelector('polyline')?.getAttribute('points')).toBe(
            '200,100 300,100',
        );

        // Zoom in ×1.2 at the viewport center: world scale ×1.2 — the
        // stroke's screen length grows proportionally (100px → 120px).
        // NOTE: the first pointerDown ALSO moved the cursor to (300,300);
        // the subsequent drag pan is computed from that anchor.
        fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaY: 100 });
        const points = screen
            .getByTestId('drawing-layer')
            .querySelector('polyline')
            ?.getAttribute('points')
            ?.split(' ')
            .map((pair) => pair.split(',').map(Number));
        // The polyline has exactly 2 points and their screen-x distance is
        // 100 world units × 1.2 = 120px (zoom scales the stroke)
        expect(points?.length).toBe(2);
        expect((points?.[1]?.[0] ?? 0) - (points?.[0]?.[0] ?? 0)).toBeCloseTo(120, 6);
    });
});

describe('shape tools — circle, rectangle, line', () => {
    it('circle: press = center, drag distance = radius (committed on release)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-circle'));
        // Press at (200,150), drag to (300,150) → radius 100 world units
        fireEvent.pointerDown(surface, { clientX: 200, clientY: 150, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 300, clientY: 150 });
        fireEvent.pointerUp(surface, {});

        const shapes = committedElements();
        expect(shapes.length).toBe(1);
        expect(shapes[0].tagName).toBe('circle');
        // Screen projection: center world (−200,−150) → screen (200,150);
        // radius 100 world units × scale 1 = 100
        expect(shapes[0].getAttribute('cx')).toBe('200');
        expect(shapes[0].getAttribute('cy')).toBe('150');
        expect(shapes[0].getAttribute('r')).toBe('100');
    });

    it('rectangle: opposite corners normalized regardless of drag direction', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-rectangle'));
        // Drag UP-LEFT: (300,300) → (200,200)
        fireEvent.pointerDown(surface, { clientX: 300, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 200, y: undefined, clientY: 200 } as never);
        fireEvent.pointerUp(surface, {});

        const shapes = committedElements();
        expect(shapes.length).toBe(1);
        expect(shapes[0].tagName).toBe('rect');
        // World rect (−200,−100)→(−100,0) → screen (200,200)→(300,300)
        expect(shapes[0].getAttribute('x')).toBe('200');
        expect(shapes[0].getAttribute('y')).toBe('200');
        expect(shapes[0].getAttribute('width')).toBe('100');
        expect(shapes[0].getAttribute('height')).toBe('100');
    });

    it('line: press = start, release = end', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.pointerDown(surface, { clientX: 100, clientY: 500, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 250, clientY: 450 });
        fireEvent.pointerUp(surface, {});

        const shapes = committedElements();
        expect(shapes.length).toBe(1);
        expect(shapes[0].tagName).toBe('line');
        expect(shapes[0].getAttribute('x1')).toBe('100');
        expect(shapes[0].getAttribute('y1')).toBe('500');
        expect(shapes[0].getAttribute('x2')).toBe('250');
        expect(shapes[0].getAttribute('y2')).toBe('450');
    });

    it('discards degenerate zero-size drags (click without drag)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Circle: zero radius
        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 100, clientY: 100, button: 0 });
        fireEvent.pointerUp(surface, {});
        // Rectangle: zero area
        fireEvent.click(screen.getByTestId('tool-rectangle'));
        fireEvent.pointerDown(surface, { clientX: 100, clientY: 100, button: 0 });
        fireEvent.pointerUp(surface, {});
        // Line: zero length
        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.pointerDown(surface, { clientX: 100, clientY: 100, button: 0 });
        fireEvent.pointerUp(surface, {});

        expect(committedElements().length).toBe(0);
        expect(draftElement()).toBeNull();
    });

    it('multiple shapes accumulate in the drawing layer', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Pen stroke
        fireEvent.click(screen.getByTestId('tool-pen'));
        fireEvent.pointerDown(surface, { clientX: 100, clientY: 100, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 150, clientY: 150 });
        fireEvent.pointerUp(surface, {});
        // Circle
        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        // Line
        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.pointerDown(surface, { clientX: 600, clientY: 100, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 700, clientY: 200 });
        fireEvent.pointerUp(surface, {});

        const shapes = committedElements();
        expect(shapes.length).toBe(3);
        expect(shapes.map((shape) => shape.tagName)).toEqual(['polyline', 'circle', 'line']);
    });
});

describe('tool system — coexistence with pan/zoom', () => {
    it('middle-drag still pans while a tool is active (tools only claim left)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-pen'));
        fireEvent.pointerDown(surface, { clientX: 300, clientY: 200, button: 1 });
        fireEvent.pointerMove(surface, { clientX: 350, clientY: 260 });
        fireEvent.pointerUp(surface, {});
        // Grab-the-paper: the origin follows the hand — drag +50/+60 moves
        // the origin +50/+60: (400,300) → (450, 360)
        expect(readOriginCross()).toEqual({ x: 450, y: 360 });
        // No drawing happened (middle button never draws)
        expect(committedElements().length).toBe(0);
    });

    it('space + drag still pans while a tool is active (power-user override)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-pen'));
        fireEvent.keyDown(window, { code: 'Space' });
        fireEvent.pointerDown(surface, { clientX: 300, clientY: 200, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 250 });
        fireEvent.pointerUp(surface, {});
        fireEvent.keyUp(window, { code: 'Space' });
        // Pan happened (origin moved +100/+50), no shape was drawn
        expect(readOriginCross()).toEqual({ x: 500, y: 350 });
        expect(committedElements().length).toBe(0);
    });

    it('wheel zoom still works while a tool is active', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-pen'));
        fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaY: 100 });
        expect(screen.getByTestId('hud-scale').textContent).toBe('×1.200e+0');
    });

    it('presses on the toolbar never draw (data-hud gate)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-pen'));
        // A press that starts on the toolbar (inside data-hud) — even a
        // drag from there must not draw
        const toolbar = screen.getByTestId('toolbar');
        fireEvent.pointerDown(toolbar, { clientX: 400, clientY: 580, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 300, clientY: 200 });
        fireEvent.pointerUp(surface, {});
        expect(committedElements().length).toBe(0);
    });
});
