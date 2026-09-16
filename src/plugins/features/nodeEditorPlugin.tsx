// ─────────────────────────────────────────────────────────────────────────────
// REMOVABLE feature plugin: NODE EDITOR — node adjustment + whole-shape
// grab-move + node BONDS (move-as-one) + cursor feedback.
//
// USER CONTRACT ("Allows adjustment of the node by clicking and dragging
// them" / "I should able to move it around the canvas if I grab them and
// move around" / "The cursor should change to hand when it is moveable (on
// the line itself). Drag when it is draggable (on nodes)" / "When two item
// connected either by node, they are move as one unit until the user
// purposely break the node"): this plugin owns FOUR related interactions
// on committed shapes:
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
//    distanceToShape, "on the line itself"): move the WHOLE GROUP around
//    the canvas — every pointermove translates the grabbed shape AND
//    every bond-connected shape (groupOf BFS over state.connections) by
//    the same grid-snapped delta from the grab anchor (moveShape per
//    member, rebuilt from GRAB-TIME snapshots — the delta is absolute
//    from the anchor, not a frame delta, so repeated pointermove events
//    with a constant offset never ratchet the partners). Cursor:
//    'pointer' (the hand) on hover, 'grabbing' while dragging.
// 4. CONNECTED-NODE DRAG (the "move as one" contract, functions/
//    connection.ts): pressing a node that is a BONDED endpoint (any
//    endpoint node in state.connections — isEndpointNode) is converted
//    into a GROUP grab: the drag translates the whole bond-connected
//    group (the same machinery as the line grab) so the two shapes ride
//    together and the junction stays welded ("When two item connected
//    either by node, they are move as one unit").
//    - BREAK ("until the user purposely break the node"): DOUBLE-CLICK on
//      a bonded endpoint SEVERS every bond on that endpoint — an explicit,
//      deliberate gesture (a plain node drag is consumed by the group
//      move, so silence never tears a bond; the tilt of the pull-away
//      gesture would otherwise fight the move-as-one contract).
//    - Proximity connect (unchanged): dragging an UNBONDED endpoint onto
//      another shape's endpoint within the grab radius force-snaps the
//      pair onto the same grid point and records the bond mid-drag; from
//      that frame the elastic hold below welds the junction until an
//      extra deliberate tear (> one grid step of pull) dissolves it.
//    - Group semantics: groupOf resolves from the LIVE bonds each frame;
//      a bond created mid-drag still travels with the dragged group.
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
// REMOVABLE: removing it hides the handles, the move + adjust + bond
// gestures, and the cursor feedback; shapes stay draw-able but become
// inert (bonds stop responding but remain in the state).
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import {
    adjustShape,
    distanceToShape,
    moveShape,
    shapeInk,
    shapeNodes,
} from '../../functions/shapes';
import type { DrawPoint, DrawShape } from '../../functions/shapes';
import { BASE_SPACING, canvasToScreen, screenToCanvas, snapToGrid } from '../../functions/canvasTransform';
import type { CanvasTransform } from '../../functions/canvasTransform';
import { bondsOf, breakAt, connect, groupOf, isEndpointNode, twinPoint } from '../../functions/connection';
import { mountOf } from '../core/DrawPluginRegistry';
import type { DrawPlugin, DrawPluginContext } from '../core';

// Grab radius (screen px): a press within this distance of a node OR of the
// shape's stroke captures it. Slightly larger than the visible dot so the
// grab is forgiving.
const HIT_RADIUS_PX = 10;

// Rendered handle dot radius (screen px)
const NODE_DOT_RADIUS = 5;

