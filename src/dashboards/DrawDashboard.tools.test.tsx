import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { DrawDashboard } from './DrawDashboard';

afterEach(() => {
    cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool-system + node-editor tests for the DrawDashboard: the toolbar
// (bottom-center, tool-agnostic), the tool plugins (circle, rectangle,
// line→curve), the router, the drawing layer, the right-side stroke palette,
// and the shape node adjustment handles.
//
// GRID CONTRACT: the default transform pans the world origin to screen
// (400, 300); the grid lattice (every 100 world units) passes through
// screen x = 400 + 100k, y = 300 + 100m. Test drags use screen coordinates
// and expect GRID-SNAPPED geometry (window ½-cell rounding — inside a
// half-cell the shape has not crossed to the next grid point yet).
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

// The node-handle overlay dots (e.g. circle + radius nodes of a circle)
const nodeDots = (): Element[] =>
    screen.queryByTestId('node-handles')
        ? Array.from(screen.getByTestId('node-handles').querySelectorAll('circle'))
        : [];

// Imperative cursor override written by the node editor on hover
const surfaceCursor = (): string => screen.getByTestId('canvas-surface').style.cursor;

describe('toolbar — the tool-agnostic bar', () => {
    it('renders the bottom-center toolbar with all shape tool buttons (no freehand)', () => {
        render(<DrawDashboard />);
        stubSurfaceRect();

        // The bar exists and carries every shape tool button — circle,
        // rectangle, line. The freehand pen was REMOVED (the grid contract:
        // "This isn't free form").
        expect(screen.getByTestId('toolbar')).toBeDefined();
        expect(screen.getByTestId('tool-circle')).toBeDefined();
        expect(screen.getByTestId('tool-rectangle')).toBeDefined();
        expect(screen.getByTestId('tool-line')).toBeDefined();
        expect(screen.queryByTestId('tool-pen')).toBeNull();
    });

    it('activates a tool on click and deactivates on second click', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Activate the circle
        fireEvent.click(screen.getByTestId('tool-circle'));
        // aria-pressed flips on the button
        expect(screen.getByTestId('tool-circle').getAttribute('aria-pressed')).toBe('true');

        // While a tool is active, left-drag no longer pans (the tool owns
        // it). NOTE: the pan-drag press must stay > 10px away from any
        // committed shape node — a node press belongs to the node editor.
        fireEvent.pointerDown(surface, { clientX: 250, clientY: 150, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 350, clientY: 200 });
        fireEvent.pointerUp(surface, {});
        expect(readOriginCross()).toEqual({ x: 400, y: 300 });

        // Deactivate (toggle back)
        fireEvent.click(screen.getByTestId('tool-circle'));
        expect(screen.getByTestId('tool-circle').getAttribute('aria-pressed')).toBe('false');

        // Left-drag pans again — clear of the drawn circle's nodes
        fireEvent.pointerDown(surface, { clientX: 250, clientY: 150, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 350, clientY: 200 });
        fireEvent.pointerUp(surface, {});
        expect(readOriginCross()).toEqual({ x: 500, y: 350 });
    });

    it('switches directly between tools (click rectangle while circle is active)', () => {
        render(<DrawDashboard />);
        stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.click(screen.getByTestId('tool-rectangle'));
        // Circle off, rectangle on
        expect(screen.getByTestId('tool-circle').getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByTestId('tool-rectangle').getAttribute('aria-pressed')).toBe('true');
    });

    it('activates tools via keyboard shortcuts (C/R/L)', () => {
        render(<DrawDashboard />);
        stubSurfaceRect();

        fireEvent.keyDown(window, { code: 'KeyC' });
        expect(screen.getByTestId('tool-circle').getAttribute('aria-pressed')).toBe('true');
        // Toggling: pressing the active tool's shortcut deactivates it
        fireEvent.keyDown(window, { code: 'KeyC' });
        expect(screen.getByTestId('tool-circle').getAttribute('aria-pressed')).toBe('false');
        // Direct switch: R activates the rectangle
        fireEvent.keyDown(window, { code: 'KeyR' });
        expect(screen.getByTestId('tool-rectangle').getAttribute('aria-pressed')).toBe('true');
        fireEvent.keyDown(window, { code: 'KeyR' });
        expect(screen.getByTestId('tool-rectangle').getAttribute('aria-pressed')).toBe('false');
        // L activates the line (curve)
        fireEvent.keyDown(window, { code: 'KeyL' });
        expect(screen.getByTestId('tool-line').getAttribute('aria-pressed')).toBe('true');
        fireEvent.keyDown(window, { code: 'KeyL' });
        expect(screen.getByTestId('tool-line').getAttribute('aria-pressed')).toBe('false');
    });
});

describe('circle tool — grid-locked circles', () => {
    it('press = center, drag = radius (committed exactly on grid geometry)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-circle'));
        // Press at screen (400,300) = world origin (0,0); drag to (700,300)
        // = world (300,0) → radius exactly 3 grid steps
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 700, clientY: 300 });
        fireEvent.pointerUp(surface, {});

        const shapes = committedElements();
        expect(shapes.length).toBe(1);
        expect(shapes[0].tagName).toBe('circle');
        expect(shapes[0].getAttribute('cx')).toBe('400');
        expect(shapes[0].getAttribute('cy')).toBe('300');
        expect(shapes[0].getAttribute('r')).toBe('300');
    });

    it('snaps an off-grid press to the center node and quantizes the radius', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-circle'));
        // Press at (430, 320) = world (30, 20) → SNAPS to world (0,0).
        // Move to (560, 300) = world (160, 0) → raw radius 160 → quantizes
        // to 2 steps (200). Both committed values land on the grid.
        fireEvent.pointerDown(surface, { clientX: 430, clientY: 320, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 560, clientY: 300 });
        fireEvent.pointerUp(surface, {});

        const shapes = committedElements();
        expect(shapes.length).toBe(1);
        expect(shapes[0].getAttribute('cx')).toBe('400');
        expect(shapes[0].getAttribute('cy')).toBe('300');
        expect(shapes[0].getAttribute('r')).toBe('200');
    });

    it('discards a drag that never crossed a grid half-cell', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 440, clientY: 300 }); // 40px < ½ cell
        fireEvent.pointerUp(surface, {});
        expect(committedElements().length).toBe(0);
        expect(draftElement()).toBeNull();
    });
});

