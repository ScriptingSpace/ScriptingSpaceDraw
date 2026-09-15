// ─────────────────────────────────────────────────────────────────────────────
// REMOVABLE feature plugin: NODE EDITOR — node adjustment + whole-shape
// grab-move + cursor feedback.
//
// USER CONTRACT ("Allows adjustment of the node by clicking and dragging
// them" / "I should able to move it around the canvas if I grab them and
// move around" / "The cursor should change to hand when it is moveable (on
// the line itself). Drag when it is draggable (on nodes)"): this plugin owns
// THREE related interactions on committed shapes:
//
// 1. NODE HANDLES render (overlay above the drawing layer, zIndex 6):
//    filled dots for geometry nodes, a hollow ring for the curve's bend
//    node. COLORS: every handle reads the SAME ink as its shape's stroke
//    (shapeInk — the creation-time palette color; nodes MATCH the LINE,
//    a filled dot is literally the line color with a thin well ring; the
//    hollow bend node is a ring in the line color).
// 2. NODE GRAB (within NODE_HIT_RADIUS px of a handle): adjust the drag —
//    each pointermove snaps the dragged node to the grid lattice
//    (adjustShape — pure, in functions/shapes.ts). Cursor: 'grab' on
//    hover, 'grabbing' while dragging.
// 3. LINE GRAB (within NODE_HIT_RADIUS px of the shape's STROKE —
//    distanceToShape, "on the line itself"): move the WHOLE shape around
//    the canvas — every pointermove translates the entire shape by the
//    grid-snapped delta from the grab anchor (moveShape). Cursor:
//    'pointer' (the hand) on hover, 'grabbing' while dragging.
//
// CURSOR FEEDBACK: the styled cursor classes (crosshair/grab) stay on the
// surface element; this plugin overrides them IMPERATIVELY via
// surface.style.cursor on every hover move ('pointer' on a shape body,
// 'grab' on a node) and clears to '' when over empty canvas — the inline
// style wins over the class while present, and empty removes the override
// so the class cursor resurfaces. While a drawing drag or a pan/gesture is
// in flight the plugin stops fighting (guards below).
//
// GESTURE ARBITRATION (how grabbing beats drawing AND panning):
// - The plugin's surface `pointerdown` listener runs BEFORE the tool
//   router's (registration order: 'node-editor' registers before
//   'tool-router' — see DrawDashboard's registerDefaultPlugins); a grab
//   (node OR body) calls event.stopImmediatePropagation() so the router
//   never starts a drawing drag.
// - The grab sets drawing state `adjusting: true`; dragToPanPlugin's
//   mayPan reads it and yields the left button, so grabbing works in pan
//   mode (no-tool) AND tool mode without ever panning.
// - SPACE held → the pan override wins: no grab (the power-user gesture
//   stays "space+drag pans everywhere", cross-reference:
//   dragToPanPlugin.ts).
// - Only the LEFT button grabs; right/middle always pan.
//
// The overlay is purely presentational (pointerEvents: none — hit-testing
// is mathematical, so nodes work even under other overlays).
//
// REMOVABLE: removing it hides the handles, the move + adjust gestures,
// and the cursor feedback; shapes stay draw-able but become inert.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import {
    adjustShape,
    distanceToShape,
    moveShape,
    shapeInk,
    shapeNodes,
    snapToGrid,
} from '../../functions/shapes';
import type { DrawPoint, DrawShape } from '../../functions/shapes';
import { canvasToScreen, screenToCanvas } from '../../functions/canvasTransform';
import type { CanvasTransform } from '../../functions/canvasTransform';
import { mountOf } from '../core/DrawPluginRegistry';
import type { DrawPlugin, DrawPluginContext } from '../core';

// Grab radius (screen px): a press within this distance of a node OR of the
// shape's stroke captures it. Slightly larger than the visible dot so the
// grab is forgiving.
const HIT_RADIUS_PX = 10;

// Rendered handle dot radius (screen px)
const NODE_DOT_RADIUS = 5;

// The active gesture kinds — a node adjustment or a whole-shape move
type GrabRef =
    | { mode: 'node'; shapeIndex: number; nodeId: string; cursor: string }
    // `anchor` = the press point in world coords; `original` = the shape as
    // it was at grab time (all moves rebuild from it — the running shape
    // never ratchets)
    | { mode: 'shape'; shapeIndex: number; anchor: DrawPoint; original: DrawShape };

// Viewport-relative screen point from a raw event (lazy rect read — the
// same contract as the core input plugins, so test stubs stay correct)
const toScreenPoint = (
    surface: HTMLDivElement,
    event: { clientX: number; clientY: number },
): { x: number; y: number } => {
    const rect = surface.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};

// Screen-px grab radius → world units at the current zoom (hit-testing and
// geometry both run in world space)
const hitRadiusWorld = (transform: CanvasTransform): number => HIT_RADIUS_PX / transform.scale;