// The active gesture kinds — a node adjustment or a whole-shape (group) move.
// The NODE kind covers unbonded endpoint drags (adjust / proximity-connect)
// and non-endpoint nodes (bend, radius); a press on a BONDED endpoint is
// CONVERTED below into the 'shape' kind so the group move machinery runs
// (the move-as-one contract).
type GrabRef =
    | { mode: 'node'; shapeIndex: number; nodeId: string; cursor: string }
    // `anchor` = the delta origin in world coords (the press point for a
    // body grab, the DRAGGED NODE's own point for a bonded-node
    // conversion). `originals` = EVERY group member's geometry at grab
    // time, keyed by shape index: each pointermove rebuilds members as
    // snapshot + the ABSOLUTE grid-snapped delta from the anchor, which is
    // IDEMPOTENT over repeated events. (The pre-fix version rebuilt
    // partners from their per-frame CURRENT shapes and re-applied the
    // absolute dx on every event — a real drag fires many moves with a
    // constant dx inside one grid cell, so bonded partners ratcheted one
    // step per pointermove and flew apart. Snapshots kill the ratchet and
    // make sliding back under the anchor restore the originals.)
    | {
          mode: 'shape';
          shapeIndex: number;
          anchor: DrawPoint;
          originals: { [shapeIndex: number]: DrawShape };
      };

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
        // Then the line itself (the whole-shape move grab). The originals
        // map starts with just the grabbed shape — handlePointerDown
        // extends it to the full bond-connected group below
        if (distanceToShape(shape, world) <= radius) {
            return {
                mode: 'shape',
                shapeIndex,
                anchor: world,
                originals: { [shapeIndex]: shape },
            };
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
// `connected` renders the endpoint ENLARGED with a halo so users see the
// junction ("these two move as one") before they grab it.
const NodeDot = ({
    x,
    y,
    ink,
    hollow,
    connected,
}: {
    x: number;
    y: number;
    ink: string;
    hollow: boolean;
    connected: boolean;
}): React.ReactElement => (
    <g>
        {/* The junction halo (only on bonded endpoints) */}
        {connected ? (
            <circle
                cx={x}
                cy={y}
                r={NODE_DOT_RADIUS + 3}
                fill="none"
                stroke={ink}
                strokeWidth={1}
                opacity={0.5}
                pointerEvents="none"
            />
        ) : null}
        <circle
            cx={x}
            cy={y}
            r={connected ? NODE_DOT_RADIUS + 1.5 : hollow ? NODE_DOT_RADIUS - 1 : NODE_DOT_RADIUS}
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
    </g>
);

// The plugin function — returns the node overlay on every execution.
export const nodeEditorPlugin = mountOf(
    (context: DrawPluginContext) => {
        const transform = context.transform();
        if (!transform) return null;
        const shapes = context.drawing()?.shapes ?? [];
        if (shapes.length === 0) return null;
        const bonds = context.drawing()?.connections ?? [];
        const { width, height } = context.viewport();
        if (width <= 0 || height <= 0) return null;

        // Which endpoint nodes carry at least one bond? (bonded endpoints
        // render enlarged with a halo — the visible "these two are locked"
        // cue; the bond is invisible in the stroke itself since the two
        // endpoints occupy the SAME world point)
        const bondedEndpoints = new Set(
            bonds.flatMap((bond) =>
                [bond[0], bond[1]].map(
                    (endpoint) => `${endpoint.shapeIndex}:${endpoint.nodeId}`,
                ),
            ),
        );
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
                    layer uses: creation color or legacy text ink). Bonded
                    endpoints get the junction halo. */}
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
                                connected={bondedEndpoints.has(`${shapeIndex}:${node.id}`)}
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
            // ── MOVE-AS-ONE CONVERSION ──
            // A press on a node that is a BONDED endpoint is a GROUP grab,
            // not a node adjustment: the whole bond-connected group moves
            // with the drag (the contract — connected shapes move as one
            // unit when dragged). Convert the grab to the 'shape' kind so
            // the pointermove path runs the body-grab group move (groupOf +
            // moveShape).
            let grabRef = hit;
            if (hit.mode === 'node') {
                const hitShape = drawing.shapes[hit.shapeIndex];
                const bonds = drawing.connections ?? [];
                const bonded =
                    !!hitShape &&
                    isEndpointNode(hitShape, hit.nodeId) &&
                    bondsOf(bonds, { shapeIndex: hit.shapeIndex, nodeId: hit.nodeId }).length > 0;
                if (hitShape && bonded) {
                    grabRef = {
                        mode: 'shape',
                        shapeIndex: hit.shapeIndex,
                        // The anchor is the DRAGGED NODE's own world point
                        // (not the raw press): the snapped delta then
                        // measures pointer displacement from the junction
                        // itself, so the junction lands on the pointer's
                        // grid point without a ≤10px grab-radius skew
                        // flipping the snap near cell boundaries
                        anchor:
                            shapeNodes(hitShape).find((n) => n.id === hit.nodeId)?.point ??
                            toWorld(screen),
                        originals: { [hit.shapeIndex]: hitShape },
                    };
                }
            }
            // ── GROUP SNAPSHOT (ratchet-proof) ──
            // Every 'shape' grab (body grab OR bonded-node conversion)
            // snapshots the grab-time geometry of the WHOLE bond-connected
            // group. Pointermove rebuilds each member as snapshot +
            // absolute delta (see GrabRef) — never from per-frame current
            // shapes, which double-applied the delta on every event.
            if (grabRef.mode === 'shape') {
                const bonds = drawing.connections ?? [];
                const originals: { [shapeIndex: number]: DrawShape } = { ...grabRef.originals };
                groupOf(bonds, grabRef.shapeIndex).forEach((memberIndex) => {
                    const member = drawing.shapes[memberIndex];
                    if (member) originals[memberIndex] = member;
                });
                grabRef = { ...grabRef, originals };
            }
            // Claim the gesture: the tool router (registered AFTER this
            // plugin) never sees the press → no drawing drag starts; the
            // adjusting flag yields the left button to us in dragToPan as
            // well (pan mode included)
            event.stopImmediatePropagation();
            grab = grabRef;
            context.drawing({ ...drawing, adjusting: true });
            // 'grabbing' for both gesture kinds — the press committed to a
            // drag either way
            setCursor('grabbing');
            // Capture the pointer so the drag continues outside the canvas
            // bounds (same contract as the pan gesture)
            (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
        };

        const handlePointerMove = (event: PointerEvent) => {
            if (!grab) {
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
                return;
            }
            // Narrow the union ONCE per move (the drag kind never changes
            // mid-drag — the grab ref is written only in pointerdown)
            if (grab.mode === 'shape') {
                const shapeMode = grab;
                const world = toWorld(toScreenPoint(surface, event));
                const state = context.drawing();
                const shapes = state.shapes;
                const bonds = state.connections ?? [];
                const shape = shapes[shapeMode.shapeIndex];
                if (!shape) {
                    // The shape vanished under us — release defensively
                    grab = null;
                    context.drawing({ ...state, adjusting: false });
                    setCursor(null);
                    return;
                }
                // ── Whole-group move ──
                // Grabbed shape + every bond-connected shape MOVE AS ONE
                // UNIT (the contract). dx/dy are the ABSOLUTE grid-snapped
                // offset of the pointer from the grab anchor (NOT a frame
                // delta) — every member rebuilds from its GRAB-TIME
                // snapshot + that absolute offset, so repeated pointermove
                // events with a constant offset recompute the exact same
                // geometry (idempotent — no ratchet), and sliding the
                // pointer back under the anchor restores the originals.
                const dx = snapToGrid({ x: world.x - shapeMode.anchor.x, y: 0 }).x;
                const dy = snapToGrid({ x: 0, y: world.y - shapeMode.anchor.y }).y;
                // The group re-resolves from the LIVE bonds each frame
                // (defensive — the built-in gestures never add bonds during
                // a shape drag, but third-party plugins could)
                const group = groupOf(bonds, shapeMode.shapeIndex);
                const nextShapes = shapes.slice();
                group.forEach((memberIndex) => {
                    const origin = shapeMode.originals[memberIndex];
                    // A member missing from the snapshot (a bond that
                    // appeared mid-drag from outside this plugin) is
                    // SKIPPED, never moved from its current shape — moving
                    // from current with an absolute delta would ratchet it
                    if (!origin) return;
                    nextShapes[memberIndex] = moveShape(origin, dx, dy);
                });
                context.drawing({ ...state, shapes: nextShapes });
                return;
            }
            const nodeMode = grab;
            const world = toWorld(toScreenPoint(surface, event));
            const state = context.drawing();
            const shapes = state.shapes;
            const bonds = state.connections ?? [];
            const transform = context.transform();
            const shape = shapes[nodeMode.shapeIndex];
            if (!shape) {
                // The shape vanished under us — release defensively
                grab = null;
                context.drawing({ ...state, adjusting: false });
                setCursor(null);
                return;
            }
            const draggedNode = shapeNodes(shape).find((n) => n.id === nodeMode.nodeId);
            if (!draggedNode) return;
            if (!isEndpointNode(shape, nodeMode.nodeId)) {
                // Non-endpoint nodes (curve bend, circle radius edge) never
                // bond — plain grid-locked adjustment
                const adjusted = adjustShape(shape, nodeMode.nodeId, world);
                if (!adjusted) return;
                const nextShapes = shapes.slice();
                nextShapes[nodeMode.shapeIndex] = adjusted;
                context.drawing({ ...state, shapes: nextShapes });
                return;
            }
            // ── Bonded endpoint: the ELASTIC HOLD (mid-drag weld) ──
            // Reached while dragging an UNBONDED endpoint that bonded
            // MID-DRAG via the proximity connect below (presses on already-
            // bonded endpoints never get here — handlePointerDown converted
            // them into group grabs). The node stays welded to its twin so
            // the fresh bond can't silently dissolve; tearing more than a
            // full grid step past the twin = "purposely break" — the bond
            // SEVERS and the node follows the pointer freely.
            const wave = twinPoint(shapes, bonds, {
                shapeIndex: nodeMode.shapeIndex,
                nodeId: nodeMode.nodeId,
            });
            if (wave) {
                const separation =
                    Math.abs(world.x - wave.point.x) + Math.abs(world.y - wave.point.y);
                if (separation > BASE_SPACING) {
                    // ── TEAR-OFF: sever every bond on this endpoint, then
                    // the endpoint follows the pointer (snapped)
                    const adjusted = adjustShape(shape, nodeMode.nodeId, world);
                    if (!adjusted) return;
                    const nextShapes = shapes.slice();
                    nextShapes[nodeMode.shapeIndex] = adjusted;
                    context.drawing({
                        ...state,
                        shapes: nextShapes,
                        connections: breakAt(bonds, {
                            shapeIndex: nodeMode.shapeIndex,
                            nodeId: nodeMode.nodeId,
                        }),
                    });
                    return;
                }
                // Inside the elastic zone: weld to the twin (a no-op when
                // the two already coincide — the common case)
                const adjusted = adjustShape(shape, nodeMode.nodeId, wave.point);
                if (!adjusted) return;
                const nextShapes = shapes.slice();
                nextShapes[nodeMode.shapeIndex] = adjusted;
                context.drawing({ ...state, shapes: nextShapes });
                return;
            }
            // ── Unbonded endpoint: proximity CONNECT ──
            // Another shape's endpoint node within the grab radius of the
            // DRAGGED NODE's own point bonds the two — the dragged endpoint
            // FORCE-snaps onto the twin's exact grid point (physical
            // contact) and the pair locks. Topmost shape wins ties.
            let twin: { shapeIndex: number; nodeId: string } | null = null;
            const hitRadius = hitRadiusWorld(transform);
            for (let s = shapes.length - 1; s >= 0; s--) {
                if (s === nodeMode.shapeIndex) continue;
                for (const node of shapeNodes(shapes[s])) {
                    if (!isEndpointNode(shapes[s], node.id)) continue;
                    if (
                        Math.hypot(node.point.x - draggedNode.point.x, node.point.y - draggedNode.point.y) <=
                        hitRadius
                    ) {
                        twin = { shapeIndex: s, nodeId: node.id };
                    }
                }
            }
            if (twin) {
                const twinNode = shapeNodes(shapes[twin.shapeIndex]).find(
                    (n) => n.id === twin!.nodeId,
                );
                if (twinNode) {
                    const adjusted = adjustShape(shape, nodeMode.nodeId, twinNode.point);
                    if (adjusted) {
                        const nextShapes = shapes.slice();
                        nextShapes[nodeMode.shapeIndex] = adjusted;
                        // Record the bond (connect is idempotent)
                        const connected = connect(
                            bonds,
                            { shapeIndex: nodeMode.shapeIndex, nodeId: nodeMode.nodeId },
                            twin,
                        );
                        context.drawing({ ...state, shapes: nextShapes, connections: connected });
                    }
                    return;
                }
            }
            // Free (unbonded, no contact) endpoint: grid-locked adjustment
            const adjusted = adjustShape(shape, nodeMode.nodeId, world);
            if (!adjusted) return;
            const nextShapes = shapes.slice();
            nextShapes[nodeMode.shapeIndex] = adjusted;
            context.drawing({ ...state, shapes: nextShapes });
        };

        // ── DBLCLICK BREAK — the deliberate bond-breaker ──
        // Double-clicking a bonded endpoint node severs EVERY bond on that
        // endpoint ("until the user purposely break the node"). A plain drag
        // of a bonded node is consumed by the group move (move-as-one), so
        // the break needs its own unmistakable gesture; the junction's halo
        // marks exactly which handle the double-click targets. Both shapes
        // keep their geometry — they just aren't welded anymore.
        const handleDoubleClick = (event: MouseEvent) => {
            // Left-button double-clicks only (right/middle stay pan gestures)
            if (event.button !== 0) return;
            // Never fight in-flight gestures (drawing drag / adjustment / move)
            const drawing = context.drawing();
            if (drawing.drawing || drawing.adjusting) return;
            // SPACE = the pan override wins (consistent with the grab gate)
            if (context.keyboard().held.has('Space')) return;
            // HUD subtrees keep their own click behavior (toolbar buttons…)
            const target = event.target as HTMLElement | null;
            if (target?.closest?.('[data-hud]')) return;
            const screen = toScreenPoint(surface, event);
            const hit = hitTest(drawing.shapes, screen, context.transform());
            // Only a NODE double-click breaks (line double-clicks do nothing)
            if (!hit || hit.mode !== 'node') return;
            if (!isEndpointNode(drawing.shapes[hit.shapeIndex], hit.nodeId)) return;
            const bonds = drawing.connections ?? [];
            if (bonds.length === 0) return;
            const remaining = breakAt(bonds, {
                shapeIndex: hit.shapeIndex,
                nodeId: hit.nodeId,
            });
            // Nothing touched (dead-endpoint bonds) → skip the write
            if (remaining.length === bonds.length) return;
            context.drawing({ ...drawing, connections: remaining });
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
        // The deliberate bond-breaker
        surface.addEventListener('dblclick', handleDoubleClick);

        return () => {
            surface.removeEventListener('pointerdown', handlePointerDown);
            surface.removeEventListener('pointermove', handlePointerMove);
            surface.removeEventListener('pointerup', handlePointerUp);
            surface.removeEventListener('pointerleave', handlePointerLeave);
            surface.removeEventListener('dblclick', handleDoubleClick);
        };
    },
) satisfies DrawPlugin;
