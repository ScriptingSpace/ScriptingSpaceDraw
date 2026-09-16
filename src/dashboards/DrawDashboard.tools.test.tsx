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

// The node-handle overlay dots (e.g. the circle's center + 4 rim nodes)
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
    it('renders a handle dot per node (circle: center + 4 cardinal rims, curve: 3 nodes)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // A circle (FIVE nodes: center at world (0,0) + the cardinal rim
        // points e/s/w/n at ±1 step)
        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        let dots = nodeDots();
        expect(dots.length).toBe(5);
        expect(dots.map((dot) => `${dot.getAttribute('cx')},${dot.getAttribute('cy')}`)).toEqual([
            '400,300', // center
            '500,300', // east rim
            '400,400', // south rim
            '300,300', // west rim
            '400,200', // north rim
        ]);

        // A curve (3 nodes) — a 1-step chord renders straight, its control
        // node at the true midpoint world (250, 0) → screen (650, 300)
        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.pointerDown(surface, { clientX: 600, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 700, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        dots = nodeDots();
        expect(dots.length).toBe(8); // 5 (circle) + 3 (curve)
        // Dots in shape order: circle's five, then curve start/control/end
        expect(
            dots.map((dot) => `${dot.getAttribute('cx')},${dot.getAttribute('cy')}`),
        ).toEqual([
            '400,300',
            '500,300',
            '400,400',
            '300,300',
            '400,200',
            '600,300',
            '650,300',
            '700,300',
        ]);
        // The curve control (the bend node) renders hollow — radius 4 vs
        // the filled dots' radius 5
        expect(dots[6].getAttribute('r')).toBe('4');
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
        // Circle dots (indices 0-4): accent
        expect(dots[0].getAttribute('fill')).toBe('#7aa2f7');
        expect(dots[4].getAttribute('fill')).toBe('#7aa2f7');
        // Curve dots (indices 5-7): the red ink (filled + the hollow ring stroke)
        expect(dots[5].getAttribute('fill')).toBe('#f7768e');
        expect(dots[6].getAttribute('stroke')).toBe('#f7768e');
        expect(dots[6].getAttribute('fill')).toBe('none');
        expect(dots[7].getAttribute('fill')).toBe('#f7768e');
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
        // Hovering a SOUTH RIM point clear of the rim NODES (the s node
        // sits at (400,400); (470,370) is on the rim between nodes — the
        // line itself) → the hand cursor (movable)
        fireEvent.pointerMove(surface, { clientX: 470, clientY: 370 });
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

        // Grab the rim at (541,441) — the 45° point between the e and s
        // rim nodes (both sit 153px away; the rim itself is 0px) — and
        // drag right 140px (1.4 cells — a tie at exactly 150 would round
        // UP to 2) → snapped +100: the whole circle re-centers on world
        // (100, 0) → screen cx 500.
        // Pointer panning is also armed (pan mode) — but the rim press
        // belongs to the editor, so the origin never moves.
        fireEvent.pointerDown(surface, { clientX: 541, clientY: 441, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 681, clientY: 441 });
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

        // Grab the rim at (471,371) — the 45° point clear of the e/s rim
        // nodes (both 76px away; the rim itself 0.4px) — and drag right
        // 140px → snapped +100: cx 400 → 500
        fireEvent.pointerDown(surface, { clientX: 471, clientY: 371, button: 0 });
        expect(surfaceCursor()).toBe('grabbing');
        fireEvent.pointerMove(surface, { clientX: 611, clientY: 371 });
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

    it('dragging an east rim node re-quantizes the radius to grid steps', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        fireEvent.click(screen.getByTestId('tool-circle')); // pan mode

        // The east rim node sits at screen (500,300) (center + 1 step east).
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
        fireEvent.click(screen.getByTestId('tool-line')); // disarm → node drag mode

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
        fireEvent.click(screen.getByTestId('tool-rectangle')); // disarm

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

    it('with a tool armed, pressing a node DRAWS from it — the drop auto-locks (tool precedence)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Existing circle first: center world (0,0) → screen (400,300), r 100
        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});

        // With the LINE tool armed, press EXACTLY on the circle's center
        // node and drag east: TOOL PRECEDENCE — the node editor yields the
        // press to the router and a NEW line draws with ITS START anchored
        // on that node's grid point
        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});

        // Two committed shapes (the line drawn FROM the circle's center
        // node — the press never became a node adjustment)
        expect(committedElements().length).toBe(2);
        expect(draftElement()).toBeNull();
        // The 1-step chord renders straight with the control at the true
        // midpoint (50,0) → screen (450,300); the DROP CHECK locked TWO
        // junctions at commit: line.start ↔ circle.center (0,0) AND
        // line.end ↔ circle.rim 'e' (100,0) — 4 halo'd dots
        const shapes = committedElements();
        expect(shapes[1].getAttribute('d')).toBe('M 400 300 Q 450 300 500 300');
        const halos = () => nodeDots().filter((dot) => dot.getAttribute('r') === '8');
        expect(halos().length).toBe(4);

        // Lock verified: grabbing the CIRCLE's body (the southeast 45° rim
        // spot (471,371), clear of every node) and moving +100:+0 carries
        // the line along (move as one) — the line rebuilds from its
        // grab-time shape + the snapped delta (the half-lattice control
        // (50,0) re-snaps to (200,0) — the moveShape grid safety net)
        fireEvent.pointerDown(surface, { clientX: 471, clientY: 371, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 571, clientY: 371 });
        fireEvent.pointerUp(surface, {});
        const moved = committedElements();
        expect(moved[0].getAttribute('cx')).toBe('500');
        expect(moved[1].getAttribute('d')).toBe('M 500 300 Q 600 300 600 300');
        // 5 halos: the 2 original junctions (start↔center, end↔rim e)
        // ride the move, PLUS the release check bonds the line's bend
        // (control re-snapped from half-lattice (150,0) to (200,0) by
        // moveShape's grid safety net) onto the circle's rim `e` (200,0)
        // — a real new coincidence the move itself created.
        expect(halos().length).toBe(5);
    });

    it('pan-mode node drag still adjusts (disarm = the adjustment interaction)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        fireEvent.click(screen.getByTestId('tool-circle')); // disarm

        // PAN MODE — press EXACTLY on the center node and drag: the node
        // editor claims the press (the router never draws)
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

    it('overlapping nodes at commit LOCK — bending holds the weld, pulling out breaks to the top node', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Circle centered at world (−100, 0) → screen (300,300), r 100.
        // Its east rim node (`e` — lockable like every node) sits at
        // world (0,0) → screen (400,300).
        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 300, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 300 }); // r 100
        fireEvent.pointerUp(surface, {});

        // Rect drawn SECOND: press (100, 200) = world (−300,−100), drag to
        // (400,300) = world (0,0) — corner 'c' (max/max) lands exactly on
        // the circle's east rim node (world 0,0). The commit auto-bonds
        // corner 'c' ↔ rim 'e' — one junction, two halo'd endpoint dots.
        fireEvent.click(screen.getByTestId('tool-rectangle'));
        fireEvent.pointerDown(surface, { clientX: 100, clientY: 200, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        fireEvent.click(screen.getByTestId('tool-rectangle')); // disarm
        expect(committedElements().length).toBe(2);
        const halos = () => nodeDots().filter((dot) => dot.getAttribute('r') === '8');
        expect(halos().length).toBe(2);

        // Press the junction (the rect — drawn LATER — owns the top node
        // claim) and bend the pointer WITHIN one grid step: screen
        // (495,300) = world (95,0) — the elastic hold keeps the weld and
        // NEITHER shape moves
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 495, clientY: 300 });
        expect(halos().length).toBe(2);

        // Pull OUT past a full grid step: screen (620,300) = world
        // (220,0) → snapped (200,0) — the lock SEVERS and the grabbed
        // node (whichever is on top: the rect's corner 'c') follows the
        // pointer while the circle keeps its position. The rect folds
        // around its fixed diagonal corner 'a' (world (−300,−100)).
        fireEvent.pointerMove(surface, { clientX: 620, clientY: 300 });
        fireEvent.pointerUp(surface, {});

        const shapes = committedElements();
        // Circle: untouched by the rect's node drag (the break released
        // the pair) — center stayed at world (−100,0) → cx 300
        expect(shapes[0].getAttribute('cx')).toBe('300');
        expect(shapes[0].getAttribute('cy')).toBe('300');
        expect(shapes[0].getAttribute('r')).toBe('100');
        // Rect: min (−300,−100) unchanged (fixed corner), max (0,0) →
        // (200,0) → screen x 100, y 200, width 500, height 100
        expect(shapes[1].getAttribute('x')).toBe('100');
        expect(shapes[1].getAttribute('y')).toBe('200');
        expect(shapes[1].getAttribute('width')).toBe('500');
        expect(shapes[1].getAttribute('height')).toBe('100');
        // The bond is gone
        expect(halos().length).toBe(0);
    });

    it('pointerleave during a node drag ends it cleanly (shape keeps its geometry)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        fireEvent.click(screen.getByTestId('tool-circle')); // disarm → node drag mode

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

describe('bonded groups — connected shapes move as one', () => {
    // ───────────────────────────────────────────────────────────────────────
    // Scene: two curves A + B bonded at the shared world point (0,0).
    //
    // A = line grab (100,300)→(400,300): world (−300,0)→(0,0), 3 steps →
    //   bent control defaultCurveControl((−300,0),(0,0)) = (−100,200).
    // B = line grab (700,300)→(400,300): world (300,0)→(0,0), 3 steps →
    //   control (200,200). B is drawn BOTTOM-UP so its press (700,300)
    //   lands far from A's end node (400,300) — pressing the junction
    //   directly would claim A's node grab instead of drawing B.
    // The commit auto-connects B's end (0,0) to A's end (0,0) — one bond
    // in drawing state, so the pair must MOVE AS ONE afterwards.
    // ───────────────────────────────────────────────────────────────────────
    const drawBondedPair = (surface: HTMLElement) => {
        // A: world (−300,0) → (0,0)
        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.pointerDown(surface, { clientX: 100, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        // B: world (300,0) → (0,0) — bonded to A's end at commit
        fireEvent.pointerDown(surface, { clientX: 700, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        // Disarm: node gestures (adjust / pull-break / re-connect) are the
        // pan-mode interaction — with a tool armed a node press DRAWS
        fireEvent.click(screen.getByTestId('tool-line'));
    };

    // After moving the bonded pair by the exact +100,+0 delta (un-snapped,
    // integer screen move):
    //   A: start (−200,0) control (0,200) end (100,0)
    //   B: start  (400,0) control (300,−100) end (100,0)
    // Both curves' endpoints still coincide at world (100,0) — the weld
    // rides the group delta.
    const A_MOVED = 'M 200 300 Q 400 500 500 300';
    const B_MOVED = 'M 800 300 Q 700 200 500 300';
    const A_IDLE = 'M 100 300 Q 300 500 400 300';
    const B_IDLE = 'M 700 300 Q 600 200 400 300';
    // One step LEFT of the originals (dx −100):
    //   A: start (−400,0) control (−200,200) end (−100,0)
    //   B: start  (200,0) control  (100,−100) end (−100,0)
    const A_LEFT = 'M 0 300 Q 200 500 300 300';
    const B_LEFT = 'M 600 300 Q 500 200 300 300';

    it('placing the cursor ON the bonded node and dragging it out BREAKS the lock (pull-to-break)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();
        drawBondedPair(surface);

        // Press the bonded junction (400,300 — B's end node, the top node
        // there) and bend the pointer WITHIN one grid step: screen
        // (495,300) = world (95,0) — the elastic hold keeps the junction
        // welded and NOTHING moves (repeat events change nothing)
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 495, clientY: 300 });
        fireEvent.pointerMove(surface, { clientX: 495, clientY: 300 });
        let paths = committedElements().map((p) => p.getAttribute('d'));
        expect(paths).toEqual([A_IDLE, B_IDLE]);
        let halos = () => nodeDots().filter((dot) => dot.getAttribute('r') === '8');
        expect(halos().length).toBe(2);

        // Pull OUT past one full grid step: screen (505,300) = world
        // (105,0) — the lock SEVERS ("drags it out → it breaks"): the
        // grabbed node — WHICHEVER IS ON TOP at the junction, B's end —
        // follows the pointer as a free snapped adjustment while A keeps
        // everything and the halos vanish
        fireEvent.pointerMove(surface, { clientX: 505, clientY: 300 });
        paths = committedElements().map((p) => p.getAttribute('d'));
        // B: {start (300,0), control (200,−200), end (100,0)} — its end
        // pulled to the snapped pointer point; A: untouched
        expect(paths).toEqual([A_IDLE, 'M 700 300 Q 600 200 500 300']);
        expect(halos().length).toBe(0);

        // Fully independent now: the pulled node keeps following like a
        // free node
        fireEvent.pointerMove(surface, { clientX: 605, clientY: 300 });
        paths = committedElements().map((p) => p.getAttribute('d'));
        expect(paths).toEqual([A_IDLE, 'M 700 300 Q 600 200 600 300']);
        expect(halos().length).toBe(0);
        fireEvent.pointerUp(surface, {});
    });

    it('a constant-delta line drag across MANY pointermove events never ratchets the group (and the weld rides)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();
        drawBondedPair(surface);

        // Grab A's line at its apex (275,400 — the anchor, world
        // (−125,100)) then park the pointer at screen x 400 (world 0):
        // offset +125 → dx 100 on EVERY event
        fireEvent.pointerDown(surface, { clientX: 275, clientY: 400, button: 0 });
        const HOLD = { clientX: 400, clientY: 400 };
        fireEvent.pointerMove(surface, HOLD);
        fireEvent.pointerMove(surface, HOLD);
        fireEvent.pointerMove(surface, HOLD);
        let paths = committedElements().map((p) => p.getAttribute('d'));
        expect(paths).toEqual([A_MOVED, B_MOVED]);

        // One screen px right of the press (dx 0): restore originals
        fireEvent.pointerMove(surface, { clientX: 276, clientY: 400 });
        paths = committedElements().map((p) => p.getAttribute('d'));
        expect(paths).toEqual([A_IDLE, B_IDLE]);

        // Past the anchor leftward (offset −115 → dx −100)
        fireEvent.pointerMove(surface, { clientX: 160, clientY: 400 });
        paths = committedElements().map((p) => p.getAttribute('d'));
        expect(paths).toEqual([A_LEFT, B_LEFT]);
        fireEvent.pointerUp(surface, {});
    });

    it('grabbing the LINE of a bonded shape moves the whole pair (and only them)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();
        drawBondedPair(surface);
        expect(committedElements().length).toBe(2);

        // Grab A's line at its apex: world (−125,100) (0.25·start +
        // 0.5·control + 0.25·end) → screen (275,400) — distance 0 to A's
        // stroke, > 160 to every node + B's body
        fireEvent.pointerDown(surface, { clientX: 275, clientY: 400, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 375, clientY: 400 });
        fireEvent.pointerUp(surface, {});

        const paths = committedElements().map((p) => p.getAttribute('d'));
        expect(paths).toEqual([A_MOVED, B_MOVED]);
    });

    it('dragging a bonded node OUT breaks the lock: the top node follows, the twin and the line-grab group split', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();
        drawBondedPair(surface);

        // Press the junction (400,300 — B's end node is on top) and pull
        // past one grid step: screen (620,300) = world (220,0) → the
        // break severs the bond and B's end becomes a free node at the
        // snapped (200,0); A keeps everything
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 620, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        let paths = committedElements().map((p) => p.getAttribute('d'));
        expect(paths).toEqual([A_IDLE, 'M 700 300 Q 600 200 600 300']);
        let halos = () => nodeDots().filter((dot) => dot.getAttribute('r') === '8');
        expect(halos().length).toBe(0);

        // Line-grab A and move +100 — A moves ALONE now, B stays where
        // the break left it (the pair no longer rides together). A's end
        // node now sits at world (100,0) → screen (500,300).
        fireEvent.pointerDown(surface, { clientX: 275, clientY: 400, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 375, clientY: 400 });
        fireEvent.pointerUp(surface, {});
        paths = committedElements().map((p) => p.getAttribute('d'));
        expect(paths).toEqual([A_MOVED, 'M 700 300 Q 600 200 600 300']);

        // Re-verify the connect side: drag B's (freed) end node (600,300)
        // onto A's end (500,300) — the DESTINATION scan finds the twin,
        // the weld is exact and the halos relight (the break was real,
        // the connect is a fresh bond)
        fireEvent.pointerDown(surface, { clientX: 600, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        halos = () => nodeDots().filter((dot) => dot.getAttribute('r') === '8');
        expect(halos().length).toBe(2);
        paths = committedElements().map((p) => p.getAttribute('d'));
        // B re-welded: {start (300,0), control (200,−200), end (100,0)}
        expect(paths).toEqual([A_MOVED, 'M 700 300 Q 600 200 500 300']);
    });

    it('double-clicking the junction severs the bond: shapes move independently', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();
        drawBondedPair(surface);

        // The bonded junction renders the junction halo on BOTH bonded
        // endpoint dots (2 endpoints × 1 junction)
        const halos = () =>
            nodeDots().filter((dot) => dot.getAttribute('r') === '8');
        expect(halos().length).toBe(2);

        // Deliberate break: double-click the bonded endpoint node
        fireEvent.dblClick(surface, { clientX: 400, clientY: 300, button: 0 });
        expect(halos().length).toBe(0);

        // Now A's line moves ALONE; B keeps the bonded-pair geometry
        fireEvent.pointerDown(surface, { clientX: 275, clientY: 400, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 375, clientY: 400 });
        fireEvent.pointerUp(surface, {});
        const paths = committedElements().map((p) => p.getAttribute('d'));
        expect(paths).toEqual([A_MOVED, B_IDLE]);
    });

    it('proximity-connect during a node drag bonds the pair — then they move as one', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // A: world (−300,0) → (0,0)
        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.pointerDown(surface, { clientX: 100, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        // B: world (400,0) → (300,0) — its free END node sits at (300,0)
        fireEvent.pointerDown(surface, { clientX: 800, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 700, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        // Disarm: the node drag below needs the editor to own the press
        fireEvent.click(screen.getByTestId('tool-line'));
        // Committed WITHOUT contact: (300,0) ≠ (0,0) → no bond yet
        const halos = () =>
            nodeDots().filter((dot) => dot.getAttribute('r') === '8');
        expect(halos().length).toBe(0);

        // Drag A's end node (400,300) onto B's end (700,300): move 1 snaps
        // A's end to world (300,0); move 2 (same point) finds B's end node
        // within the grab radius — the bond records and the pair welds
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 700, clientY: 300 });
        fireEvent.pointerMove(surface, { clientX: 700, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        // The bond lights the halo on both joined endpoint dots
        expect(halos().length).toBe(2);

        // Grab A's line (apex world (−125,100) → screen (275,400)) and
        // move +100,+0: the bonded pair travels together. B's arc at that
        // point crosses toward the junction too — assert the exact result:
        //   A: {start (−200,0), control (0,200), end (400,0)}
        //     → 'M 200 300 Q 400 500 800 300'
        //   B: moveShape re-snaps every vertex — the straight 1-step
        //     control (350,0) drifts half a cell to (350+100 → snap 500):
        //     {start (500,0), control (500,0), end (400,0)}
        //     → 'M 900 300 Q 900 300 800 300'
        // (Both endpoints terminate on the SAME world point (400,0): the
        // weld survives the move.)
        fireEvent.pointerDown(surface, { clientX: 275, clientY: 400, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 375, clientY: 400 });
        fireEvent.pointerUp(surface, {});
        const paths = committedElements().map((p) => p.getAttribute('d'));
        expect(paths).toEqual([
            'M 200 300 Q 400 500 800 300',
            'M 900 300 Q 900 300 800 300',
        ]);
    });

    it('a bond chain carries all reachable shapes (B—A—C three-shape chain)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Draw order B → A → C (world grid points):
        //   B: (300,0) → (0,0)      [press 700,300 → 400,300]
        //   A: (−300,0) → (0,0)     [press 100,300 → 400,300]
        //     bonds to B's end at (0,0)
        //   C: (−300,100) → (−300,0) [press 100,400 → 100,300]
        //     bonds to A's start at (−300,0) — the chain closes
        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.pointerDown(surface, { clientX: 700, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        fireEvent.pointerDown(surface, { clientX: 100, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        fireEvent.pointerDown(surface, { clientX: 100, clientY: 400, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 100, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        expect(committedElements().length).toBe(3);

        // Two bonded junctions (A.end↔B.end at (0,0), C.end↔A.start at
        // (−300,0)); each lights its halo on both endpoint dots → 2 × 2
        const halos = () =>
            nodeDots().filter((dot) => dot.getAttribute('r') === '8');
        expect(halos().length).toBe(4);

        // Grab A's body at its apex (world (−125,100) → screen (275,400))
        // and move +100,+0 — the WHOLE chain (B, A, C) must translate:
        //   B: {start (400,0), control (300,−100), end (100,0)}
        //   A: {start (−200,0), control (0,200), end (100,0)}
        //   C: {start (−200,100), control (−200,100), end (−200,0)}
        //     (the straight 1-step control (−300,50) re-snaps half a cell
        //     to (−200,100) — the moveShape grid safety net)
        fireEvent.pointerDown(surface, { clientX: 275, clientY: 400, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 375, clientY: 400 });
        fireEvent.pointerUp(surface, {});
        const paths = committedElements().map((p) => p.getAttribute('d'));
        expect(paths).toEqual([
            'M 800 300 Q 700 200 500 300', // B
            'M 200 300 Q 400 500 500 300', // A
            'M 200 400 Q 200 400 200 300', // C
        ]);
    });
});

describe('circle locks — rim nodes bond like any other node', () => {
    // Halo helper (bonded endpoints render r = 5 + 3)
    const halos = () => nodeDots().filter((dot) => dot.getAttribute('r') === '8');

    it('a circle rim node locks to a line endpoint AT COMMIT and the pair moves as one', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Line L FIRST (index 0): world (200,0) → (100,0), a 1-step
        // straight chord [press 600,300 → 500,300]
        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.pointerDown(surface, { clientX: 600, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        // Circle SECOND (index 1): center (0,0), r 100 [press 400,300 →
        // 500,300] — its EAST rim lands exactly on L's end (world (100,0)).
        // Every node is lockable now, so the commit auto-bonds rim `e` ↔
        // L.end — the junction lights both endpoint halos.
        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        expect(committedElements().length).toBe(2);
        expect(halos().length).toBe(2);

        // Grab L's line body between its start and control nodes — world
        // (175,0) → screen (575,300): 25px from L's nearest nodes (≥10 ✓),
        // 75px from L.end, ≥75px from every circle node, 75px from the
        // circle stroke
        fireEvent.pointerDown(surface, { clientX: 575, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 675, clientY: 300 });
        fireEvent.pointerUp(surface, {});

        const shapes = committedElements();
        // Circle: center (0,0) → (100,0) → screen cx 500 — it traveled
        // with the LINE (move as one)
        expect(shapes[1].getAttribute('cx')).toBe('500');
        expect(shapes[1].getAttribute('cy')).toBe('300');
        expect(shapes[1].getAttribute('r')).toBe('100');
        // Line: start (300,0), end (200,0) — and the bent 1-step control
        // (150,0) + 100 = (250,0) re-snaps half a cell to (300,0) (the
        // moveShape grid safety net) → 'M 700 300 Q 700 300 600 300'
        expect(shapes[0].getAttribute('d')).toBe('M 700 300 Q 700 300 600 300');
        // The junction still welds: rim e (world (200,0)) == L.end (world (200,0))
        expect(halos().length).toBe(2);
    });

    it('dragging a north rim node onto a line endpoint locks EXACTLY (radius re-quantization cannot)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Circle FIRST (index 0): center (0,0), r 100 [press 400,300 →
        // 500,300] — the north rim sits at world (0,−100) → screen (400,200)
        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        // Line L SECOND (index 1): world (200,−200) → (0,−200), a 2-step
        // chord [press 600,100 → 400,100]: bends DOWN to control
        // (100,−300). Its end (world (0,−200)) is 100 world units above
        // the rim node — no commit contact, no bond yet.
        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.pointerDown(surface, { clientX: 600, clientY: 100, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 100 });
        fireEvent.pointerUp(surface, {});
        expect(halos().length).toBe(0);

        // Disarm (the active tool is the line) — node gestures are the
        // pan-mode interaction (tool-armed node presses DRAW)
        fireEvent.click(screen.getByTestId('tool-line'));

        // Drag the circle's NORTH rim node (400,200) onto L's end (400,100):
        // the destination scan finds L.end at the snapped pointer point and
        // the weld ROLLS the circle up (Δ = (0,−100) → center (0,−100)) so
        // the rim lands EXACTLY on L's end — adjustShape's re-quantized
        // radius (target distance 100 from the OLD center) could never
        // guarantee this coincidence against an arbitrary twin.
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 200, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 100 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 100 }); // weld settles (no-op)
        fireEvent.pointerUp(surface, {});

        const shapes = committedElements();
        // Circle: center (0,−100) → screen cx 400, cy 200 — the rim
        // (center + (0,−100)) now sits at world (0,−200) = L's end
        expect(shapes[0].getAttribute('cx')).toBe('400');
        expect(shapes[0].getAttribute('cy')).toBe('200');
        expect(shapes[0].getAttribute('r')).toBe('100');
        // The line never moved
        expect(shapes[1].getAttribute('d')).toBe('M 600 100 Q 500 0 400 100');
        // Bond recorded: rim n ↔ L.end
        expect(halos().length).toBe(2);

        // Move as one: grab L's body at its apex (world (100,−250) →
        // screen (500,50): 0 to the stroke, ≥50px to every node, ≥80px to
        // the circle stroke) and drag +100:+0 — the circle rides along
        // with the rim still welded to L's end (world (100,−200))
        fireEvent.pointerDown(surface, { clientX: 500, clientY: 50, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 600, clientY: 50 });
        fireEvent.pointerUp(surface, {});
        const moved = committedElements();
        // Circle: center (100,−100) → screen cx 500, cy 200
        expect(moved[0].getAttribute('cx')).toBe('500');
        expect(moved[0].getAttribute('cy')).toBe('200');
        expect(moved[0].getAttribute('r')).toBe('100');
        // Line: start (300,−200), control (200,−300) (already lattice —
        // no drift), end (100,−200) == circle rim n (100,−200) ✓
        expect(moved[1].getAttribute('d')).toBe('M 700 100 Q 600 0 500 100');
        expect(halos().length).toBe(2);
    });

    it('a circle edge dropped NEAR (one grid step from) a lattice node does NOT slide or bond', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Rect first: corners world (100,100)–(200,200) [press 500,400 →
        // 600,500] — corner 'a' is a lattice node at (100,100)
        fireEvent.click(screen.getByTestId('tool-rectangle'));
        fireEvent.pointerDown(surface, { clientX: 500, clientY: 400, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 600, clientY: 500 });
        fireEvent.pointerUp(surface, {});

        // Circle: center (0,0) [press 400,300], edge released 45° toward
        // the corner at (102,103) [screen 502,403] — raw distance ≈ 144.7
        // → radius quantizes to 100 with the rim at (100,0): ONE grid step
        // from the corner (100,100). NO exact contact anywhere → the
        // circle commits EXACTLY where it was drawn — never pulled into
        // the node one step over (the no-near-drop-snapping contract).
        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 502, clientY: 403 });
        fireEvent.pointerUp(surface, {});

        expect(committedElements().length).toBe(2);
        const shapes = committedElements();
        // NOT slid: center (0,0) → screen (400,300), radius unchanged —
        // the drawn geometry is where the grid contract left it
        expect(shapes[1].getAttribute('cx')).toBe('400');
        expect(shapes[1].getAttribute('cy')).toBe('300');
        expect(shapes[1].getAttribute('r')).toBe('100');
        // Nothing bonded — near is NOT on
        const halos = () => nodeDots().filter((dot) => dot.getAttribute('r') === '8');
        expect(halos().length).toBe(0);

        // The shapes stay INDEPENDENT: grab the RECT's body (left-edge
        // midpoint world (100,150) → screen (500,450): 0 to the stroke,
        // ≥50px to every node, ≥80px to the circle stroke) and drag
        // +100:+0 — the rect moves alone, the circle does NOT ride (no
        // bond formed "for no reason")
        fireEvent.pointerDown(surface, { clientX: 500, clientY: 450, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 600, clientY: 450 });
        fireEvent.pointerUp(surface, {});
        const moved = committedElements();
        // Rect: (200,100)–(300,200) → x 600 y 400 w 100 h 100
        expect(moved[0].getAttribute('x')).toBe('600');
        expect(moved[0].getAttribute('y')).toBe('400');
        // Circle: still center (0,0) → screen cx 400, cy 300
        expect(moved[1].getAttribute('cx')).toBe('400');
        expect(moved[1].getAttribute('cy')).toBe('300');
        expect(halos().length).toBe(0);
    });

    it('a drop with NO node at its drawn position stays un-bonded (no near-node snapping)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Rect: corners (200,100)–(300,200) [press 600,400 → 700,500]
        fireEvent.click(screen.getByTestId('tool-rectangle'));
        fireEvent.pointerDown(surface, { clientX: 600, clientY: 400, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 700, clientY: 500 });
        fireEvent.pointerUp(surface, {});

        // Circle: center (0,0), edge east at (102,−3) → r 100, rim e at
        // (100,0): nearest rect node (corner 'a' (200,100)) is
        // √(100²+100²) ≈ 141 away — no coincidence, no pull, no bond
        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 502, clientY: 297 });
        fireEvent.pointerUp(surface, {});

        expect(committedElements().length).toBe(2);
        const shapes = committedElements();
        // The circle committed where it was drawn (no slide)
        expect(shapes[1].getAttribute('cx')).toBe('400');
        expect(shapes[1].getAttribute('cy')).toBe('300');
        expect(shapes[1].getAttribute('r')).toBe('100');
        // Nothing bonded
        expect(nodeDots().filter((dot) => dot.getAttribute('r') === '8')).toHaveLength(0);
    });

    it('DRAGGING an old shape: release with a node landed on another node LOCKS it', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Line L first: world (−300,0)→(0,0) [press 100,300 → 400,300]
        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.pointerDown(surface, { clientX: 100, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        // Rect second: (500,100)–(600,200) [press 900,400 → 1000,500]
        fireEvent.click(screen.getByTestId('tool-rectangle'));
        fireEvent.pointerDown(surface, { clientX: 900, clientY: 400, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 1000, clientY: 500 });
        fireEvent.pointerUp(surface, {});
        fireEvent.click(screen.getByTestId('tool-rectangle')); // disarm
        // No bonds yet (no coincidences at commit)
        expect(nodeDots().filter((dot) => dot.getAttribute('r') === '8')).toHaveLength(0);

        // Line-grab the rect's body (left-edge midpoint world (500,150) →
        // screen (900,450): 0 to the stroke, ≥45px to every node, far from
        // the line) and drag dx −5 steps dy −1 step: the rect settles at
        // world (0,0)–(100,100) — corner 'a' (min-min, world (0,0)) lands
        // EXACTLY on the line's END node (0,0). (The line is a 3-step
        // chord: start (−300,0), bent control (−100,200), end (0,0) — no
        // other corner touches any of its nodes.) The RELEASE auto-lock
        // records corner 'a' ↔ line end.
        fireEvent.pointerDown(surface, { clientX: 900, clientY: 450, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 350 });
        fireEvent.pointerUp(surface, {});

        // Locked at release
        const halos = () => nodeDots().filter((dot) => dot.getAttribute('r') === '8');
        expect(halos().length).toBe(2);

        // The lock is real: grab the LINE's body at its apex — world
        // (−125,100): 0.25·start + 0.5·control + 0.25·end → screen
        // (275,400) (0px off the stroke, ≥58px to every node and ≥…px to
        // the rect body) — and move +100:+0. The bond group carries the
        // RECT: it rides +100 with the line (pan untouched — the origin
        // stays at (400,300)).
        fireEvent.pointerDown(surface, { clientX: 275, clientY: 400, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 375, clientY: 400 });
        fireEvent.pointerUp(surface, {});
        const moved = committedElements();
        // Rect: min (100,0) → screen x 500, y 300
        expect(moved[1].getAttribute('x')).toBe('500');
        expect(moved[1].getAttribute('y')).toBe('300');
        // Bond survived: halos still lit
        expect(halos().length).toBe(2);
    });

    it('DRAGGING an old circle: release one step from a lattice node does NOT slide or lock (only exact contact does)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Line L: world (−100,0)→(0,0), a 1-step straight chord [press
        // 300,300 → 400,300]. Its END node (0,0) is the node the circle
        // below gets dragged NEAR — but never ON.
        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.pointerDown(surface, { clientX: 300, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        // Circle: center (400,0), r 100 [press 800,300 → 900,300] — the
        // nearest foreign node (L.end (0,0)) sits 3 steps from rim w
        // (300,0) → NO commit contact → the circle commits where drawn
        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 800, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 900, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        fireEvent.click(screen.getByTestId('tool-circle')); // disarm
        expect(nodeDots().filter((dot) => dot.getAttribute('r') === '8')).toHaveLength(0);

        // Body-grab the circle at the rim's southeast 45° spot (world
        // (471,71) → screen (871,371): ≈0.4px off the stroke, ≥76px to
        // every node) and drag dx −3 steps dy +1 step: the center settles
        // at world (100,100) — rim w lands at (0,100), ONE grid step from
        // L's end (0,0). NOTHING coincides (tier 1 empty) → the release
        // check must NOT slide the circle the last step onto the node (the
        // no-near-drop-snapping contract): it settles exactly as dragged.
        fireEvent.pointerDown(surface, { clientX: 871, clientY: 371, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 571, clientY: 471 });
        fireEvent.pointerUp(surface, {});

        const shapes = committedElements();
        // NOT slid: center (100,100) → screen cx 500, cy 400; radius
        // untouched — the drag result stands as released
        expect(shapes[1].getAttribute('cx')).toBe('500');
        expect(shapes[1].getAttribute('cy')).toBe('400');
        expect(shapes[1].getAttribute('r')).toBe('100');
        // NOT bonded: one step from the node is not ON the node
        expect(nodeDots().filter((dot) => dot.getAttribute('r') === '8')).toHaveLength(0);

        // The only thing that still locks is EXACT contact: grab L's body
        // (press (337,300) — 0px off the stroke, ≥13px clear of every
        // node) and move +100:+0 so its end node travels (0,0) → (100,0)
        // ONTO the circle's north rim node (100,0). L is unbonded, so the
        // move carries L alone; the RELEASE check then records the
        // genuine coincidences L.end ↔ rim n AND L's re-snapped bend
        // ((50,0) → (100,0)) ↔ rim n.
        fireEvent.pointerDown(surface, { clientX: 337, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 437, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        const after = committedElements();
        // L moved ALONE (the circle was not bonded during the drag):
        // start (0,0), bend+end folded to (100,0) by the moveShape grid
        // safety net → screen M 400 300 Q 500 300 500 300
        expect(after[0].getAttribute('d')).toBe('M 400 300 Q 500 300 500 300');
        // The circle never moved
        expect(after[1].getAttribute('cx')).toBe('500');
        expect(after[1].getAttribute('cy')).toBe('400');
        // The exact junction bonded: L.start clear, L.end + L.control +
        // rim n share (100,0) → 3 halo'd dots
        expect(nodeDots().filter((dot) => dot.getAttribute('r') === '8')).toHaveLength(3);

        // The lock is real: grab L's STROKE between its start node
        // (world (0,0) → screen (400,300), 50px away) and its junction
        // node ((100,0) → screen (500,300), 50px away): press (450,300)
        // — 0px off the stroke — then move +100:+0. The bond group
        // carries the CIRCLE with the line (move as one).
        fireEvent.pointerDown(surface, { clientX: 450, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 550, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        const moved = committedElements();
        // Circle: center (200,100) → screen cx 600, cy 400 — it rode the
        // group move
        expect(moved[1].getAttribute('cx')).toBe('600');
        expect(moved[1].getAttribute('cy')).toBe('400');
        // L: start (100,0) → screen 500, bend+end (200,0) → screen 600;
        // the welded junction rides (rim n lands on the moved end
        // (200,0)) → still 3 halos
        expect(moved[0].getAttribute('d')).toBe('M 500 300 Q 600 300 600 300');
        expect(nodeDots().filter((dot) => dot.getAttribute('r') === '8')).toHaveLength(3);
    });

    it('a press with NO movement never locks (the release check needs a real drag)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Same no-contact scene: line (−100,0)→(0,0); circle center
        // (400,0) r 100 — committed alone
        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.pointerDown(surface, { clientX: 300, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 400, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 800, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 900, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        fireEvent.click(screen.getByTestId('tool-circle')); // disarm
        expect(nodeDots().filter((dot) => dot.getAttribute('r') === '8')).toHaveLength(0);

        // A bare press on the circle's rim-e NODE (world (500,0) → screen
        // (900,300)) released with NO move: geometry unchanged → the
        // release auto-lock must not fire — no bond, no slide
        fireEvent.pointerDown(surface, { clientX: 900, clientY: 300, button: 0 });
        fireEvent.pointerUp(surface, {});
        expect(nodeDots().filter((dot) => dot.getAttribute('r') === '8')).toHaveLength(0);
        const circles = committedElements().filter((el) => el.tagName === 'circle');
        expect(circles[0].getAttribute('cx')).toBe('800'); // never slid
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GESTURE KILL-SWITCH regressions — `drawing.adjusting` is the universal
// gesture gate (dragToPanPlugin.mayPan yields when it is set, toolRouter
// refuses to start a draw, the node editor refuses grabs). A grab whose
// release leaves every node point UNCHANGED must still unwind the flag —
// otherwise one click on a shape bricks every later gesture (drag + draw
// both dead) — the "sometimes after zooming, nothing works" report.
// ─────────────────────────────────────────────────────────────────────────────
describe('gesture unwind — a no-move grab must never latch the adjusting flag', () => {
    // Snapshot of the origin BEFORE the pan-drag inside expectDrawingAlive
    let originPrev = { x: 400, y: 300 };

    // Proves both gates are ALIVE after the suspicious gesture: a fresh
    // 1-step line commits (draw gate open) and a left-drag on empty canvas
    // pans by exactly the pointer delta (pan gate open).
    const expectDrawingAlive = () => {
        fireEvent.click(screen.getByTestId('tool-line'));
        fireEvent.pointerDown(screen.getByTestId('canvas-surface'), { clientX: 200, clientY: 300, button: 0 });
        fireEvent.pointerMove(screen.getByTestId('canvas-surface'), { clientX: 300, clientY: 300 });
        fireEvent.pointerUp(screen.getByTestId('canvas-surface'), {});
        // Circle + the new line: the draw gate was OPEN
        expect(committedElements().length).toBe(2);
        // 1-step chord renders straight: M <press> Q <midpoint> <end>
        expect(committedElements()[1].getAttribute('d')).toBe('M 200 300 Q 250 300 300 300');
        fireEvent.click(screen.getByTestId('tool-line')); // disarm
        // Empty spot (100,500): ≥10px screen from every committed shape's
        // nodes, off every stroke — the press is a plain pan drag
        const surface = screen.getByTestId('canvas-surface');
        fireEvent.pointerDown(surface, { clientX: 100, clientY: 500, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 200, clientY: 500 });
        fireEvent.pointerUp(surface, {});
        const origin = readOriginCross();
        expect(origin.x).toBe(originPrev.x + 100);
        expect(origin.y).toBe(originPrev.y);
    };

    it('a click on a node with NO move keeps drawing AND panning alive', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Circle: center world (0,0) → screen (400,300), r 100
        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        fireEvent.click(screen.getByTestId('tool-circle')); // disarm (pan mode)

        // PAN-MODE press-release on the center node with NO pointermove:
        // the node editor claims the grab, the release finds the geometry
        // unchanged — the unwind must still run
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerUp(surface, {});

        // Draw gate + pan gate still open
        originPrev = readOriginCross();
        expectDrawingAlive();
    });

    it('a line-grab jitter inside one grid half-cell keeps drawing AND panning alive', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Circle: center world (0,0), r 100 — the southeast 45° body spot
        // is screen (471,371): ≈1px off the stroke, ≥76px from every node
        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        fireEvent.click(screen.getByTestId('tool-circle')); // disarm

        // Body grab + a 21px jitter: the world delta < half a grid cell →
        // moveShape snaps the delta to (0,0) → every node point stays put
        // → the release signature is UNCHANGED — the unwind must still run
        fireEvent.pointerDown(surface, { clientX: 471, clientY: 371, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 492, clientY: 392 });
        fireEvent.pointerUp(surface, {});
        // The circle never moved (the snap folded the jitter to zero)
        expect(committedElements()[0].getAttribute('cx')).toBe('400');
        expect(committedElements()[0].getAttribute('cy')).toBe('300');

        originPrev = readOriginCross();
        expectDrawingAlive();
    });

    it('zoom out + zoom in then a no-move shape click keeps drawing AND panning alive (user scene)', () => {
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        // Circle: center world (0,0), r 100
        fireEvent.click(screen.getByTestId('tool-circle'));
        fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
        fireEvent.pointerUp(surface, {});
        fireEvent.click(screen.getByTestId('tool-circle')); // disarm

        // Wheel-zoom OUT six notches then IN six (deltaY 100 = one notch ×
        // 1.2): the scale round-trips to ≈1 — the user is "back" where
        // they started, slightly drifted
        for (let index = 0; index < 6; index++) {
            fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaY: 100 });
        }
        for (let index = 0; index < 6; index++) {
            fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaY: -100 });
        }

        // FIRST press after the zoom lands on a shape (the origin cross
        // always marks world (0,0) = the circle's center node) with NO
        // move — the exact re-orient click that used to brick every gesture
        const junction = readOriginCross();
        fireEvent.pointerDown(surface, { clientX: junction.x, clientY: junction.y, button: 0 });
        fireEvent.pointerUp(surface, {});

        originPrev = junction;
        expectDrawingAlive();
    });

    describe('pointercancel — a browser-cancelled gesture unwinds like a leave', () => {
        it('a cancelled drawing drag discards the draft and the next press draws fresh', () => {
            render(<DrawDashboard />);
            const surface = stubSurfaceRect();

            // Circle first (the only committed shape)
            fireEvent.click(screen.getByTestId('tool-circle'));
            fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
            fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
            fireEvent.pointerUp(surface, {});

            // Arm the line tool, start a drag, let the browser cancel it
            // mid-draw (touchpad gesture takeover etc.)
            fireEvent.click(screen.getByTestId('tool-line'));
            fireEvent.pointerDown(surface, { clientX: 200, clientY: 300, button: 0 });
            fireEvent.pointerMove(surface, { clientX: 300, clientY: 300 });
            expect(draftElement()).not.toBeNull(); // the mid-draw draft lives
            fireEvent.pointerCancel(surface, {});
            // The gesture unwound: no committed shape, NO orphaned draft
            expect(committedElements().length).toBe(1);
            expect(draftElement()).toBeNull();

            // A fresh press draws normally (no latched flag, no zombie)
            fireEvent.pointerDown(surface, { clientX: 200, clientY: 300, button: 0 });
            fireEvent.pointerMove(surface, { clientX: 300, clientY: 300 });
            fireEvent.pointerUp(surface, {});
            expect(committedElements().length).toBe(2);
            expect(committedElements()[1].getAttribute('d')).toBe('M 200 300 Q 250 300 300 300');
        });

        it('a cancelled node-grab keeps the adjusted geometry and never latches', () => {
            render(<DrawDashboard />);
            const surface = stubSurfaceRect();

            // Circle: center (0,0), r 100
            fireEvent.click(screen.getByTestId('tool-circle'));
            fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
            fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
            fireEvent.pointerUp(surface, {});
            fireEvent.click(screen.getByTestId('tool-circle')); // disarm

            // Grab the center node, drag it a full grid step (the per-move
            // adjustment writes live), then the browser cancels the pointer
            fireEvent.pointerDown(surface, { clientX: 400, clientY: 300, button: 0 });
            fireEvent.pointerMove(surface, { clientX: 500, clientY: 300 });
            fireEvent.pointerCancel(surface, {});
            // The adjusted geometry STAYS (cancel behaves like leave: it
            // keeps the moved shape — no draft involvement here)
            const circle = committedElements()[0];
            expect(circle.getAttribute('cx')).toBe('500');
            expect(circle.getAttribute('cy')).toBe('300');
            expect(circle.getAttribute('r')).toBe('100');

            // And nothing latched: a fresh draw works
            fireEvent.click(screen.getByTestId('tool-line'));
            fireEvent.pointerDown(surface, { clientX: 200, clientY: 300, button: 0 });
            fireEvent.pointerMove(surface, { clientX: 300, clientY: 300 });
            fireEvent.pointerUp(surface, {});
            expect(committedElements().length).toBe(2);
            expect(committedElements()[1].getAttribute('d')).toBe('M 200 300 Q 250 300 300 300');
        });
    });

    it('the grid SVG is a presentation layer — never a pointer target', () => {
        render(<DrawDashboard />);
        stubSurfaceRect();
        // Presentation-only contract (same as the drawing + node overlays):
        // the whole-viewport grid svg must not flip event.target between the
        // surface and its transient <line> children
        expect(screen.getByTestId('grid-svg').style.pointerEvents).toBe('none');
    });
});

