// ─────────────────────────────────────────────────────────────────────────────
// Infinite canvas transform math — the pure numeric core of the Draw dashboard.
//
// The canvas is a 2D pan/zoom viewport over an unbounded plane. All state is
// ONE transform: { x, y, scale } where (x, y) is the canvas-space coordinate
// that sits at the viewport's top-left corner and `scale` is the zoom factor
// (canvas unit → screen pixel ratio).
//
// Screen mapping (used by both rendering and interaction):
//   screen = (canvas - pan) * scale
//   canvas = screen / scale + pan
//
// ZOOM-AT-POINTER: when the wheel fires at screen point P, the canvas point
// UNDER THE CURSOR must stay under the cursor after the zoom. Solving
// canvas(P)₁ = canvas(P)₂ for the new pan:
//   pan₂ = P / scale + pan₁ − P / scale₂
// (P measured in viewport-relative pixels — getBoundingClientRect offset.)
//
// UNBOUNDED SCALE: wheel steps multiply the scale by a constant factor, so
// zoom is unbounded in both directions. IEEE-754 doubles saturate at
// ±1.7976931348623157e308; the clamp thresholds sit at the practical edge
// (SCALE_MAX = 1e300, SCALE_MIN = 1e-300) purely to keep arithmetic + the
// exponent display finite — no user reaches them.
//
// GRID — WORLD-ANCHORED, FIXED WORLD SIZE (user contract: "the grid size is
// fixed, like 100px, and zooming in and out would shrink or grow these like
// it normally would"): each grid cell represents a FIXED world size of
// BASE_SPACING = 100 canvas units. On screen the spacing is
// BASE_SPACING × scale — zooming IN grows the cells, zooming OUT shrinks
// them, exactly like a normal canvas app. The lines are world-anchored:
// they sit at world coordinates that are multiples of 100, so panning slides
// the grid and zooming scales it. The world origin (0, 0) always sits on a
// grid intersection.
// ─────────────────────────────────────────────────────────────────────────────

// The transform itself — see the module header for the coordinate contract
export type CanvasTransform = { x: number; y: number; scale: number };

// BASE_SPACING — the FIXED WORLD SIZE of one grid cell: 100 canvas units.
// Every grid line sits at a world coordinate that is a multiple of this, at
// every zoom level. On screen the cells render at BASE_SPACING × scale px.
export const BASE_SPACING = 100;

// MIN_SCREEN_SPACING — grid lines closer together than this (in screen px)
// are not drawn: below ~2px the lines merge into solid gray noise and the
// line count would explode toward the DOM limit. This only happens at
// extreme zoom-OUT (scale < 0.02); the grid fades out gracefully there.
export const MIN_SCREEN_SPACING = 2;

// Practical float-edge scale clamps — see the module header. NOT product
// limits: they sit ~57 orders of magnitude inside the IEEE-754 double wall
// (±1.7976931348623157e308) purely to keep arithmetic + exponent display
// finite. No user scrolls anywhere near these.
export const SCALE_MAX = 1e300;
export const SCALE_MIN = 1e-300;

// WHEEL_ZOOM_FACTOR — multiplicative zoom per wheel notch. Chosen so one
// notch ≈ the classic "smooth" feel (the default Figma/Miro step).
export const WHEEL_ZOOM_FACTOR = 1.2;

// DRAG_PAN_FACTOR — screen pixels of content movement per pointer pixel
// while dragging. 1:1 (grab-the-paper feel): the content under the hand
// follows the pointer exactly. The ZOOM COMPENSATION (dividing the screen
// delta by the scale) lives in applyPan — see below.
export const DRAG_PAN_FACTOR = 1;

// clampScale — enforce the float-edge bounds (and finite-ness). Defensive
// only: applyZoom already keeps scale inside these bounds; this guards
// against pathological inputs (0, negative, NaN) from any future caller.
export const clampScale = (scale: number): number => {
    if (!Number.isFinite(scale) || scale <= 0) return 1;
    return Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale));
};

// screenToCanvas — screen (viewport-relative px) → canvas units
export const screenToCanvas = (
    point: { x: number; y: number },
    transform: CanvasTransform,
): { x: number; y: number } => ({
    x: point.x / transform.scale + transform.x,
    y: point.y / transform.scale + transform.y,
});

// canvasToScreen — canvas units → screen (viewport-relative px)
export const canvasToScreen = (
    point: { x: number; y: number },
    transform: CanvasTransform,
): { x: number; y: number } => ({
    x: (point.x - transform.x) * transform.scale,
    y: (point.y - transform.y) * transform.scale,
});

