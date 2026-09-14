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
// ZOOM-AT-POINTER (the "infinite magnification" contract): when the wheel
// fires at screen point P, the canvas point UNDER THE CURSOR must stay under
// the cursor after the zoom. Solving canvas(P)₁ = canvas(P)₂ for the new pan:
//   pan₂ = P / scale + pan₁ − P / scale₂
// (P measured in viewport-relative pixels — getBoundingClientRect offset.)
//
// UNBOUNDED SCALE (the "infinite zoom" contract): scale is clamped ONLY by
// floating-point limits, never by a hard max/min. Wheel steps multiply the
// scale by a constant factor, so the reachable set is { s₀ · fᵏ : k ∈ ℤ } —
// unbounded in BOTH directions in exact math. IEEE-754 doubles saturate at
// ±1.7976931348623157e308; to keep the UI responsive (and the exponent
// display finite) near that wall, the clamp thresholds sit at the practical
// edge: SCALE_MAX = 1e300, SCALE_MIN = 1e-300 — ~600 orders of magnitude of
// travel. Reaching them in practice is impossible via wheel steps (each step
// is ×1.2 → ~3,300 wheel notches of pure zoom-in from scale 1).
//
// GRID LEVELS (the "infinite magnification" rendering contract): the grid is
// a geometric ladder of spacings — each level is 8× the previous, rooted at
// BASE_SPACING = 64 (canvas units). Levels exist for EVERY scale exponent:
// levelForScale returns a valid level for any scale > 0, however extreme,
// because it is computed from log₂ of the screen-space spacing, not from a
// bounded list. Rendering picks the two levels whose screen spacing straddles
// the "comfortable" band and interpolates their opacity — at ANY zoom the
// screen always shows a fine grid, a coarse grid, and a smooth cross-fade
// between them. Cross-reference: src/functions/grid.ts consumes these helpers.
// ─────────────────────────────────────────────────────────────────────────────

// The transform itself — see the module header for the coordinate contract
export type CanvasTransform = { x: number; y: number; scale: number };

// BASE_SPACING — the canvas-unit spacing of grid level 0. All higher levels
// are exact powers-of-8 multiples of this, so world coordinates at any zoom
// always land on grid lines that are integer multiples of some level.
export const BASE_SPACING = 64;

// GRID_LEVEL_RATIO — how many times bigger each grid level is than the one
// below it. 8 = 2³ keeps every level an integer power-of-two multiple of the
// base, which preserves exactness in binary floating point (no rounding
// drift as levels climb).
export const GRID_LEVEL_RATIO = 8;

// Practical float-edge scale clamps — see the module header. NOT product
// limits: they sit ~57 orders of magnitude inside the IEEE-754 double wall
// (±1.7976931348623157e308) purely to keep arithmetic + exponent display
// finite.
export const SCALE_MAX = 1e300;
export const SCALE_MIN = 1e-300;

// WHEEL_ZOOM_FACTOR — multiplicative zoom per wheel notch. Chosen so one
// notch ≈ the classic "smooth" feel (≈ ×1.2 ≈ the default Figma/Miro step).
export const WHEEL_ZOOM_FACTOR = 1.2;

// WHEEL_PAN_FACTOR — pixels of pan per pixel of wheel delta while dragging
// space with the wheel (shift+wheel = horizontal). 1:1 feels native.
export const WHEEL_PAN_FACTOR = 1;

// DRAG_PAN_FACTOR — pan pixels per pointer pixel while space-dragging /
// middle-dragging. 1:1 (grab-the-paper feel); scale does NOT multiply drag
// speed — the paper moves with the hand.
export const DRAG_PAN_FACTOR = 1;

// Precision rounding for the derived grid numbers: spacing/opacity snap to
// 4 significant digits so consecutive renders produce IDENTICAL style values
// (stable DOM, stable snapshots, no churn from float noise).
const GRID_PRECISION = 4;

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

// applyPan — pure translate step: shift the pan by screen-space pixels
// (dragging the paper right moves the viewport window LEFT over the canvas,
// hence the minus sign).
export const applyPan = (
    transform: CanvasTransform,
    dx: number,
    dy: number,
): CanvasTransform => ({
    scale: transform.scale,
    x: transform.x - dx * DRAG_PAN_FACTOR,
    y: transform.y - dy * DRAG_PAN_FACTOR,
});

// gridLevelSpacing — canvas-unit spacing of level `level` (0-based). Exact
// power-of-two arithmetic: BASE_SPACING × 8^level = BASE_SPACING × 2^(3·level).
export const gridLevelSpacing = (level: number): number =>
    BASE_SPACING * Math.pow(GRID_LEVEL_RATIO, level);

// gridLevelScreenSpacing — how big one level's spacing renders on screen at
// the given scale (pixels between grid lines).
export const gridLevelScreenSpacing = (level: number, scale: number): number =>
    gridLevelSpacing(level) * scale;

