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
import {
    PALETTE_ACCENT,
    PALETTE_BORDER,
    PALETTE_BACKGROUND,
    PALETTE_SURFACE,
    PALETTE_TEXT_BRIGHT,
    PALETTE_TEXT_BODY,
    PALETTE_TEXT_FAINT,
} from '../functions/palette';

// ─────────────────────────────────────────────────────────────────────────────
// DrawDashboard — the infinite grid canvas.
//
// INTERACTION MODEL (all state = ONE CanvasTransform { x, y, scale }):
// - Mouse wheel anywhere on the canvas → zoom AT THE POINTER (the canvas
//   point under the cursor stays pinned under the cursor — see applyZoom).
//   Unbounded in both directions (clamped only at the IEEE float edge).
// - Space held + mouse drag, OR middle-button drag → pan (grab-the-paper).
// - "Reset view" HUD button → back to origin-centered, scale 1.
//
// RENDER MODEL: a single SVG covering the viewport. The grid (GridLayer)
// draws the three visible grid levels; the transform is applied by
// recomputing line positions from the transform each render (no CSS
// transform on a giant plane — that would break down at extreme scales).
//
// POINTER MATH: all event coordinates are converted to viewport-relative
// pixels via getBoundingClientRect (getPointerPoint below) — required
// because jsdom reports clientX/Y relative to the viewport while the canvas
// may not start at (0, 0) once the header/footer take their space.
// ─────────────────────────────────────────────────────────────────────────────

// Local palette tokens (declared BEFORE the styled rules — the
// styledComponent input objects evaluate eagerly at module init, so the
// constants must already exist; kept local for a minimal palette surface.
// Cross-reference: ScribbleDashboard.tsx imports them from ../functions.)
// Secondary subtitle color
const PALETTE_SECONDARY = '#bb9af7';
// Canvas well background (deeper than the app background)
const PALETTE_WELL = '#1a1b26';

// Canvas surface — fills the area between header and footer, captures wheel
// + pointer events. cursor reflects the interaction state (grab while
// space-dragging / panning). Ref-forwarding cast: the styledComponent return
// type (React.FC) lacks `ref` — Emotion forwards it at runtime (same cast
// pattern documented in the presource styledComponent notes).
const CanvasSurface = styledComponent<{ panning: boolean }>(
    'div',
    {
        position: 'relative' as const,
        flex: 1,
        minHeight: 0,
        overflow: 'hidden' as const,
        background: PALETTE_WELL,
        // grabbing while actively panning (the grab hint while space is held
        // but not yet dragging comes from the footer status line)
        cursor: ({ panning }) => (panning ? 'grabbing' : 'default'),
    },
) as unknown as React.FC<
    { panning: boolean } & React.HTMLAttributes<HTMLDivElement> & {
        ref?: React.Ref<HTMLDivElement>;
    }
>;

// Header bar — same geometry family as the Scribble/Formatter dashboards
const HeaderBar = styledComponent('header', {
    padding: '12px 16px',
    background: PALETTE_SURFACE,
    borderBottom: `1px solid ${PALETTE_BORDER}`,
});

const HeaderTitle = styledComponent('h1', {
    margin: 0,
    fontSize: 22,
    fontWeight: 700,
    color: PALETTE_TEXT_BRIGHT,
});

const HeaderSubtitle = styledComponent('p', {
    margin: 0,
    fontSize: 13,
    color: PALETTE_SECONDARY,
});

// Footer bar — version + hint line
const FooterBar = styledComponent('footer', {
    padding: '8px 16px',
    background: PALETTE_SURFACE,
    borderTop: `1px solid ${PALETTE_BORDER}`,
    fontSize: 12,
    color: PALETTE_TEXT_FAINT,
});

// Root shell — locked to the viewport (app.css zeroes the body margin and
// locks overflow), column layout: header / canvas / footer
const DashboardRoot = styledComponent('div', {
    height: '100%',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: PALETTE_BACKGROUND,
    color: PALETTE_TEXT_BODY,
    fontFamily:
        'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    boxSizing: 'border-box' as const,
    overflow: 'hidden' as const,
});

export const DrawDashboard = React.memo(() => {
    // THE single source of truth for the canvas: pan (x, y in canvas units
    // at the viewport's top-left corner) + scale. Initialized on first
    // measure (see the measure effect below).
    const transform = useStateHook<CanvasTransform>(createInitialTransform(800, 600));

    // Interaction state
    const spaceHeld = useStateHook(false);
    const panning = useStateHook(false);

    // Refs for pointer-drag bookkeeping (no re-render on drag-move — the
    // transform state itself drives the render)
    const surfaceRef = useReferenceHook<HTMLDivElement | null>(null);
    const lastPointer = useReferenceHook<{ x: number; y: number } | null>(null);

    // Viewport size of the canvas area (for the grid renderer + initial
    // centering). Kept in state so the grid re-renders on resize.
    const viewportSize = useStateHook<{ width: number; height: number }>({
        width: 800,
        height: 600,
    });

    // Viewport-relative pointer position from a mouse event (the canvas may
    // be offset by the header — clientX/Y alone would be wrong)
    const getPointerPoint = (event: { clientX: number; clientY: number }) => {
        const surface = surfaceRef();
        if (!surface) return { x: event.clientX, y: event.clientY };
        const rect = surface.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    // Measure the canvas area on mount + on window resize; seed the initial
    // transform so the world origin starts at the viewport center. The
    // measure callback reads rect LAZILY on every invocation (not once at
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

    // ── Wheel → zoom at pointer ──
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

    // ── Pointer drag → pan (space+drag or middle-button drag) ──
    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        const allowed = spaceHeld() || event.button === 1;
        if (!allowed) return;
        event.preventDefault();
        (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
        lastPointer(getPointerPoint(event));
        panning(true);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!panning()) return;
        const point = getPointerPoint(event);
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

    // ── HUD reset ──
    const handleReset = () => {
        const { width, height } = viewportSize();
        transform(createInitialTransform(width, height));
    };

    return (
        <DashboardRoot data-testid="dashboard-root">
            <HeaderBar>
                <HeaderTitle>Draw Dashboard</HeaderTitle>
                <HeaderSubtitle>
                    Infinite grid canvas — scroll to zoom, space + drag to pan
                </HeaderSubtitle>
            </HeaderBar>
            <CanvasSurface
                ref={surfaceRef as never}
                panning={panning()}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={endPan}
                onPointerLeave={endPan}
                data-testid="canvas-surface"
            >
                {/* The SVG grid — recomputed from the transform each render.
                    The canvas-space point under the cursor is exposed for
                    tests / future features via the data attribute below. */}
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
                    scale readout + Reset view */}
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
            </CanvasSurface>
            <FooterBar data-testid="dashboard-footer">
                <span data-testid="footer-version">Draw Dashboard v{__APP_VERSION__}</span>
                {' — '}
                <span data-testid="footer-cursor-info">
                    {panning() ? 'panning…' : spaceHeld() ? 'space held — drag to pan' : 'ready'}
                </span>
            </FooterBar>
        </DashboardRoot>
    );
});

// Re-export for consumers that want the canvas-space read helper alongside
// the dashboard (pure math passthrough — see canvasTransform.ts)
export { screenToCanvas };