describe('rectangle tool — grid-locked boxes', () => {
    it('opposite corners normalize regardless of drag direction (on-grid flats)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-rectangle'));
        // Drag UP-LEFT: (300,300) → (200,200). Both already on the lattice
        // (world (−100,0) and (−200,−100)); min/max normalize.
        fireEvent.pointerDown(surface, { clientX: 300, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 200, y: undefined, clientY: 200 } as never);
        fireEvent.pointerUp(surface, {});

        const shapes = committedElements();
        expect(shapes.length).toBe(1);
        expect(shapes[0].tagName).toBe('rect');
        expect(shapes[0].getAttribute('x')).toBe('200');
        expect(shapes[0].getAttribute('y')).toBe('200');
        expect(shapes[0].getAttribute('width')).toBe('100');
        expect(shapes[0].getAttribute('height')).toBe('100');
    });

    it('snaps off-grid drags onto the lattice', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-rectangle'));
        // Press (480, 320) = world (80, 20) → snaps to (100, 0) =
        // screen (500, 300). Move (640, 480) = world (240, 180) → snaps
        // to (200, 200) = screen (600, 500).
        fireEvent.pointerDown(surface, { clientX: 480, clientY: 320, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 640, clientY: 480 });
        fireEvent.pointerUp(surface, {});

        const shapes = committedElements();
        expect(shapes.length).toBe(1);
        expect(shapes[0].getAttribute('x')).toBe('500');
        expect(shapes[0].getAttribute('y')).toBe('300');
        expect(shapes[0].getAttribute('width')).toBe('100');
        expect(shapes[0].getAttribute('height')).toBe('200');
    });

    it('discards a drag whose corners snap together', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-rectangle'));
        fireEvent.pointerDown(surface, { clientX: 500, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 540, clientY: 340 }); // snaps onto the same point
        fireEvent.pointerUp(surface, {});
        expect(committedElements().length).toBe(0);
        expect(draftElement()).toBeNull();
    });
});

