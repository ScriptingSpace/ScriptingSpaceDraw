import React from 'react';
import {
    canvasToScreen,
    gridLevelStyle,
    gridLevelsForScale,
} from '../functions/canvasTransform';
import type { CanvasTransform } from '../functions/canvasTransform';

// ─────────────────────────────────────────────────────────────────────────────
// GridLayer — the SVG grid renderer for the infinite canvas.
//
// Renders THREE grid levels (fine / mid / coarse) as SVG <line> strips, each
// with its own spacing + opacity derived from the current scale (see
// gridLevelStyle in ../functions/canvasTransform.ts). Because the level set
// is computed from log₂ of the scale — not from a bounded list — the grid
// stays correct at ANY magnification: zoom in 10× and finer levels fade in;
// zoom out 10× and coarser levels take over. There is no "edge" to reach.
//
// LINE CULLING: only the lines intersecting the current viewport are drawn.
// The count is viewportSize / spacingPx per axis (+1 for the boundary line),
// so at any zoom the DOM holds a small, bounded number of nodes (~200 total)
// regardless of how far the user has panned — the "infinite" plane never
// grows the DOM.
//
// ORIGIN CROSS: the world origin (0, 0) is highlighted with the accent color
// so the user always knows where they are on the plane.
// ─────────────────────────────────────────────────────────────────────────────

// One grid level's line strip — memoized so panning only re-renders levels
// whose line positions actually changed (spacing depends on scale, positions
// on pan; the memo key includes both).
type GridLevelProps = {
    level: number;
    scale: number;
    transform: CanvasTransform;
    width: number;
    height: number;
    color: string;
};

const GridLevelLines = ({
    level,
    scale,
    transform,
    width,
    height,
    color,
}: GridLevelProps): React.ReactElement | null => {
    // Style numbers for this level at this scale (precision-rounded — see
    // gridLevelStyle). opacity 0 → skip rendering entirely (the level is
    // outside its visibility regime at this zoom).
    const { spacingPx, opacity } = gridLevelStyle(level, scale);
    if (opacity <= 0 || spacingPx <= 0) return null;

    // Canvas-space position of the viewport's top-left corner
    const origin = canvasToScreen({ x: 0, y: 0 }, transform);
    // First VISIBLE vertical line: the first grid multiple at or right of
    // the left edge. In screen space the lines sit at multiples of spacingPx
    // offset by the origin's screen position — computing in screen space
    // (mod arithmetic on the offset) avoids catastrophic float cancellation
    // at extreme scales (canvas-space coordinates reach ±1e300; screen-space
    // offsets stay bounded by the viewport).
    const offsetX = ((origin.x % spacingPx) + spacingPx) % spacingPx;
    const offsetY = ((origin.y % spacingPx) + spacingPx) % spacingPx;
    // Line count is bounded by the viewport size — the "infinite" plane
    // never grows the DOM (module header note)
    const countX = Math.ceil(width / spacingPx) + 1;
    const countY = Math.ceil(height / spacingPx) + 1;

    // Build the line elements. Plain loops into preallocated arrays — the
    // counts are tiny (≤ ~200 per level) and arrayEach's callback-object
    // overhead would dominate this hot render path.
    const verticals: React.ReactElement[] = new Array(countX);
    for (let index = 0; index < countX; index++) {
        const x = index * spacingPx - offsetX;
        verticals[index] = (
            <line
                key={`v${index}`}
                x1={x}
                y1={0}
                x2={x}
                y2={height}
                stroke={color}
                strokeWidth={1}
            />
        );
    }
    const horizontals: React.ReactElement[] = new Array(countY);
    for (let index = 0; index < countY; index++) {
        const y = index * spacingPx - offsetY;
        horizontals[index] = (
            <line
                key={`h${index}`}
                x1={0}
                y1={y}
                x2={width}
                y2={y}
                stroke={color}
                strokeWidth={1}
            />
        );
    }

    return (
        <g opacity={opacity} data-testid={`grid-level-${level}`}>
            {verticals}
            {horizontals}
        </g>
    );
};

// The origin cross — two short accent lines through world (0, 0), rendered
// on TOP of the grid so the user can always locate the coordinate origin.
// Hidden entirely when the origin is off-screen (the cross would otherwise
// render as huge clipped lines).
//
// NOTE: plain <line> elements with the stroke as an SVG ATTRIBUTE (not
// emotion CSS) — CSS-class styling is invisible to getAttribute() in tests
// and the visibility toggle is a hard on/off, not a style variation.

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
    // The three render levels for the current scale (fine / mid / coarse)
    const levels = gridLevelsForScale(transform.scale);

    // Screen position of the world origin — drives the origin cross
    const originScreen = canvasToScreen({ x: 0, y: 0 }, transform);
    const originVisible =
        originScreen.x >= -8 &&
        originScreen.x <= width + 8 &&
        originScreen.y >= -8 &&
        originScreen.y <= height + 8;

    // The accent color is injected via a CSS custom property (styledComponent
    // has no per-instance CSS-variable support for static values) — set on
    // the wrapping <g> so both cross lines read it.
    return (
        <g style={{ ['--draw-origin-color' as never]: colors.origin }}>
            {levels.map((level) => (
                <GridLevelLines
                    key={level}
                    level={level}
                    scale={transform.scale}
                    transform={transform}
                    width={width}
                    height={height}
                    color={colors.line}
                />
            ))}
            {/* Origin cross — horizontal + vertical accent strokes through
                world (0, 0), 16px long, centered on the origin. stroke is an
                SVG attribute (see OriginCross note above). */}
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
