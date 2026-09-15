import React from 'react';
import { styledComponent } from '@presource/react';

// ─────────────────────────────────────────────────────────────────────────────
// CoordinateHud — the floating cursor-position readout (bottom-left).
//
// Shows the canvas-space (x, y) of the pointer RELATIVE TO THE WORLD ORIGIN
// (0, 0) — the accent cross at the center of the canvas. The origin IS the
// center of the entire infinite canvas (createInitialTransform centers it;
// cross-reference: ../functions/canvasTransform.ts), so these are plain
// canvas coordinates: screen = (canvas − pan) × scale, inverted by
// screenToCanvas in the dashboard.
//
// The dashboard owns the pointer tracking (it already converts events to
// viewport-relative pixels) and passes the resolved canvas point down; this
// component is purely presentational. Hidden entirely when the pointer is
// off the canvas (point = null) — no stale "last known" numbers.
// ─────────────────────────────────────────────────────────────────────────────

// Floating pill anchored to the bottom-left of the canvas — mirrors the
// ZoomHud panel styling (cross-reference: ZoomHud.tsx HudPanel) so the two
// HUDs read as a pair in opposite corners. Click-through: pointer events
// pass to the canvas beneath (drag-to-pan works "through" this HUD).
const CoordPanel = styledComponent('div', {
    position: 'absolute' as const,
    left: 16,
    bottom: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    borderRadius: 8,
    background: 'rgba(26, 27, 38, 0.85)',
    border: '1px solid var(--draw-coord-border)',
    zIndex: 10,
    pointerEvents: 'none' as const,
    userSelect: 'none' as const,
});

// Monospace readout so digits don't jitter while moving (same font stack
// as the ZoomHud scale readout)
const CoordValue = styledComponent('span', {
    fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
    fontSize: 12,
    color: 'var(--draw-coord-text)',
    // Fixed min width for both axes: the readout doesn't resize (and the
    // panel doesn't wiggle) as digits change while the pointer moves
    minWidth: 150,
    textAlign: 'right' as const,
});

// formatCoordinate — one axis of the readout: sign-padded, 1 decimal.
// 1 decimal keeps the numbers stable under small sub-pixel drift at high
// zoom without implying false precision at low zoom.
// Examples: formatCoordinate(120, 'x') → "x −120.0" / formatCoordinate(0, 'y') → "y +0.0"
export const formatCoordinate = (value: number, axis: 'x' | 'y'): string => {
    // Guard non-finite inputs (defensive — the transform math keeps values
    // finite, but a NaN here would render "NaN" into the HUD)
    const safe = Number.isFinite(value) ? value : 0;
    const sign = safe < 0 ? '−' : '+';
    return `${axis} ${sign}${Math.abs(safe).toFixed(1)}`;
};

export const CoordinateHud = ({
    point,
    colors,
}: {
    // Canvas-space pointer position relative to the origin, or null when
    // the pointer is off the canvas (HUD hidden)
    point: { x: number; y: number } | null;
    // Palette tokens injected as CSS custom properties (same pattern as
    // ZoomHud — the styled rules stay palette-agnostic)
    colors: { border: string; text: string };
}): React.ReactElement => {
    // Pointer off-canvas → render nothing (no stale coordinates)
    if (!point) return <></>;
    return (
        <CoordPanel
            style={{
                ['--draw-coord-border' as never]: colors.border,
                ['--draw-coord-text' as never]: colors.text,
            }}
            data-testid="coord-hud"
        >
            <CoordValue data-testid="coord-value">
                {formatCoordinate(point.x, 'x')}
                {'  '}
                {formatCoordinate(point.y, 'y')}
            </CoordValue>
        </CoordPanel>
    );
};