// hitTest — walk the shapes TOP-MOST first (later shapes render on top and
// must grab first within their own scope). Per shape: nodes first (the
// strongest claim), then the stroke body. Returns the grab or null.
const hitTest = (
    shapes: DrawShape[],
    screen: { x: number; y: number },
    transform: CanvasTransform,
): GrabRef | null => {
    const world = screenToCanvas(screen, transform);
    const radius = hitRadiusWorld(transform);
    for (let shapeIndex = shapes.length - 1; shapeIndex >= 0; shapeIndex--) {
        const shape = shapes[shapeIndex];
        // TOPMOST node of the topmost shape wins over anything below
        for (let nodeIndex = shapeNodes(shape).length - 1; nodeIndex >= 0; nodeIndex--) {
            const node = shapeNodes(shape)[nodeIndex];
            if (Math.hypot(node.point.x - world.x, node.point.y - world.y) <= radius) {
                return { mode: 'node', shapeIndex, nodeId: node.id, cursor: 'grab' };
            }
        }
        // Then the line itself (the whole-shape move grab)
        if (distanceToShape(shape, world) <= radius) {
            return { mode: 'shape', shapeIndex, anchor: world, original: shape };
        }
    }
    return null;
};

// Hover cursor for a point over the canvas (no active grab): the SAME
// priority as hitTest — node → 'grab' (draggable), body → 'pointer' (the
// hand, the shape is movable), empty → null (the class cursor resurfaces)
const hoverCursor = (
    shapes: DrawShape[],
    screen: { x: number; y: number },
    transform: CanvasTransform,
): string | null => {
    const world = screenToCanvas(screen, transform);
    const radius = hitRadiusWorld(transform);
    for (let shapeIndex = shapes.length - 1; shapeIndex >= 0; shapeIndex--) {
        const shape = shapes[shapeIndex];
        for (const node of shapeNodes(shape)) {
            if (Math.hypot(node.point.x - world.x, node.point.y - world.y) <= radius) return 'grab';
        }
        if (distanceToShape(shape, world) <= radius) return 'pointer';
    }
    return null;
};

// One rendered handle dot — colored by the SHAPE'S LINE INK ("node color
// matches the line color"). Geometry nodes are filled with the ink and
// ringed by the well background so dots stay visible when two shapes of
// the same color overlap; the hollow bend node is a ring IN the ink.
const NodeDot = ({
    x,
    y,
    ink,
    hollow,
}: {
    x: number;
    y: number;
    ink: string;
    hollow: boolean;
}): React.ReactElement => (
    <circle
        cx={x}
        cy={y}
        r={hollow ? NODE_DOT_RADIUS - 1 : NODE_DOT_RADIUS}
        // Filled = the line color (a solid node reads as a bead ON the
        // stroke); the well ring separates stacked same-color handles.
        // The ring is a RAW hex (PALETTE_WELL) — the drawing-stroke lesson:
        // an undefined CSS var() collapses the declaration entirely.
        fill={hollow ? 'none' : ink}
        stroke={hollow ? ink : '#1a1b26'}
        strokeWidth={2}
        // Presentation only — hit-testing is mathematical
        pointerEvents="none"
    />
);

