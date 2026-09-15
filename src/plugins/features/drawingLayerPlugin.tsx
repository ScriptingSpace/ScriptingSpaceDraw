// ─────────────────────────────────────────────────────────────────────────────
// REMOVABLE feature plugin: DRAWING LAYER — renders committed shapes + draft.
//
// The render side of the tool system: on every execution pass it projects
// every committed shape (context.drawing().shapes) plus the live draft
// (context.drawing().draft) from world space to screen space (shapeToScreen)
// and returns one SVG covering the viewport.
//
// STROKE COLORS (the "I'm not seeing anything" bug): strokes previously
// rendered through `var(--draw-shape-line)` / `var(--draw-shape-draft)` —
// CSS variables that were NEVER DEFINED anywhere, so every stroke collapsed
// to the SVG `stroke` initial value (`none`) → invisible drawings. Now the
// layer colors directly from the palette:
// - COMMITTED shapes render in their stamped creation-time `color`
//   (shapes carry the hex stamped by the tool plugins at draft time); a
//   shape without one falls back to the solid text ink (the pre-palette
//   look for legacy shapes).
// - The DRAFT renders dashed in the shape's stamped color (its creation
//   ink), falling back to the ACTIVE swatch (context.drawing().color) —
//   the live preview always shows the exact color it will commit as.
//
// SHAPE SET: curve (quadratic Bézier `M…Q…` — the Line tool), circle, rect
// (functions/shapes.ts — "circle, rectangle, line more like curve"; the
// freehand path shape was REMOVED per the grid contract).
//
// Shapes are world-anchored: panning slides them, zooming scales them (same
// contract as the grid). The node adjustment handles render in
// nodeEditorPlugin (separate overlay above this layer).
//
// REMOVABLE: removing it hides all drawings (the shapes stay in the state —
// re-adding the plugin brings them back).
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { shapeToScreen, shapeInk } from '../../functions/shapes';
import type { DrawShape } from '../../functions/shapes';
import { mountOf } from '../core/DrawPluginRegistry';
import type { DrawPlugin, DrawPluginContext } from '../core';

// Renders ONE projected shape as an SVG element. Committed strokes are
// solid in the shape's own (stamped) ink; the draft (dashed = true) renders
// with a dashed stroke in its live ink.
const ShapeElement = ({
    shape,
    color,
    dashed,
}: {
    shape: DrawShape; // already projected to screen space
    color: string; // resolved stroke ink (palette token hex)
    dashed: boolean;
}): React.ReactElement | null => {
    // Common stroke attributes — dashed only for the live draft. The stroke
    // is a direct palette hex — NOT a var() (see header: undefined custom
    // properties collapse the declaration to `stroke: none` and hide the
    // drawing entirely).
    const strokeProps = {
        stroke: color,
        strokeWidth: 2,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
        fill: 'none',
        ...(dashed ? { strokeDasharray: '6 4' } : {}),
    };
    switch (shape.kind) {
        case 'curve':
            // Quadratic Bézier path — `control` bends the segment ("line
            // more like curve": grid chords across multiple grid points
            // bow instead of running sharp through them)
            return (
                <path
                    d={`M ${shape.start.x} ${shape.start.y} Q ${shape.control.x} ${shape.control.y} ${shape.end.x} ${shape.end.y}`}
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

        // The ACTIVE ink (the palette swatch) — the draft fallback when its
        // shape carries no stamped color. Exit-hatch default: the palette's
        // primary accent (same token scale as the swatch list).
        const activeColor = drawing?.color ?? context.palette.accent;

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
                {/* Committed shapes — world-anchored, projected per pass.
                    Each renders in its CREATION-TIME stamped color; legacy
                    shapes without a stamp keep the solid text ink. The
                    resolution lives in shapeInk — the node editor reads the
                    SAME ink so handle dots match their stroke. */}
                {shapes.map((shape, index) => {
                    // Project once — the projection carries the stamped
                    // color through (shapeToScreen passes metadata)
                    const projected = shapeToScreen(shape, transform);
                    return (
                        <ShapeElement
                            key={index}
                            shape={projected}
                            color={shapeInk(shape, context.palette.textBody)}
                            dashed={false}
                        />
                    );
                })}
                {/* The live draft — dashed preview in its creation ink (the
                    active swatch at drag time), falling back to the current
                    active ink */}
                {draft ? (
                    <ShapeElement
                        shape={shapeToScreen(draft, transform)}
                        color={draft.color ?? activeColor}
                        dashed
                    />
                ) : null}
            </svg>
        );
    },
    // Mount slot: nothing to wire — pure render plugin
    () => undefined,
) satisfies DrawPlugin;