describe('line tool — the grid curve', () => {
    it('a 2-step chord gets the bent default control (curve, not sharp)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-line'));
        // Press the world origin (screen 400,300); drag 2 steps to (600,300)
        // = world (200,0). Default control bows to world (100,100) — the
        // quadratic apex rises half a cell off the chord.
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 600, clientY: 300 });
        fireEvent.pointerUp(surface, {});

        const shapes = committedElements();
        expect(shapes.length).toBe(1);
        expect(shapes[0].tagName).toBe('path');
        // Screen projection: start (400,300), control (400+100, 300+100),
        // end (400+200, 300)
        expect(shapes[0].getAttribute('d')).toBe('M 400 300 Q 500 400 600 300');
    });

    it('a 3-step chord snaps the bend onto the lattice too', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-line'));
        // 3 steps: control candidate (150,150) rounds to (200,200)
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 700, clientY: 300 });
        fireEvent.pointerUp(surface, {});

        expect(committedElements()[0].getAttribute('d')).toBe('M 400 300 Q 600 500 700 300');
    });

    it('a 1-step chord stays straight (control at the true midpoint)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-line'));
        // One diagonal step: (400,300) → (500,400) = world (100,100).
        // No bend until multiple grid points are spanned.
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 400 });
        fireEvent.pointerUp(surface, {});

        const shapes = committedElements();
        expect(shapes.length).toBe(1);
        expect(shapes[0].getAttribute('d')).toBe('M 400 300 Q 450 350 500 400');
    });

    it('discards a drag whose endpoints snap together (zero-step chord)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 440, clientY: 340 }); // < ½ cell away
        fireEvent.pointerUp(surface, {});
        expect(committedElements().length).toBe(0);
        expect(draftElement()).toBeNull();
    });

    it('shows a dashed live draft while dragging and clears it on release', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 600, clientY: 300 });

        // The draft is live (dashed) and no committed shape exists yet
        expect(committedElements().length).toBe(0);
        expect(draftElement()).not.toBeNull();
        expect(draftElement()?.getAttribute('d')).toBe('M 400 300 Q 500 400 600 300');

        fireEvent.pointerUp(surface, {});
        // Draft cleared, shape committed
        expect(draftElement()).toBeNull();
        expect(committedElements().length).toBe(1);
    });
});

