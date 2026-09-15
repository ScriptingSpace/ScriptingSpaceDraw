// ─────────────────────────────────────────────────────────────────────────────
// REMOVABLE feature plugin: DRAWING LAYER — renders committed shapes + draft.
//
// The render side of the tool system: on every execution pass it projects
// every committed shape (context.drawing().shapes) plus the live draft
// (context.drawing().draft) from world space to screen space (shapeToScreen)
// and returns one SVG covering the viewport.
//
// The DRAFT renders with a dashed accent stroke (the live preview look);
// committed shapes render with the solid text color. Shapes are world-
// anchored: panning slides them, zooming scales them (same contract as the
// grid).
//
// REMOVABLE: removing it hides all drawings (the shapes stay in the state —
// re-adding the plugin brings them back).
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { shapeToScreen } from '../../functions/shapes';
import type { DrawShape } from '../../functions/shapes';
import { mountOf } from '../core/DrawPluginRegistry';
import type { DrawPlugin, DrawPluginContext } from '../core';

// Renders ONE projected shape as an SVG element. Committed strokes are
// solid; the draft (dashed = true) renders with a dashed accent stroke.
const ShapeElement = ({
    shape,
    dashed,
}: {
    shape: DrawShape; // already projected to screen space
    dashed: boolean;
}): React.ReactElement | null => {
    // Common stroke attributes — dashed only for the live draft
    const strokeProps = {
        stroke: dashed ? 'var(--draw-shape-draft)' : 'var(--draw-shape-line)',
        strokeWidth: 2,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
        fill: 'none',
        ...(dashed ? { strokeDasharray: '6 4' } : {}),
    };
    switch (shape.kind) {
        case 'path':
            // A polyline — skip degenerate single-point paths
            if (shape.points.length < 2) return null;
            return (
                <polyline
                    points={shape.points.map((point) => `${point.x},${point.y}`).join(' ')}
                    {...strokeProps}
                />
            );
        case 'circle':
            if (shape.radius <= 0) return null;
            return (
                <circle cx={shape.center.x} cy={shape.center.y} r={shape.radius} {...strokeProps} />
            );
        case 'rect': {
            const x = shape.min.x;
            const y = shape.min.y;
            const width = shape.max.x - shape.min.x;
            const height = shape.max.y - shape.min.y;
            if (width <= 0 || height <= 0) return null;
            return <rect x={x} y={y} width={width} height={height} {...strokeProps} />;
        }
        case 'line':
            return (
                <line
                    x1={shape.start.x}
                    y1={shape.start.y}
                    x2={shape.end.x}
                    y2={shape.end.y}
                    {...strokeProps}
                />
            );
    }
};

// The plugin function — returns the shapes SVG on every execution.
export const drawingLayerPlugin = mountOf(
    (context: DrawPluginContext) => {
        const transform = context.transform();
        const drawing = context.drawing();
        const { width, height } = context.viewport();
        // No transform yet, or nothing to draw → render nothing
        if (!transform || width <= 0 || height <= 0) return null;
        const shapes = drawing?.shapes ?? [];
        const draft = drawing?.draft ?? null;
        if (shapes.length === 0 && !draft) return null;

        return (
            <svg
                width={width}
                height={height}
                data-testid="drawing-layer"
                style={{
                    display: 'block',
                    // Overlay ABOVE the grid; click-through so pan/zoom and
                    // tool drags pass through to the surface
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    pointerEvents: 'none',
                }}
            >
                {/* Committed shapes — world-anchored, projected per pass */}
                {shapes.map((shape, index) => (
                    <ShapeElement
                        key={index}
                        shape={shapeToScreen(shape, transform)}
                        dashed={false}
                    />
                ))}
                {/* The live draft — dashed accent preview */}
                {draft ? (
                    <ShapeElement shape={shapeToScreen(draft, transform)} dashed />
                ) : null}
            </svg>
        );
    },
    // Mount slot: nothing to wire — pure render plugin
    () => undefined,
) satisfies DrawPlugin;
