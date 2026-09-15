import React from 'react';
import {
    styledComponent,
    useReferenceHook,
    useStateHook,
} from '@presource/react';
import {
    applyPan,
    applyZoom,
    createInitialTransform,
    normalizeWheelFactor,
    screenToCanvas,
} from '../functions/canvasTransform';
import type { CanvasTransform } from '../functions/canvasTransform';
import { GridLayer } from '../components/GridLayer';
import { ZoomHud } from '../components/ZoomHud';
import { CoordinateHud } from '../components/CoordinateHud';
import {
    PALETTE_ACCENT,
    PALETTE_BORDER,
    PALETTE_BACKGROUND,
    PALETTE_SURFACE,
    PALETTE_TEXT_BRIGHT,
    PALETTE_TEXT_FAINT,
} from '../functions/palette';

// ─────────────────────────────────────────────────────────────────────────────
// DrawDashboard — the infinite grid canvas.
//
// LAYOUT (user contract: "there is no header or footer here; the title should
// simply be 'Draw Dashboard v1.0.0' floating top left"): the canvas fills the
// ENTIRE viewport. No header bar, no footer bar. The version title is a small
// floating label pinned to the top-left corner, above the canvas (pointer-
// events: none so it never blocks canvas interaction).
//
// INTERACTION MODEL (all state = ONE CanvasTransform { x, y, scale }):
// - Mouse wheel anywhere on the canvas → zoom AT THE POINTER (the canvas
//   point under the cursor stays pinned under the cursor — see applyZoom).
//   Unbounded in both directions (clamped only at the IEEE float edge).
// - Horizontal wheel (tilt wheel / trackpad sideways / Shift+wheel — the
//   browser folds Shift+vertical-wheel into deltaX) → pan LEFT/RIGHT at
//   constant VISUAL speed (same ÷scale compensation as dragging — see
//   applyPan). deltaX never zooms.
// - Plain left-drag on the empty canvas → pan (grab-the-paper). This is the
//   "if not directly click on anything, drag to look around" contract: the
//   default gesture on empty canvas space is LOOK/PAN, not selection.
//   Space held + drag, OR middle-button drag → pan as well (power users).
//   A left-drag that STARTS on an interactive HUD control (the ZoomHud
//   panel — marked data-hud) does NOT pan, so HUD buttons keep their click
//   behavior (cross-reference: ZoomHud.tsx HudPanel).
// - "Reset view" HUD button → back to origin-centered, scale 1.
//
// GRID MODEL: ONE size, always (see GridLayer.tsx + GRID_SCREEN_SPACING) —
// zooming never resizes the grid, it only slides.
//
// POINTER MATH: all event coordinates are converted to viewport-relative
// pixels via getBoundingClientRect (getPointerPoint below) — required
// because jsdom reports clientX/Y relative to the viewport while the canvas
// may not start at (0, 0).
// ─────────────────────────────────────────────────────────────────────────────

// Local palette tokens (declared BEFORE the styled rules — the
// styledComponent input objects evaluate eagerly at module init, so the
// constants must already exist. Cross-reference: ScribbleDashboard.tsx
// imports them from ../functions instead; kept local for a minimal surface.)
// Canvas well background (deeper than the app background)
const PALETTE_WELL = '#1a1b26';

// Root shell — locked to the viewport (app.css zeroes the body margin and
// locks overflow). The canvas IS the whole app: no header, no footer.
const DashboardRoot = styledComponent('div', {
    height: '100%',
    width: '100%',
    position: 'relative' as const,
    background: PALETTE_WELL,
    color: '#a9b1d6',
    fontFamily:
        'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    boxSizing: 'border-box' as const,
    overflow: 'hidden' as const,
});

// Canvas surface — fills the entire viewport, captures wheel + pointer
// events. Ref-forwarding cast: the styledComponent return type (React.FC)
// lacks `ref` — Emotion forwards it at runtime (same cast pattern documented
// in the presource styledComponent notes).
const CanvasSurface = styledComponent<{ panning: boolean }>(
    'div',
    {
        position: 'absolute' as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden' as const,
        // grab by default (the whole canvas is draggable now — plain
        // left-drag pans), grabbing while actively panning
        cursor: ({ panning }) => (panning ? 'grabbing' : 'grab'),
    },
) as unknown as React.FC<
    { panning: boolean } & React.HTMLAttributes<HTMLDivElement> & {
        ref?: React.Ref<HTMLDivElement>;
    }
>;

// Floating title — "Draw Dashboard v1.0.0" pinned top-left, ABOVE the canvas
// but click-through (pointerEvents: none) so it never blocks zoom/pan. The
// version comes from the compile-time __APP_VERSION__ constant injected by
// vite.config.ts `define` (declared ambient in src/vite-env.d.ts).
const FloatingTitle = styledComponent('div', {
    position: 'absolute' as const,
    top: 12,
    left: 16,
    zIndex: 10,
    fontSize: 13,
    fontWeight: 600,
    color: PALETTE_TEXT_BRIGHT,
    // Subtle scrim so the title stays readable over grid lines
    background: 'rgba(26, 27, 38, 0.7)',
    padding: '4px 10px',
    borderRadius: 6,
    pointerEvents: 'none' as const,
    userSelect: 'none' as const,
});