describe('shape tools — coexistence with pan/zoom', () => {
    it('RIGHT-drag still pans while a tool is active (right = the pan drag)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.pointerDown(surface, { clientX: 300, clientY: 200, button: 2 });
        fireEvent.pointerMove(surface, { clientX: 350, clientY: 260 });
        fireEvent.pointerUp(surface, {});
        // Grab-the-paper: the origin follows the hand — drag +50/+60 moves
        // the origin +50/+60: (400,300) → (450, 360)
        expect(readOriginCross()).toEqual({ x: 450, y: 360 });
        // No drawing happened (right button never draws)
        expect(committedElements().length).toBe(0);
    });

    it('middle-drag still pans while a tool is active (tools only claim left)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.pointerDown(surface, { clientX: 300, clientY: 200, button: 1 });
        fireEvent.pointerMove(surface, { clientX: 350, clientY: 260 });
        fireEvent.pointerUp(surface, {});
        expect(readOriginCross()).toEqual({ x: 450, y: 360 });
        expect(committedElements().length).toBe(0);
    });

    it('space + left-drag still pans while a tool is active (power-user override)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-line'));
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

        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaY: 100 });
        expect(screen.getByTestId('hud-scale').textContent).toBe('×1.200e+0');
    });

    it('presses on the toolbar never draw (data-hud gate)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-line'));
        // A press that starts on the toolbar (inside data-hud) — even a
        // drag from there must not draw
        const toolbar = screen.getByTestId('toolbar');
        fireEvent.pointerDown(toolbar, { clientX: 400, clientY: 580, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 300, clientY: 200 });
        fireEvent.pointerUp(surface, {});
        expect(committedElements().length).toBe(0);
    });

    it('the surface cursor is crosshair while a tool is armed, grab when idle', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // jsdom's getComputedStyle does NOT resolve Emotion's injected
        // stylesheet rules (cursor reads as 'auto'), so the assertion reads
        // the CSSOM directly. NOTE: the cursor is a FUNCTION value in the
        // styledComponent input — function values resolve through the
        // breakpoint machinery (styleStructure → { xs: value }) and land
        // inside an `@media (min-width: 0px)` CSSMediaRule, so the scan
        // RECURSES into media rules.
        const cursorOf = (element: HTMLElement): string | null => {
            let found: string | null = null;
            const scanRules = (rules: CSSRuleList) => {
                Array.from(rules).forEach((rule) => {
                    if (rule instanceof CSSStyleRule) {
                        if (found === null && element.matches(rule.selectorText) && rule.style.cursor) {
                            found = rule.style.cursor;
                        }
                    } else if (rule instanceof CSSMediaRule) {
                        // Recurse into the media block (the breakpoint-wrapped rules)
                        scanRules(rule.cssRules);
                    }
                });
            };
            Array.from(document.styleSheets).forEach((sheet) => {
                try {
                    scanRules(sheet.cssRules);
                } catch {
                    // Cross-origin sheets throw — none in jsdom, defensive
                }
            });
            return found;
        };

        // No tool → grab (left-drag pans)
        expect(cursorOf(surface)).toBe('grab');
        // Arm the line → crosshair (left-drag draws)
        fireEvent.click(screen.getByTestId('tool-line'));
        expect(cursorOf(surface)).toBe('crosshair');
        // Deactivate → back to grab
        fireEvent.click(screen.getByTestId('tool-line'));
        expect(cursorOf(surface)).toBe('grab');
    });

    it('multiple shapes accumulate in the drawing layer (tags per kind)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Circle
        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        // Rectangle
        fireEvent.click(screen.getByTestId('tool-rectangle'));
        fireEvent.pointerDown(surface, { clientX: 600, clientY: 100, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 700, clientY: 200 });
        fireEvent.pointerUp(surface, {});
        // Curve
        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.pointerDown(surface, { clientX: 100, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 300, clientY: 300 });
        fireEvent.pointerUp(surface, {});

        const shapes = committedElements();
        expect(shapes.length).toBe(3);
        expect(shapes.map((shape) => shape.tagName)).toEqual(['circle', 'rect', 'path']);
    });
});