// The plugin function — returns the node overlay on every execution.
export const nodeEditorPlugin = mountOf(
    (context: DrawPluginContext) => {
        const transform = context.transform();
        if (!transform) return null;
        const shapes = context.drawing()?.shapes ?? [];
        if (shapes.length === 0) return null;
        const { width, height } = context.viewport();
        if (width <= 0 || height <= 0) return null;

        return (
            <svg
                width={width}
                height={height}
                data-testid="node-handles"
                style={{
                    display: 'block',
                    // Overlay ABOVE the drawing layer (which renders with
                    // no z-index); invisible to events — the gesture logic
                    // is on the surface listeners below
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    zIndex: 6,
                    pointerEvents: 'none',
                }}
            >
                {/* One dot per shape node, stroked/filled in the shape's
                    line ink (shapeInk — the same resolution the drawing
                    layer uses: creation color or legacy text ink) */}
                {shapes.map((shape, shapeIndex) =>
                    shapeNodes(shape).map((node) => {
                        const screen = canvasToScreen(node.point, transform);
                        return (
                            <NodeDot
                                key={`${shapeIndex}:${node.id}`}
                                x={screen.x}
                                y={screen.y}
                                ink={shapeInk(shape, context.palette.textBody)}
                                hollow={node.hollow === true}
                            />
                        );
                    }),
                )}
            </svg>
        );
    },
    // Mount slot: the grab / drag / release listeners on the canvas surface
    (surface: HTMLDivElement, context: DrawPluginContext) => {
        // The currently grabbed interaction (null = idle)
        let grab: GrabRef | null = null;

        // Screen point → world point (the shapes' coordinate space)
        const toWorld = (screen: { x: number; y: number }) =>
            screenToCanvas(screen, context.transform());

        // ── Cursor management ──
        // The inline style overrides the class cursor (crosshair/grab)
        // while present; writing '' clears the inline override so the class
        // resurfaces. React does not own this style key on CanvasSurface
        // (cursor rides the Emotion class), so imperative writes survive
        // re-renders.
        const setCursor = (cursor: string | null) => {
            surface.style.cursor = cursor ?? '';
        };

        const handlePointerDown = (event: PointerEvent) => {
            // Only the left button grabs (right/middle = pan gestures)
            if (event.button !== 0) return;
            // NEVER fight the in-flight gestures: a drawing drag or an
            // active adjustment/move owns the pointer already
            const drawing = context.drawing();
            if (drawing.drawing || drawing.adjusting) return;
            // SPACE = the pan override (power-user gesture wins everywhere)
            if (context.keyboard().held.has('Space')) return;
            const screen = toScreenPoint(surface, event);
            const hit = hitTest(drawing.shapes, screen, context.transform());
            if (!hit) return;
            // Claim the gesture: the tool router (registered AFTER this
            // plugin) never sees the press → no drawing drag starts; the
            // adjusting flag yields the left button to us in dragToPan as
            // well (pan mode included)
            event.stopImmediatePropagation();
            grab = hit;
            context.drawing({ ...drawing, adjusting: true });
            // 'grabbing' for both gesture kinds — the press committed to a
            // drag either way
            setCursor('grabbing');
            // Capture the pointer so the drag continues outside the canvas
            // bounds (same contract as the pan gesture)
            (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
        };

        const handlePointerMove = (event: PointerEvent) => {
            if (grab) {
                const world = toWorld(toScreenPoint(surface, event));
                const state = context.drawing();
                const shape = state.shapes[grab.shapeIndex];
                if (!shape) {
                    // The shape vanished under us — release defensively
                    grab = null;
                    context.drawing({ ...state, adjusting: false });
                    setCursor(null);
                    return;
                }
                if (grab.mode === 'node') {
                    // Grid-locked node adjustment: adjustShape snaps the
                    // pointer to the lattice and rebuilds around the node
                    const adjusted = adjustShape(shape, grab.nodeId, world);
                    if (!adjusted || adjusted === shape) return;
                    const shapes = state.shapes.slice();
                    shapes[grab.shapeIndex] = adjusted;
                    // The drawing write wrapper triggers a host re-render
                    context.drawing({ ...state, shapes });
                    return;
                }
                // Whole-shape move: translate the ORIGINAL grab-time shape
                // by the grid-snapped delta from the press anchor. Grabbing
                // the line moves it around the canvas — with each vertex
                // landing on grid points ("This isn't free form").
                const dx = snapToGrid({ x: world.x - grab.anchor.x, y: 0 }).x;
                const dy = snapToGrid({ x: 0, y: world.y - grab.anchor.y }).y;
                const moved = moveShape(grab.original, dx, dy);
                const shapes = state.shapes.slice();
                shapes[grab.shapeIndex] = moved;
                context.drawing({ ...state, shapes });
                return;
            }
            // ── Hover feedback (no grab in flight) ──
            // Stop fighting during drawing drags / pan gestures: the
            // layer's own cursor (crosshair/grab) applies there
            if (context.drawing().drawing) return;
            const screen = toScreenPoint(surface, event);
            const cursor = hoverCursor(
                context.drawing().shapes,
                screen,
                context.transform(),
            );
            setCursor(cursor);
        };

        // Release the grab — the adjusted/moved geometry is already live in
        // the state (each move wrote it); only the adjusting flag unwinds.
        // The cursor re-resolves on the next hover move.
        const endGrab = () => {
            if (!grab) return;
            grab = null;
            context.drawing({ ...context.drawing(), adjusting: false });
        };

        const handlePointerUp = () => {
            endGrab();
            // Fresh hover read on release-over (the surface's pointer stays
            // where it is; the next move re-evaluates anyway)
            setCursor(null);
        };
        // Pointer gone from the canvas: drop the grab + cursor override
        // (keeps the adjusted shape as-is — no draft involvement)
        const handlePointerLeave = () => {
            endGrab();
            setCursor(null);
        };

        surface.addEventListener('pointerdown', handlePointerDown);
        surface.addEventListener('pointermove', handlePointerMove);
        surface.addEventListener('pointerup', handlePointerUp);
        surface.addEventListener('pointerleave', handlePointerLeave);

        return () => {
            surface.removeEventListener('pointerdown', handlePointerDown);
            surface.removeEventListener('pointermove', handlePointerMove);
            surface.removeEventListener('pointerup', handlePointerUp);
            surface.removeEventListener('pointerleave', handlePointerLeave);
        };
    },
) satisfies DrawPlugin;