// gridLevelOpacity — the cross-fade weight of a level inside the comfort
// band [MIN_SCREEN_SPACING, MAX_SCREEN_SPACING]. A level fully inside the
// band renders at full strength; a level whose spacing has grown past
// MAX_SCREEN_SPACING fades linearly toward 0 (it "hands over" to the next
// coarser level); a level below MIN is not rendered at all (the finer level
// owns that regime). Returns 0 for invisible levels.
export const gridLevelOpacity = (level: number, scale: number): number => {
    const screen = gridLevelScreenSpacing(level, scale);
    // Below the visibility floor → the finer levels own this regime
    if (screen < MIN_SCREEN_SPACING) return 0;
    // Inside the comfort band → fully visible
    if (screen <= MAX_SCREEN_SPACING) return 1;
    // Above the band → linear fade-out toward the next coarser level's
    // takeover point (8× further out). At exactly MAX → 1; at MAX × 8 → 0.
    // Clamped at 0: levels far above the band (multiple levels too coarse)
    // would otherwise produce negative weights.
    return Math.max(
        0,
        (MAX_SCREEN_SPACING * GRID_LEVEL_RATIO - screen) /
            (MAX_SCREEN_SPACING * (GRID_LEVEL_RATIO - 1)),
    );
};

// MIN_SCREEN_SPACING — grid lines closer together than this (in screen px)
// are not drawn (they would visually merge into gray noise).
export const MIN_SCREEN_SPACING = 12;
// MAX_SCREEN_SPACING — grid lines farther apart than this begin fading out
// (the next coarser level takes over — see gridLevelOpacity).
export const MAX_SCREEN_SPACING = 128;

// levelForScale — the FINEST grid level whose screen spacing is ≥
// MIN_SCREEN_SPACING at the given scale. Computed from log₂ (not from a
// bounded list), so it is valid for ANY scale > 0 — however extreme — which
// is the "infinite magnification" rendering guarantee. Returned levels are
// always integers (Math.ceil of a log can only produce integers).
export const levelForScale = (scale: number): number => {
    // Spacing grows by ×8 (2³) per level → level = ceil(log8(screenNeeded /
    // (base × scale))). The epsilon guards the exact-boundary float case.
    const ratio = MIN_SCREEN_SPACING / (BASE_SPACING * clampScale(scale));
    return Math.max(0, Math.ceil(Math.log(ratio) / Math.log(GRID_LEVEL_RATIO) - 1e-12));
};

// gridLevelsForScale — the render list: the finest visible level plus the
// next two coarser ones (fine / mid / coarse). Always exactly 3 levels for
// any scale > 0 — the mid level is always inside the comfort band by
// construction (its screen spacing is ≥ MIN and < MIN × 8 ≤ MAX).
export const gridLevelsForScale = (scale: number): number[] => {
    const base = levelForScale(scale);
    return [base, base + 1, base + 2];
};

// gridLevelStyle — the concrete SVG style numbers for one level at one scale:
// { spacingPx, opacity }. Both are precision-rounded (GRID_PRECISION digits)
// so identical inputs always produce identical style strings.
export const gridLevelStyle = (
    level: number,
    scale: number,
): { spacingPx: number; opacity: number } => ({
    spacingPx: toPrecision(gridLevelScreenSpacing(level, scale)),
    opacity: toPrecision(gridLevelOpacity(level, scale)),
});

// toPrecision — round to GRID_PRECISION significant digits (and normalize
// -0 → 0). Used by gridLevelStyle only.
const toPrecision = (value: number): number => {
    const rounded = Number(value.toPrecision(GRID_PRECISION));
    return rounded === 0 ? 0 : rounded;
};

// formatExponent — the HUD zoom readout: "×1.221e+3" style (scientific
// notation with 4 significant digits). Scientific notation is REQUIRED here:
// at the float edge the scale spans hundreds of orders of magnitude, where
// fixed notation produces 300-digit strings. Number.prototype.toString
// already switches to exponential past 1e21, but forcing it via toExponential
// keeps the format stable across the entire range.
export const formatExponent = (value: number): string => {
    const safe = clampScale(value);
    return `×${safe.toExponential(3)}`;
};

// normalizeWheelFactor — wheel deltas arrive in wildly different units per
// browser/device (pixel-mode trackpads fire many small deltas; line-mode
// mice fire ~100px or ~3-line notches). This normalizes ANY incoming delta
// into a consistent zoom factor: sub-notch deltas accumulate fractionally
// (trackpad smoothness), full notches produce the full WHEEL_ZOOM_FACTOR
// step. The factor is symmetric (zoom in for positive deltaY, out for
// negative) and never flips the sign of the scale.
export const normalizeWheelFactor = (deltaY: number): number => {
    // Magnitude of one notch in the delta's native units — browsers report
    // pixel-mode deltas in ~100px steps for a physical notch
    const NOTCH_PIXELS = 100;
    // Fractional exponent: deltaY of ±100 → ±1 full notch. Clamped to ±3 so
    // a single giant delta (some browsers on fast scroll) cannot jump more
    // than 3 notches at once.
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
