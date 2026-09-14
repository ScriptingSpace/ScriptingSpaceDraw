import React from 'react';
import {
    canvasToScreen,
    gridLineCount,
    gridScreenSpacing,
    MIN_SCREEN_SPACING,
} from '../functions/canvasTransform';
import type { CanvasTransform } from '../functions/canvasTransform';

// ─────────────────────────────────────────────────────────────────────────────
// GridLayer — the SVG grid renderer for the infinite canvas.
//
// WORLD-ANCHORED GRID, FIXED WORLD CELL SIZE (user contract: "the grid size
// is fixed, like 100px, and zooming in and out would shrink or grow these
// like it normally would"): every grid line sits at a WORLD coordinate that
// is a multiple of BASE_SPACING = 100 canvas units — at every zoom level.
// On screen the cells render at BASE_SPACING × scale px:
// - zoom IN  → cells GROW  (100-unit cell becomes 120px, 240px, …)
// - zoom OUT → cells SHRINK (100-unit cell becomes 80px, 40px, …)
// exactly like a normal canvas app (Figma/Miro). Panning slides the grid
// with the world; the world origin (0, 0) always sits on an intersection.
//
// FADE-OUT at extreme zoom-out: when the screen spacing drops below
// MIN_SCREEN_SPACING (2px) the lines would merge into solid noise and the
// line count would explode; the whole grid fades to 0 opacity there
// (graceful degradation — no user operates in that regime).
//
// LINE CULLING: only the lines intersecting the current viewport are drawn.
// The count is gridLineCount(width/height) — bounded by the viewport ÷
// spacing, so the "infinite" plane never grows the DOM.
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
    // Screen spacing of one grid cell at the current scale — GROWS when
    // zooming in, SHRINKS when zooming out (the world-anchored contract)
    const spacing = gridScreenSpacing(transform.scale);

    // Screen position of the world origin — the grid's anchor. Lines sit at
    // world multiples of BASE_SPACING, whose screen positions are
    // (k × BASE_SPACING − pan) × scale = k × spacing − originScreen.
    const originScreen = canvasToScreen({ x: 0, y: 0 }, transform);

    // Extreme zoom-out guard: below the visibility floor the lines merge
    // into noise → render nothing (fade handled by the opacity below)
    if (spacing < MIN_SCREEN_SPACING) {
        return (
            <g data-testid="grid-layer" opacity={0}>
                <line
                    x1={originScreen.x - 8}
                    y1={originScreen.y}
                    x2={originScreen.x + 8}
                    y2={originScreen.y}
                    stroke="transparent"
                    strokeWidth={2}
                    data-testid="origin-cross-h"
                />
                <line
                    x1={originScreen.x}
                    y1={originScreen.y - 8}
                    x2={originScreen.x}
                    y2={originScreen.y + 8}
                    stroke="transparent"
                    strokeWidth={2}
                    data-testid="origin-cross-v"
                />
            </g>
        );
    }

    // First VISIBLE line index per axis: lines sit at world multiples of
    // BASE_SPACING; the screen position of world (k × BASE_SPACING) is
    //   (k × BASE_SPACING − pan) × scale = k × spacing + originScreen
    // (originScreen = (0 − pan) × scale — the origin's own projection, so
    // the k = 0 line passes exactly through the origin intersection).
    // The first visible index is the smallest k whose line is at or right
    // of the left edge:
    //   k × spacing + originScreen ≥ 0 → k ≥ −originScreen / spacing
    //   → k = ceil(−originScreen / spacing)
    // Computed in SCREEN space (bounded numbers) — avoids catastrophic float
    // cancellation at extreme scales (canvas coordinates reach ±1e300).
    const firstIndexX = Math.ceil(-originScreen.x / spacing);
    const firstIndexY = Math.ceil(-originScreen.y / spacing);

    // Line counts are bounded by the viewport ÷ spacing — the "infinite"
    // plane never grows the DOM (module header note)
    const countX = gridLineCount(width, spacing);
    const countY = gridLineCount(height, spacing);

    // Build the line elements. Plain loops into preallocated arrays — the
    // counts are tiny (≤ ~200 per axis pair) and callback-object overhead
    // would dominate this hot render path.
    const verticals: React.ReactElement[] = new Array(countX);
    for (let index = 0; index < countX; index++) {
        const x = (firstIndexX + index) * spacing + originScreen.x;
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
        const y = (firstIndexY + index) * spacing + originScreen.y;
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