// applyZoom — pure wheel-zoom step: multiply the scale by `factor` and shift
// the pan so the canvas point under `screen` stays pinned under the cursor
// (the zoom-at-pointer solve in the module header). Clamped to the float
// edge; the pin math uses the CLAMPED scale so the anchor holds even at the
// wall (the cursor pins to the clamped result, not to a scale that was
// rejected).
export const applyZoom = (
    transform: CanvasTransform,
    factor: number,
    screen: { x: number; y: number },
): CanvasTransform => {
    const nextScale = clampScale(transform.scale * factor);
    // pan₂ = P/scale₁ + pan₁ − P/scale₂  (derived in the module header)
    return {
        scale: nextScale,
        x: screen.x / transform.scale + transform.x - screen.x / nextScale,
        y: screen.y / transform.scale + transform.y - screen.y / nextScale,
    };
};

// applyPan — pure translate step for pointer dragging. `dx`/`dy` are SCREEN
// pixels (pointer delta); they are divided by the scale to get CANVAS units
// before shifting the pan. This is the zoom-compensation contract: the same
// hand motion moves the view by the same VISUAL amount at every zoom —
// at high zoom (large scale) a 100px hand drag is a tiny canvas distance
// (the world is magnified, so content tracks the hand 1:1 on screen); at
// low zoom (small scale) the same 100px covers a proportionally larger
// canvas distance. Without the ÷scale, high zoom would crawl (canvas delta
// overshoots the visual target) and low zoom would rocket (canvas delta
// undershoots) — exactly the bug this fixes.
//
// Grab-the-paper invariant: the canvas point under the pointer at drag
// start stays under the pointer for the whole drag (canvas = screen/scale
// + pan; holding canvas(P) fixed while screen(P) moves by (dx, dy) forces
// pan += (dx, dy)/scale).
export const applyPan = (
    transform: CanvasTransform,
    dx: number,
    dy: number,
): CanvasTransform => ({
    scale: transform.scale,
    x: transform.x - (dx * DRAG_PAN_FACTOR) / transform.scale,
    y: transform.y - (dy * DRAG_PAN_FACTOR) / transform.scale,
});

// gridScreenSpacing — the on-screen size of one grid cell at the given
// scale: BASE_SPACING world units × scale px/unit. Zoom in → bigger cells;
// zoom out → smaller cells (the world-anchored contract).
export const gridScreenSpacing = (scale: number): number => BASE_SPACING * scale;

// gridLineCount — how many grid lines fit across a viewport of `size` px at
// the given screen spacing (+1 for the boundary line). Bounded by the
// viewport ÷ spacing — the "infinite" plane never grows the DOM.
export const gridLineCount = (size: number, screenSpacing: number): number =>
    Math.ceil(size / screenSpacing) + 1;

// normalizeWheelFactor — wheel deltas arrive in wildly different units per
// browser/device (pixel-mode trackpads fire many small deltas; line-mode
// mice fire ~100px or ~3-line notches). This normalizes ANY incoming delta
// into a consistent zoom factor: sub-notch deltas accumulate fractionally
// (trackpad smoothness), full notches produce the full WHEEL_ZOOM_FACTOR
// step. Clamped to ±3 notches so a single giant delta cannot jump more.
export const normalizeWheelFactor = (deltaY: number): number => {
    // Magnitude of one notch in the delta's native units — browsers report
    // pixel-mode deltas in ~100px steps for a physical notch
    const NOTCH_PIXELS = 100;
    const notches = Math.max(-3, Math.min(3, deltaY / NOTCH_PIXELS));
    return Math.pow(WHEEL_ZOOM_FACTOR, notches);
};

// createInitialTransform — the resting state: origin at the viewport center,
// scale 1. Used by the dashboard on mount and by the Reset View control.
export const createInitialTransform = (
    viewportWidth: number,
    viewportHeight: number,
): CanvasTransform => ({
    x: -viewportWidth / 2,
    y: -viewportHeight / 2,
    scale: 1,
});

// formatExponent — the HUD zoom readout: "×1.200e+0" style (scientific
// notation with 4 significant digits). Scientific notation is REQUIRED here:
// the scale spans hundreds of orders of magnitude, where fixed notation
// produces 300-digit strings. Number.prototype.toString already switches to
// exponential past 1e21, but forcing it via toExponential keeps the format
// stable across the entire range.
export const formatExponent = (value: number): string => {
    const safe = clampScale(value);
    return `×${safe.toExponential(3)}`;
};