describe('color palette — the right-side stroke chooser', () => {
    // The palette swatches — MUST mirror functions/palette.ts
    // DRAW_COLOR_SWATCHES (rainbow order: red → orange → yellow → green →
    // cyan → blue → purple → white)
    const SWATCHES = [
        '#f7768e', // red
        '#ff9e64', // orange (tertiary)
        '#e0af68', // gold
        '#9ece6a', // green
        '#7dcfff', // cyan
        '#7aa2f7', // accent (the default ink)
        '#bb9af7', // secondary (purple)
        '#c0caf5', // text bright (near-white)
    ];

    it('appears on the right side only while a tool is armed', () => {
        render(<DrawDashboard />);
        stubSurfaceRect();

        // No tool armed → NO palette
        expect(screen.queryByTestId('color-palette')).toBeNull();
        // Arm the line → the palette mounts
        fireEvent.click(screen.getByTestId('tool-line'));
        expect(screen.getByTestId('color-palette')).toBeDefined();
        // Deactivate (toggle back) → the palette unmounts again
        fireEvent.click(screen.getByTestId('tool-line'));
        expect(screen.queryByTestId('color-palette')).toBeNull();
    });

    it('renders exactly the 8 palette swatches, each labeled with its hex', () => {
        render(<DrawDashboard />);
        stubSurfaceRect();
        fireEvent.click(screen.getByTestId('tool-line'));

        // One swatch per DRAW_COLOR_SWATCHES entry, in rainbow order
        const swatches = SWATCHES.map((hex) => screen.getByTestId(`color-swatch-${hex}`));
        expect(swatches.length).toBe(8);
        // Each tooltip + aria label carries the EXACT hex (no color
        // knowledge inside the plugin — pure palette passthrough)
        expect(swatches.map((swatch) => swatch.getAttribute('title'))).toEqual(SWATCHES);
        expect(swatches.map((swatch) => swatch.getAttribute('aria-label'))).toEqual(
            SWATCHES.map((hex) => `Stroke color ${hex}`),
        );
    });

    it('the default ink is the palette accent — strokes draw in it', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-line'));
        // The accent swatch is pre-selected (createDrawingState seed)
        expect(screen.getByTestId('color-swatch-#7aa2f7').getAttribute('aria-pressed')).toBe(
            'true',
        );

        // Draw a curve → the committed path carries the accent ink
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 400 });
        fireEvent.pointerUp(surface, {});
        const shapes = committedElements();
        expect(shapes.length).toBe(1);
        expect(shapes[0].getAttribute('stroke')).toBe('#7aa2f7');
    });

    it('clicking a swatch selects it and subsequent strokes use that ink', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-line'));
        // Select the red swatch
        fireEvent.click(screen.getByTestId('color-swatch-#f7768e'));
        // Red is now active; the accent is not
        expect(screen.getByTestId('color-swatch-#f7768e').getAttribute('aria-pressed')).toBe(
            'true',
        );
        expect(screen.getByTestId('color-swatch-#7aa2f7').getAttribute('aria-pressed')).toBe(
            'false',
        );

        // A circle drawn after the selection commits in red
        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        const shapes = committedElements();
        expect(shapes.length).toBe(1);
        expect(shapes[0].tagName).toBe('circle');
        expect(shapes[0].getAttribute('stroke')).toBe('#f7768e');
    });

    it('the live draft preview renders in the selected ink', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.click(screen.getByTestId('color-swatch-#bb9af7'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 600, clientY: 300 });

        // The dashed draft carries the selected purple ink
        const draft = draftElement();
        expect(draft).not.toBeNull();
        expect(draft?.getAttribute('stroke')).toBe('#bb9af7');
    });

    it('each shape keeps its CREATION-TIME ink (multiple inks coexist)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Stroke 1 — the default accent ink
        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});

        // Switch to green, then draw stroke 2
        fireEvent.click(screen.getByTestId('color-swatch-#9ece6a'));
        fireEvent.pointerDown(surface, { clientX: 600, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 700, clientY: 300 });
        fireEvent.pointerUp(surface, {});

        const shapes = committedElements();
        expect(shapes.length).toBe(2);
        // Anti-pattern guard: selecting a swatch must NOT repaint old shapes
        expect(shapes[0].getAttribute('stroke')).toBe('#7aa2f7');
        expect(shapes[1].getAttribute('stroke')).toBe('#9ece6a');
    });

    it('presses on the palette never draw (data-hud gate)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-line'));
        // A press that starts on the palette (inside data-hud) — even a
        // drag from there must not draw; (770,300) clears the nearest node
        // (the palette is on the far right edge)
        const palette = screen.getByTestId('color-palette');
        fireEvent.pointerDown(palette, { clientX: 770, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 300, clientY: 200 });
        fireEvent.pointerUp(surface, {});
        expect(committedElements().length).toBe(0);
    });
});