export const DrawDashboard = React.memo(() => {
    // THE single source of truth for the canvas: pan (x, y in canvas units
    // at the viewport's top-left corner) + scale.
    const transform = useStateHook<CanvasTransform>(createInitialTransform(800, 600));

    // Interaction state
    const spaceHeld = useStateHook(false);
    const panning = useStateHook(false);

    // Cursor position for the coordinate HUD: the viewport-relative pointer
    // point while the pointer is over the canvas, null when it is not (the
    // HUD hides instead of showing stale numbers). Kept in STATE (not a
    // ref) because the HUD renders it — every pointer move re-renders the
    // dashboard with the fresh coordinate readout.
    const cursorPoint = useStateHook<{ x: number; y: number } | null>(null);

    // Refs for pointer-drag bookkeeping (no re-render on drag-move — the
    // transform state itself drives the render)
    const surfaceRef = useReferenceHook<HTMLDivElement | null>(null);
    const lastPointer = useReferenceHook<{ x: number; y: number } | null>(null);

    // Viewport size of the canvas area (for the grid renderer + reset
    // centering). Kept in state so the grid re-renders on resize.
    const viewportSize = useStateHook<{ width: number; height: number }>({
        width: 800,
        height: 600,
    });

    // Viewport-relative pointer position from a mouse event (the canvas may
    // be offset in non-fullscreen embeds — clientX/Y alone would be wrong)
    const getPointerPoint = (event: { clientX: number; clientY: number }) => {
        const surface = surfaceRef();
        if (!surface) return { x: event.clientX, y: event.clientY };
        const rect = surface.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    // Measure the canvas area on mount + on window resize. The measure
    // callback reads rect LAZILY on every invocation (not once at
    // effect-mount) so test environments that stub getBoundingClientRect
    // after render still measure correctly on the next resize/reset.
    React.useEffect(() => {
        const measure = () => {
            const surface = surfaceRef();
            if (!surface) return;
            const rect = surface.getBoundingClientRect();
            // Guard: a zero-size rect (jsdom before layout, or a hidden
            // surface) must not wipe the viewport to 0×0 — the grid math
            // divides by the size and the reset centers by it. Keep the
            // previous/initial size instead.
            if (rect.width <= 0 || rect.height <= 0) return;
            viewportSize({ width: rect.width, height: rect.height });
        };
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, []);

    // ── Wheel → zoom (deltaY) / horizontal pan (deltaX) ──
    // React attaches wheel as a PASSIVE listener — preventDefault would warn
    // and fail, so the listener is attached manually with { passive: false }
    // to block the browser's zoom/scroll and own the gesture.
    React.useEffect(() => {
        const surface = surfaceRef();
        if (!surface) return;
        const handleWheel = (event: WheelEvent) => {
            event.preventDefault();
            const point = getPointerPoint(event);
            // NOTE: useStateHook's setter takes a VALUE, not a React-style
            // updater function (cross-reference:
            // packages/presource/react/src/hooks/local/state.ts — the setter
            // writes the argument straight into the reference). Read-then-
            // write instead: the handle identity is stable, so `transform()`
            // inside the listener always reads the LIVE value.
            // HORIZONTAL wheel first: tilt-wheel / trackpad side-scroll
            // (and Shift+wheel, which browsers report as deltaX) pans the
            // canvas left/right. NATURAL SCROLL convention (like a page):
            // tilting/scrolling right scrolls the viewport right, i.e. the
            // content slides LEFT → the paper moves −dx (opposite of the
            // drag gesture, where the paper follows the hand). The negated
            // dx feeds applyPan, which ÷scales it for zoom-compensated
            // visual speed (same contract as dragging).
            if (event.deltaX !== 0) {
                // deltaMode 1 (lines) → ~100px per line, matching the
                // NOTCH_PIXELS convention in normalizeWheelFactor
                const dx =
                    event.deltaMode === 1 ? event.deltaX * 100 : event.deltaX;
                transform(applyPan(transform(), -dx, 0));
            }
            // VERTICAL wheel: zoom at the pointer (unchanged contract).
            // A pure horizontal event has deltaY === 0 → normalizeWheelFactor(0)
            // returns 1 → applyZoom is a no-op, so the two gestures compose
            // cleanly on diagonal trackpad scrolls.
            transform(applyZoom(transform(), normalizeWheelFactor(event.deltaY), point));
        };
        surface.addEventListener('wheel', handleWheel, { passive: false });
        return () => surface.removeEventListener('wheel', handleWheel);
    }, []);

    // ── Space key → pan mode arming ──
    React.useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.code === 'Space') spaceHeld(true);
        };
        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code === 'Space') spaceHeld(false);
        };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, []);

    // ── Pointer drag → pan (plain left-drag, space+drag, or middle-drag) ──
    // Plain left-drag pans ONLY when the drag starts on empty canvas (the
    // "drag anywhere to look around" contract). If the pointer-down lands
    // on the HUD (the ZoomHud panel subtree, marked data-hud), the gesture
    // is left alone so HUD buttons remain clickable.
    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        // Track the cursor for the coordinate HUD regardless of the gesture
        // (the readout must show coordinates even when no pan starts)
        cursorPoint(getPointerPoint(event));
        // Any drag starting on the HUD subtree belongs to the HUD, not the
        // canvas (button clicks, future HUD drags, etc.)
        const target = event.target as HTMLElement;
        if (target.closest?.('[data-hud]')) return;
        // Allowed gestures: plain left-drag (the default look-around), or
        // the power-user variants (space+drag, middle-button drag)
        const allowed = event.button === 0 || spaceHeld() || event.button === 1;
        if (!allowed) return;
        event.preventDefault();
        (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
        lastPointer(getPointerPoint(event));
        panning(true);
    };

    // Cursor tracking for the coordinate HUD (fires on EVERY move — not
    // just while panning — so the readout always follows the pointer)
    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const point = getPointerPoint(event);
        cursorPoint(point);
        if (!panning()) return;
        const last = lastPointer();
        if (!last) return;
        // Pan by the pointer delta (grab-the-paper: the paper follows the
        // hand). Read-then-write — the useStateHook setter takes a VALUE
        // (see the wheel handler note above).
        transform(applyPan(transform(), point.x - last.x, point.y - last.y));
        lastPointer(point);
    };

    const endPan = () => {
        panning(false);
        lastPointer(null);
    };

    // Pointer left the canvas → hide the coordinate HUD (null = hidden)
    const handlePointerLeave = () => {
        cursorPoint(null);
        endPan();
    };

    // ── HUD reset ──
    const handleReset = () => {
        const { width, height } = viewportSize();
        transform(createInitialTransform(width, height));
    };

    return (
        <DashboardRoot data-testid="dashboard-root">
            <CanvasSurface
                ref={surfaceRef as never}
                panning={panning()}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={endPan}
                onPointerLeave={handlePointerLeave}
                data-testid="canvas-surface"
            >
                {/* The SVG grid — recomputed from the transform each render.
                    ONE grid size at every zoom (see GridLayer). */}
                <svg
                    width={viewportSize().width}
                    height={viewportSize().height}
                    data-testid="grid-svg"
                    style={{ display: 'block' }}
                >
                    <GridLayer
                        transform={transform()}
                        width={viewportSize().width}
                        height={viewportSize().height}
                        colors={{ line: PALETTE_BORDER, origin: PALETTE_ACCENT }}
                    />
                </svg>
                {/* Floating zoom HUD (bottom-right): scientific-notation
                    scale readout + Reset view. Wrapped in a data-hud
                    container so plain left-drag can distinguish "gesture
                    started on the HUD" from "gesture started on empty
                    canvas" (the HUD must stay clickable/draggable on its
                    own terms — see handlePointerDown). */}
                <div data-hud="zoom-hud">
                    <ZoomHud
                        transform={transform()}
                        onReset={handleReset}
                        colors={{
                            border: PALETTE_BORDER,
                            text: PALETTE_TEXT_FAINT,
                            textBright: PALETTE_TEXT_BRIGHT,
                            hover: PALETTE_SURFACE,
                        }}
                    />
                </div>
                {/* Floating coordinate HUD (bottom-left): the pointer's
                    canvas position relative to the world origin — the
                    center of the entire canvas (the accent cross). Hidden
                    when the pointer is off the canvas. Click-through: the
                    drag-to-pan gesture works through it. */}
                <CoordinateHud
                    // Resolve the viewport-relative cursor point to canvas
                    // coordinates relative to the origin (screen = (canvas
                    // − pan) × scale → canvas = screen / scale + pan; the
                    // pan IS the origin-relative canvas coordinate of the
                    // viewport's top-left corner)
                    point={
                        cursorPoint()
                            ? screenToCanvas(cursorPoint() as { x: number; y: number }, transform())
                            : null
                    }
                    colors={{ border: PALETTE_BORDER, text: PALETTE_TEXT_FAINT }}
                />
            </CanvasSurface>
            {/* Floating title — top-left, click-through, above the canvas.
                NO header bar, NO footer bar: the canvas owns the viewport. */}
            <FloatingTitle data-testid="floating-title">
                Draw Dashboard v{__APP_VERSION__}
            </FloatingTitle>
        </DashboardRoot>
    );
});

// Re-export for consumers that want the canvas-space read helper alongside
// the dashboard (pure math passthrough — see canvasTransform.ts)
export { applyPan, applyZoom, screenToCanvas } from '../functions/canvasTransform';
