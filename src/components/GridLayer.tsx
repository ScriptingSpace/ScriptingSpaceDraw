import React from 'react';
import {
    canvasToScreen,
    gridLineCount,
    GRID_SCREEN_SPACING,
} from '../functions/canvasTransform';
import type { CanvasTransform } from '../functions/canvasTransform';

// ─────────────────────────────────────────────────────────────────────────────
// GridLayer — the SVG grid renderer for the infinite canvas.
//
// ONE-SIZE GRID (user contract: "the grid should be one size, and I can
// scroll freely without the grid repeating in size"): the grid is drawn at a
// CONSTANT screen spacing — GRID_SCREEN_SPACING px between lines at EVERY
// zoom level. There is no level ladder and no cross-fade: zooming never
// changes the grid's size, only its OFFSET (the lines slide so they stay
// anchored to the world origin, which always sits on an intersection).
// Panning slides the grid with the world; zooming slides it (the origin's
// screen position moves) while every spacing stays 64px.
//
// LINE CULLING: only the lines intersecting the current viewport are drawn.
// The count is gridLineCount(width/height) + 1 — bounded by the viewport, so
// the "infinite" plane never grows the DOM.
//
// ORIGIN CROSS: the world origin (0, 0) is highlighted with the accent color
// so the user always knows where they are on the plane.
// ─────────────────────────────────────────────────────────────────────────────

// The full grid surface. Props mirror the canvas viewport: the current
// transform and the pixel size of the canvas area. Consumed ONLY by
// DrawDashboard (see ../dashboards/DrawDashboard.tsx).
export const GridLayer = ({
    transform,
    width,
    height,
    colors,
}: {
    transform: CanvasTransform;
    width: number;
    height: number;
    // Grid line colors: { line, origin } — palette tokens passed in so this
    // component stays decoupled from the palette module
    colors: { line: string; origin: string };
}): React.ReactElement => {
    // Screen position of the world origin — the grid's anchor point. The
    // constant-size grid lines sit at originScreen ± multiples of
    // GRID_SCREEN_SPACING, so the origin ALWAYS lands exactly on a grid
    // intersection (the i = 0 line pair passes through it).
    const originScreen = canvasToScreen({ x: 0, y: 0 }, transform);

    // Line placement: anchor lines AT the origin and extend outward in both
    // directions. The lowest index is chosen so the first line is at or
    // before the left/top edge (Math.floor of the negative distance):
    //   first vertical index = floor((0 − originScreen.x) / spacing)
    //   → line x = originScreen.x + index × spacing ≤ 0
    // This keeps the origin on an intersection at EVERY zoom (the one-size
    // contract's anchoring requirement) and the count bounded by the
    // viewport. Computed in SCREEN space — no canvas-coordinate float
    // cancellation at extreme scales.
    const firstIndexX = Math.floor((0 - originScreen.x) / GRID_SCREEN_SPACING);
    const firstIndexY = Math.floor((0 - originScreen.y) / GRID_SCREEN_SPACING);

    // Line counts are bounded by the viewport size — the "infinite" plane
    // never grows the DOM (module header note). +1 slack on each side for
    // the boundary lines.
    const countX = gridLineCount(width) + 1;
    const countY = gridLineCount(height) + 1;

    // Build the line elements. Plain loops into preallocated arrays — the
    // counts are tiny (≤ ~200 per axis pair) and callback-object overhead
    // would dominate this hot render path.
    const verticals: React.ReactElement[] = new Array(countX);
    for (let index = 0; index < countX; index++) {
        const x = originScreen.x + (firstIndexX + index) * GRID_SCREEN_SPACING;
        verticals[index] = (
            <line
                key={`v${index}`}
                x1={x}
                y1={0}
                x2={x}
                y2={height}
                stroke={colors.line}
                strokeWidth={1}
            />
        );
    }
    const horizontals: React.ReactElement[] = new Array(countY);
    for (let index = 0; index < countY; index++) {
        const y = originScreen.y + (firstIndexY + index) * GRID_SCREEN_SPACING;
        horizontals[index] = (
            <line
                key={`h${index}`}
                x1={0}
                y1={y}
                x2={width}
                y2={y}
                stroke={colors.line}
                strokeWidth={1}
            />
        );
    }

    // Origin visibility: hide the cross entirely when the origin is
    // off-screen (the cross would otherwise render as huge clipped lines)
    const originVisible =
        originScreen.x >= -8 &&
        originScreen.x <= width + 8 &&
        originScreen.y >= -8 &&
        originScreen.y <= height + 8;

    return (
        <g data-testid="grid-layer">
            {verticals}
            {horizontals}
            {/* Origin cross — horizontal + vertical accent strokes through
                world (0, 0), 16px long, centered on the origin. stroke is an
                SVG attribute (not emotion CSS) so the visibility toggle is a
                hard on/off readable from the DOM. */}
            <line
                x1={originScreen.x - 8}
                y1={originScreen.y}
                x2={originScreen.x + 8}
                y2={originScreen.y}
                stroke={originVisible ? colors.origin : 'transparent'}
                strokeWidth={2}
                data-testid="origin-cross-h"
            />
            <line
                x1={originScreen.x}
                y1={originScreen.y - 8}
                x2={originScreen.x}
                y2={originScreen.y + 8}
                stroke={originVisible ? colors.origin : 'transparent'}
                strokeWidth={2}
                data-testid="origin-cross-v"
            />
        </g>
    );
};