describe('node editor — click-drag adjustment of shape nodes', () => {
    it('renders a handle dot per node (circle: center + radius, curve: 3 nodes)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // A circle (2 nodes: center at world (0,0), radius node 1 step east)
        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        let dots = nodeDots();
        expect(dots.length).toBe(2);
        expect(dots.map((dot) => `${dot.getAttribute('cx')},${dot.getAttribute('cy')}`)).toEqual([
            '400,300',
            '500,300',
        ]);

        // A curve (3 nodes) — a 1-step chord renders straight, its control
        // node at the true midpoint world (250, 0) → screen (650, 300)
        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.pointerDown(surface, { clientX: 600, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 700, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        dots = nodeDots();
        expect(dots.length).toBe(5); // 2 (circle) + 3 (curve)
        // Dots in shape order: circle's two, then curve start/control/end
        expect(
            dots.map((dot) => `${dot.getAttribute('cx')},${dot.getAttribute('cy')}`),
        ).toEqual(['400,300', '500,300', '600,300', '650,300', '700,300']);
        // The curve control (the bend node) renders hollow — radius 4 vs
        // the filled dots' radius 5
        expect(dots[3].getAttribute('r')).toBe('4');
        expect(dots[0].getAttribute('r')).toBe('5');
    });

    it('node handles match the line color of their own shape', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // A circle in the default accent ink — handles read the same ink:
        // filled dot = the accent, ringed by the well background
        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        let dots = nodeDots();
        dots.forEach((dot) => {
            expect(dot.getAttribute('fill')).toBe('#7aa2f7');
            expect(dot.getAttribute('stroke')).toBe('#1a1b26');
        });

        // A second shape in red — its handles carry red while the first
        // keeps accent (per-shape inks, never global)
        fireEvent.click(screen.getByTestId('color-swatch-#f7768e'));
        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 100, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 600, clientY: 100 });
        fireEvent.pointerUp(surface, {});
        dots = nodeDots();
        // Circle dots: accent
        expect(dots[0].getAttribute('fill')).toBe('#7aa2f7');
        expect(dots[1].getAttribute('fill')).toBe('#7aa2f7');
        // Curve dots: the red ink (filled + the hollow ring stroke)
        expect(dots[2].getAttribute('fill')).toBe('#f7768e');
        expect(dots[3].getAttribute('stroke')).toBe('#f7768e');
        expect(dots[3].getAttribute('fill')).toBe('none');
        expect(dots[4].getAttribute('fill')).toBe('#f7768e');
    });

    it('hover cursor: grab on a node, hand (pointer) on the line itself, none on empty canvas', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // A circle: center node (400,300), r 100 — rim passes through
        // (400,400) and (500,300)
        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        fireEvent.click(screen.getByTestId('tool-circle')); // disarm → grab-class canvas

        // Hovering the CENTER NODE → the draggable cursor (drag)
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 300 });
        expect(surfaceCursor()).toBe('grab');
        // Hovering the RIM (the line itself) → the hand cursor (movable)
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 400 });
        expect(surfaceCursor()).toBe('pointer');
        // Hovering just outside everything (top rim is y=200 with r 100:
        // (400,250) is 50px inside-top — clears the center node by 50px and
        // the rim by 50px) → no override — the class cursor (grab for pan
        // mode) resurfaces
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 250 });
        expect(surfaceCursor()).toBe('');
        // Dead center (inside, far from the rim) → the center-node cursor
        // wins (1px off the node still grabs)
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 301 });
        expect(surfaceCursor()).toBe('grab');
    });

    it('grabbing the LINE and moving it translates the whole shape (pan mode)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Circle center (0,0) r 200: rim at screen (400,500)
        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 600, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        fireEvent.click(screen.getByTestId('tool-circle')); // pan mode

        // Grab the rim at (400,500) and drag right 140px (1.4 cells — a
        // tie at exactly 150 would round UP to 2) → snapped +100: the whole
        // circle re-centers on world (100, 0) → screen cx 500.
        // Pointer panning is also armed (pan mode) — but the rim press
        // belongs to the editor, so the origin never moves.
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 500, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 540, clientY: 500 });
        fireEvent.pointerUp(surface, {});
        const shape = committedElements()[0];
        expect(shape.getAttribute('cx')).toBe('500'); // moved +1 grid step
        expect(shape.getAttribute('cy')).toBe('300');
        expect(shape.getAttribute('r')).toBe('200'); // radius unchanged
        // The nodes traveled with the shape (the handles follow the ink)
        const dots = nodeDots();
        expect(`${dots[0].getAttribute('cx')},${dots[0].getAttribute('cy')}`).toBe('500,300');
        expect(`${dots[1].getAttribute('cx')},${dots[1].getAttribute('cy')}`).toBe('700,300');
        // NO panning: the world origin stays put (the rim press belonged
        // to the editor, never to the pan gesture)
        expect(readOriginCross()).toEqual({ x: 400, y: 300 });
    });

    it('grabbing a CURVE at its apex moves the whole curve (works while a tool is armed)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // 2-step curve start (0,0) control (100,100) end (200,0): the apex
        // sits at world (100, 50) → screen (500, 350)
        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 600, clientY: 300 });
        fireEvent.pointerUp(surface, {});

        // LINE STILL ARMED — pressing the line itself must MOVE, not draw
        // a new shape on top of it
        fireEvent.pointerDown(surface, { clientX: 500, clientY: 350, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 600, clientY: 350 });
        fireEvent.pointerUp(surface, {});

        expect(committedElements().length).toBe(1); // moved, not duplicated
        const shape = committedElements()[0];
        expect(shape.tagName).toBe('path');
        // +100 world delta: start (0,0)→(1,0)... start (100,0) → screen
        // (500,300); control (200,100) → (600,400); end (300,0) → (700,300)
        expect(shape.getAttribute('d')).toBe('M 500 300 Q 600 400 700 300');
    });

    it('the grab-move cursor is grabbing while dragging and clears after release', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        fireEvent.click(screen.getByTestId('tool-circle')); // pan mode

        // Grab the rim at (400,400) (the honest rim point for r 100) and
        // drag right 140px → snapped +100: cx 400 → 500
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 400, button: 0 });
        expect(surfaceCursor()).toBe('grabbing');
        fireEvent.pointerMove(surface, { clientX: 540, clientY: 400 });
        expect(surfaceCursor()).toBe('grabbing');
        fireEvent.pointerUp(surface, {});
        // Release clears the override (re-resolves on the next hover)
        expect(surfaceCursor()).toBe('');
        // The move committed: +100 snapped
        expect(committedElements()[0].getAttribute('cx')).toBe('500');
    });

    it('dragging the circle center node moves the shape (works in PAN mode, no pan)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Committed circle: center world (0,0) → screen (400,300), r 100
        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        // Back to pan mode — node adjustment must work WITHOUT a tool armed
        fireEvent.click(screen.getByTestId('tool-circle'));

        // Grab the center node (screen 400,300) and drag +100px
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});

        // The circle moved to world (100, 0) → screen (500, 300) — snapped
        // to the lattice; radius untouched
        const shape = committedElements()[0];
        expect(shape.getAttribute('cx')).toBe('500');
        expect(shape.getAttribute('cy')).toBe('300');
        expect(shape.getAttribute('r')).toBe('100');
        // NO panning happened (mayPan yields while adjusting): the origin
        // never moved
        expect(readOriginCross()).toEqual({ x: 400, y: 300 });
    });

    it('dragging the radius node re-quantizes the radius to grid steps', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        fireEvent.click(screen.getByTestId('tool-circle')); // pan mode

        // The radius node sits at screen (500,300) (center + 1 step east).
        // Drag it two steps further → raw distance 300 → 3 steps.
        fireEvent.pointerDown(surface, { clientX: 500, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 700, clientY: 300 });
        fireEvent.pointerUp(surface, {});

        expect(committedElements()[0].getAttribute('r')).toBe('300');
        // Center stayed put
        expect(committedElements()[0].getAttribute('cx')).toBe('400');
        expect(committedElements()[0].getAttribute('cy')).toBe('300');
    });

    it('dragging the curve control node re-curves (and can straighten) it', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // 2-step curve: control at world (100,100) → screen (500,400)
        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 600, clientY: 300 });
        fireEvent.pointerUp(surface, {});

        // Drag the control node up onto the chord (screen 500,300 =
        // world (100,0)) — the curve straightens
        fireEvent.pointerDown(surface, { clientX: 500, clientY: 400, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});

        expect(committedElements()[0].getAttribute('d')).toBe('M 400 300 Q 500 300 600 300');
    });

    it('dragging a rect corner keeps the opposite corner fixed (fold-over)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Rect (300,300)→(200,200): min world (−200,−100) → corner 'a' node
        // at screen (200,200); max world (−100,0) → screen (300,300)
        fireEvent.click(screen.getByTestId('tool-rectangle'));
        fireEvent.pointerDown(surface, { clientX: 300, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 200, clientY: 200 });
        fireEvent.pointerUp(surface, {});

        // Drag corner 'a' (200,200) left-up to (100,100) — outside the box
        fireEvent.pointerDown(surface, { clientX: 200, clientY: 200, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 100, clientY: 100 });
        fireEvent.pointerUp(surface, {});

        const shape = committedElements()[0];
        expect(shape.getAttribute('x')).toBe('100');
        expect(shape.getAttribute('y')).toBe('100');
        // The opposite corner 'c' never moved: width stays 200; the height
        // track the fixed corner 'c' (y = 0) against the dragged corner
        expect(shape.getAttribute('width')).toBe('200');
        expect(shape.getAttribute('height')).toBe('200');
    });

    it('pressing a node while a tool is armed adjusts; it never starts a drawing draft', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        expect(committedElements().length).toBe(1);

        // Circle still armed — press EXACTLY on the center node and drag:
        // the node editor claims the press (the router never draws)
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});

        // One committed shape (AND no stray draft): the press adjusted the
        // existing circle instead of starting a fresh degenerate one
        expect(committedElements().length).toBe(1);
        expect(draftElement()).toBeNull();
        expect(committedElements()[0].getAttribute('cx')).toBe('500');
    });

    it('space + press on a node still pans (the power-user override wins the grab)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});

        // Space held: pressing the node pans the canvas instead of grabbing
        fireEvent.keyDown(window, { code: 'Space' });
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        fireEvent.keyUp(window, { code: 'Space' });

        // The origin moved (pan +100/+0), the circle did NOT get re-grabbed:
        // in world space its center stayed at (0,0) — on screen it slides
        // WITH the world (grab-the-paper), so its screen position stays at
        // exactly the origin's offset (500, 300) = untouched node geometry.
        // A node grab would have re-anchored the center to world (100, 0)
        // → screen (600, 300).
        expect(readOriginCross()).toEqual({ x: 500, y: 300 });
        expect(committedElements()[0].getAttribute('cx')).toBe('500');
        expect(committedElements()[0].getAttribute('cy')).toBe('300');
    });

    it('the top-most shape wins when nodes overlap (later shape grabs first)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Circle centered at screen (300,300) = world (−100, 0)
        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 300, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 300 }); // r 100
        fireEvent.pointerUp(surface, {});

        // Rect drawn SECOND: its press must dodge the circle's center node
        // (a node press belongs to the node editor), so start at (100,300)
        // and drag to (300,400) — corner 'b' lands exactly on (300,300),
        // overlapping the circle's center node
        fireEvent.click(screen.getByTestId('tool-rectangle'));
        fireEvent.pointerDown(surface, { clientX: 100, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 300, clientY: 400 });
        fireEvent.pointerUp(surface, {});
        expect(committedElements().length).toBe(2);

        // Press the shared point (300,300): the rect (drawn LATER) wins —
        // its corner 'b' moves, the circle stays
        fireEvent.pointerDown(surface, { clientX: 300, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 300 });
        fireEvent.pointerUp(surface, {});

        const shapes = committedElements();
        expect(shapes[0].getAttribute('cx')).toBe('300'); // circle untouched
        // The rect folded over corner 'd' (fixed at min x, max y): corner
        // 'b' snapped to world (0,0) → the box spans world (−300,0)…(0,100)
        expect(shapes[1].getAttribute('x')).toBe('100');
        expect(shapes[1].getAttribute('y')).toBe('300');
        expect(shapes[1].getAttribute('width')).toBe('300');
        expect(shapes[1].getAttribute('height')).toBe('100');
    });

    it('pointerleave during a node drag ends it cleanly (shape keeps its geometry)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});

        // Start a node drag then leave the canvas mid-drag
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerLeave(surface);

        // The move already committed (snapped center (100,0)); the leave
        // must not pan, draw, or lose the shape
        expect(committedElements().length).toBe(1);
        expect(committedElements()[0].getAttribute('cx')).toBe('500');
        expect(draftElement()).toBeNull();
    });
});
