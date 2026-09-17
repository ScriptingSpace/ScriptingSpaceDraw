// ─────────────────────────────────────────────────────────────────────────────
// REMOVABLE feature plugin: NODE EDITOR — node adjustment + whole-shape
// grab-move + node BONDS (weld + pull-to-break) + cursor feedback.
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
// 4. BREAKING THE LOCK (the "until the user purposely break the node"
//    contract, functions/connection.ts): the bond welds the SHAPES
//    together — a line grab moves the whole bond-connected group as one
//    (see 3) and the junction rides along welded. But placing the cursor
//    ON a bonded node and dragging it OUT is the deliberate break:
//    - PULL-TO-BREAK (the primary break gesture): a bonded node drag
//      runs the ELASTIC HOLD — inside one grid step of the twin the
//      junction stays welded (the lock holds while the pointer bends
//      against it); pulling past a full grid step SEVERS every bond on
//      that node and the grabbed node — whichever node is ON TOP at the
//      junction, hitTest's pick — follows the pointer as a free
//      adjustment while the twin keeps its position.
//    - DBLCLICK: double-clicking a bonded node also SEVERS every bond
//      on it — break WITHOUT moving either shape.
//    - Proximity connect (all nodes): dragging an UNBONDED node onto
//      another shape's node within the grab radius of the DESTINATION
//      force-welds the pair onto the same world point (snapShapeNode —
//      circle rims TRANSLATE the circle so the lock is exact, since
//      radius re-quantization alone can miss a diagonal twin by half a
//      cell) and records the bond mid-drag; from that frame the elastic
//      hold above welds the junction until an extra deliberate tear
//      (> one grid step of pull) dissolves it.
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
    snapShapeNode,
} from '../../functions/shapes';
import { autoLockShapes } from './shapeToolPlugins';
import type { DrawPoint, DrawShape } from '../../functions/shapes';
import { BASE_SPACING, canvasToScreen, screenToCanvas, snapToGrid } from '../../functions/canvasTransform';
import type { CanvasTransform } from '../../functions/canvasTransform';
import { bondsOf, breakAt, connect, twinPoint } from '../../functions/connection';
import { movingSetOf } from '../../functions/selection';
import { mountOf } from '../core/DrawPluginRegistry';
import type { DrawPlugin, DrawPluginContext } from '../core';

// Grab radius (screen px): a press within this distance of a node OR of the
// shape's stroke captures it. Slightly larger than the visible dot so the
// grab is forgiving.
const HIT_RADIUS_PX = 10;

// Rendered handle dot radius (screen px)
const NODE_DOT_RADIUS = 5;

// The active gesture kinds — a node adjustment or a whole-shape (group)
// move. The NODE kind covers free node drags (adjust / proximity-connect /
// pull-to-break: every node press stays a node grab — a bonded node press
// runs the ELASTIC HOLD below, it is NOT converted into a group grab).
// The SHAPE kind is a body grab (a press on the line itself) — it owns the
// move-as-one group translation.
type GrabRef =
    | { mode: 'node'; shapeIndex: number; nodeId: string; cursor: string }
    // `anchor` = the press point in world coords. `originals` = EVERY group
    // member's geometry at grab time, keyed by shape index: each
    // pointermove rebuilds members as snapshot + the ABSOLUTE grid-snapped
    // delta from the anchor, which is IDEMPOTENT over repeated events. (An
    // earlier version rebuilt partners from their per-frame CURRENT shapes
    // and re-applied the absolute dx on every event — a real drag fires
    // many moves with a constant dx inside one grid cell, so bonded
    // partners ratcheted one step per pointermove and flew apart.
    // Snapshots kill the ratchet and make sliding back under the anchor
    // restore the originals.)
    | {
          mode: 'shape';
          shapeIndex: number;
          anchor: DrawPoint;
          originals: { [shapeIndex: number]: DrawShape };
          // The MULTI-MOVE seeds — the drawing-state selection indices the
          // grab translated (see handlePointerDown). Every pointermove +
          // the release auto-lock re-resolve the FULL moving set as the
          // union of bond groups over these seeds, so a multi-select drag
          // carries every member and a single-grab stays a group move.
          movingSeeds: number[];
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
        // extends it to the full moving set below (seeds start on the
        // grabbed shape alone; a selection that includes the grab widens
        // them at pointerdown)
        if (distanceToShape(shape, world) <= radius) {
            return {
                mode: 'shape',
                shapeIndex,
                anchor: world,
                originals: { [shapeIndex]: shape },
                movingSeeds: [shapeIndex],
            };
        }
    }
    return null;
};

// Hover cursor for a point over the canvas (no active grab): the SAME
// priority as hitTest — node → 'grab' (draggable, PAN MODE only: with a
// tool armed the press draws and the crosshair class stays — see the
// tool-precedence note in handlePointerDown), body → 'pointer' (the
// hand, the shape is movable — in tool mode too), empty → null (the
// class cursor resurfaces)
const hoverCursor = (
    shapes: DrawShape[],
    screen: { x: number; y: number },
    transform: CanvasTransform,
    toolArmed: boolean,
): string | null => {
    const world = screenToCanvas(screen, transform);
    const radius = hitRadiusWorld(transform);
    for (let shapeIndex = shapes.length - 1; shapeIndex >= 0; shapeIndex--) {
        const shape = shapes[shapeIndex];
        for (const node of shapeNodes(shape)) {
            if (Math.hypot(node.point.x - world.x, node.point.y - world.y) <= radius) {
                return toolArmed ? null : 'grab';
            }
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

        // Node-point signature of the grabbed shape AT GRAB TIME
        // (JSON of shapeNodes' points). At release it re-computes against
        // the live geometry: an UNCHANGED signature (a click that never
        // moved) skips the release auto-lock — a mere press must never
        // record junctions the geometry never actually earned.
        let grabSig: string | null = null;

        // The node-point signature helper (grab + release records)
        const shapeSig = (shape: DrawShape): string =>
            JSON.stringify(shapeNodes(shape).map((node) => node.point));

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
            // ── TOOL PRECEDENCE (draw-from-node) ──
            // With a tool armed, a press on a NODE yields to the tool: a
            // new shape wants that node's grid point as its anchor, and
            // the commit drop check (autoConnect) then welds the junction.
            // Without this the editor steals every node press and the
            // user could never DRAW onto a node — the auto lock looked
            // "flaky" (locks formed only when the press missed nodes).
            // BODY grabs still win with a tool armed (moving an existing
            // shape never competes with an anchor point).
            if (context.activeTool() !== null && hit.mode === 'node') return;
            // ── GROUP SNAPSHOT (ratchet-proof) ──
            // A body grab on a bonded shape snapshots the grab-time
            // geometry of the WHOLE bond-connected group (the grabbed
            // shape is already seeded by hitTest). Pointermove rebuilds
            // each member as snapshot + absolute delta (see GrabRef) —
            // never from per-frame current shapes, which double-applied
            // the delta on every event.
            // NODE presses stay NODE grabs: a bonded node press runs the
            // ELASTIC HOLD (pull past one grid step = break), while the
            // line grab owns the move-as-one translation.
            let grabRef = hit;
            // A SHAPE grab also carves the selection: grabbing a selected
            // shape keeps the whole multi-select moving; grabbing an
            // unselected shape re-skims the selection to its bond group
            // ("jointed shapes are selected together"). NODE grabs leave
            // the selection untouched (only the body grab owns moving).
            let grabbedSelection: number[] | null = null;
            if (grabRef.mode === 'shape') {
                const bonds = drawing.connections ?? [];
                // ── MULTI-MOVE SEEDS (the marquee contract) ──
                const currentSelection = drawing.selection ?? [];
                const seeds = currentSelection.includes(grabRef.shapeIndex)
                    ? currentSelection
                    : [grabRef.shapeIndex];
                // The moving set is BOND-AWARE: every bonded partner of
                // every seed joins (the group-move invariant, widened
                // from the single grabbed shape)
                const moving = movingSetOf(bonds, seeds);
                // Snapshot each member from the GRAB-TIME shapes (the
                // ratchet-proof rebuild source — see GrabRef)
                const originals: { [shapeIndex: number]: DrawShape } = { ...grabRef.originals };
                moving.forEach((memberIndex) => {
                    const member = drawing.shapes[memberIndex];
                    if (member) originals[memberIndex] = member;
                });
                grabRef = { ...grabRef, originals, movingSeeds: seeds };
                grabbedSelection = moving;
            }
            // Claim the gesture: the tool router (registered AFTER this
            // plugin) never sees the press → no drawing drag starts; the
            // adjusting flag yields the left button to us in dragToPan as
            // well (pan mode included)
            event.stopImmediatePropagation();
            grab = grabRef;
            // Record the grab-time node geometry (the release auto-lock's
            // "did it actually move" signature)
            grabSig = shapeSig(drawing.shapes[grabRef.shapeIndex]);
            // One state write: adjusting flag + (for shape grabs) the
            // selection the markers render immediately (even for a
            // press-without-drag)
            context.drawing({
                ...drawing,
                adjusting: true,
                ...(grabbedSelection ? { selection: grabbedSelection } : {}),
            });
            // 'grabbing' for both gesture kinds — the press committed to a
            // drag either way
            setCursor('grabbing');
            // Capture the pointer so the drag continues outside the canvas
            // bounds (same contract as the pan gesture). Capture onto the
            // SURFACE (not event.target — a child/HUD/SVG line target is
            // transient: React replaces those mid-gesture and the capture
            // would evaporate), and failure must never abort the claim
            // bookkeeping (a throw after `adjusting` is set would latch it).
            try {
                surface.setPointerCapture?.(event.pointerId);
            } catch {
                // Capture unavailable — the gesture still runs in-surface
            }
        };

        const handlePointerMove = (event: PointerEvent) => {
            if (!grab) {
                // ── Hover feedback (no grab in flight) ──
                // Stop fighting during drawing drags / pan gestures: the
                // layer's own cursor (crosshair/grab) applies there
                if (context.drawing().drawing) return;
                // A live marquee owns the move stream (crosshair feedback) —
                // the hover cursor would fight the box drag
                if (context.drawing().marquee) return;
                const screen = toScreenPoint(surface, event);
                const cursor = hoverCursor(
                    context.drawing().shapes,
                    screen,
                    context.transform(),
                    context.activeTool() !== null,
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
                // ── Whole-selection move ──
                // Every member of the moving set (the grabbed shape's bond
                // group — or EVERY selected shape for a multi-select grab,
                // jointed partners included) MOVES AS ONE. dx/dy are the
                // ABSOLUTE grid-snapped offset of the pointer from the grab
                // anchor (NOT a frame delta) — every member rebuilds from
                // its GRAB-TIME snapshot + that absolute offset, so repeated
                // pointermove events with a constant offset recompute the
                // exact same geometry (idempotent — no ratchet), and sliding
                // the pointer back under the anchor restores the originals.
                const dx = snapToGrid({ x: world.x - shapeMode.anchor.x, y: 0 }).x;
                const dy = snapToGrid({ x: 0, y: world.y - shapeMode.anchor.y }).y;
                // The set re-resolves from the LIVE bonds each frame
                // (defensive — the built-in gestures never add bonds during
                // a shape drag, but third-party plugins could)
                const group = movingSetOf(bonds, shapeMode.movingSeeds);
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
            // ── Bonded node: the ELASTIC HOLD (pull-to-break) ──
            // The bond welds the SHAPES (line grabs carry the junction
            // welded), but grabbing a bonded NODE and dragging it out is
            // the deliberate break gesture the user asked for ("place my
            // cursor on and drag it out... it will break the lock"): the
            // dragged node — whichever node is ON TOP at the junction,
            // hitTest's pick — resists inside one grid step of its twin
            // (the lock holds while the pointer bends against it), and
            // pulling past a full grid step SEVERS every bond on the
            // node, detaching it from the twin (the twin keeps its
            // position; both move freely afterwards). The same path also
            // covers bonds created MID-DRAG by the proximity connect
            // below: a fresh junction welds to its twin so the new bond
            // can't silently dissolve.
            const wave = twinPoint(shapes, bonds, {
                shapeIndex: nodeMode.shapeIndex,
                nodeId: nodeMode.nodeId,
            });
            if (wave) {
                const separation =
                    Math.abs(world.x - wave.point.x) + Math.abs(world.y - wave.point.y);
                if (separation > BASE_SPACING) {
                    // ── TEAR-OFF: sever every bond on this node, then the
                    // node follows the pointer (grid-locked free adjust)
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
                // Inside the elastic zone: weld EXACTLY onto the twin via
                // snapShapeNode (circle rims translate the whole circle —
                // adjustShape's radius re-quantization would miss a
                // diagonal twin by up to half a cell). A no-op when the
                // two already coincide — the common case.
                const welded = snapShapeNode(shape, nodeMode.nodeId, wave.point);
                const nextShapes = shapes.slice();
                nextShapes[nodeMode.shapeIndex] = welded;
                context.drawing({ ...state, shapes: nextShapes });
                return;
            }
            // ── Unbonded node: proximity CONNECT (destination-based) ──
            // Another shape's node within the grab radius of the
            // DESTINATION (the snapped pointer world point) bonds the two.
            // Scanning the destination (not the dragged node's pre-move
            // point) is what makes CIRCLE RIM drags lockable: a rim
            // adjust re-quantizes the radius, teleporting the rim node
            // hundreds of world units between frames — a pre-move scan
            // would never catch the contact that IS at the pointer now.
            // Topmost shape wins ties.
            let twin: { shapeIndex: number; nodeId: string } | null = null;
            const hitRadius = hitRadiusWorld(transform);
            for (let s = shapes.length - 1; s >= 0; s--) {
                if (s === nodeMode.shapeIndex) continue;
                for (const node of shapeNodes(shapes[s])) {
                    if (
                        Math.hypot(node.point.x - world.x, node.point.y - world.y) <= hitRadius
                    ) {
                        twin = { shapeIndex: s, nodeId: node.id };
                    }
                }
            }
            if (twin) {
                const target = twin;
                const twinNode = shapeNodes(shapes[target.shapeIndex]).find(
                    (n) => n.id === target.nodeId,
                );
                if (twinNode) {
                    // Weld EXACTLY onto the twin's grid point
                    // (snapShapeNode: circle rims roll the whole circle
                    // onto the junction) and record the bond (connect is
                    // idempotent)
                    const welded = snapShapeNode(shape, nodeMode.nodeId, twinNode.point);
                    const nextShapes = shapes.slice();
                    nextShapes[nodeMode.shapeIndex] = welded;
                    const connected = connect(
                        bonds,
                        { shapeIndex: nodeMode.shapeIndex, nodeId: nodeMode.nodeId },
                        target,
                    );
                    context.drawing({ ...state, shapes: nextShapes, connections: connected });
                    return;
                }
            }
            // Free (unbonded, no contact) node: grid-locked adjustment
            const adjusted = adjustShape(shape, nodeMode.nodeId, world);
            if (!adjusted) return;
            const nextShapes = shapes.slice();
            nextShapes[nodeMode.shapeIndex] = adjusted;
            context.drawing({ ...state, shapes: nextShapes });
        };

        // ── DBLCLICK BREAK — the deliberate bond-breaker ──
        // Double-clicking a bonded node severs EVERY bond on that node
        // ("until the user purposely break the node"). Any node can bond
        // and so any node can break — the junction's halo marks exactly
        // which handle the double-click targets. Both shapes keep their
        // geometry — they just aren't welded anymore.
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

        // ── RELEASE auto-lock ("drag old shapes into a position where the
        // nodes share a coordinate → they lock") ──
        // A finished drag (whole-shape group move OR node adjustment)
        // runs the SAME exact-contact check a fresh draw gets
        // (autoLockShapes): only node POINT coincidence bonds — the
        // settled geometry never slides toward a neighbor (a NEAR node,
        // even one grid step away, must not snatch the shape onto it;
        // intentional junctions bond per-frame via the node drag's
        // destination scan). The last move frame already wrote the
        // settled geometry into the drawing state, so the check runs
        // over the LIVE state. Guards:
        // - Geometry-signature compare: an unchanged grab (a press-click
        //   that never moved) skips the lock — a mere press must never
        //   record bonds for geometry that did not actually move.
        // - Only the MOVED shapes participate (the bond group / the
        //   adjusted shape); static shapes never bond each other.
        const releaseLock = (movingIndices: number[]) => {
            const state = context.drawing();
            const locked = autoLockShapes(state, movingIndices);
            // Write only when the lock changed something (the common
            // no-contact release is a pure no-op)
            if (
                locked.shapes !== state.shapes ||
                locked.connections !== state.connections
            ) {
                context.drawing({
                    ...state,
                    shapes: locked.shapes,
                    connections: locked.connections,
                });
            }
        };

        // Release the grab — the adjusted/moved geometry is already live
        // in the state (each move wrote it); the gesture flag ALWAYS
        // unwinds here and the release auto-lock runs only for ACTUAL
        // movements.
        const endGrab = () => {
            if (!grab) return;
            const released = grab;
            const sig = grabSig;
            grab = null;
            grabSig = null;
            // ALWAYS unwind `adjusting` first — a release that moved
            // NOTHING (a click with no pointermove, a jitter inside half a
            // grid cell, an elastic-hold bend that returns to the twin)
            // must still clear the flag, otherwise it latches FOREVER and
            // gates EVERY gesture: dragToPanPlugin's mayPan and
            // toolRouterPlugin's draw gate both refuse to run while it is
            // set → "after zooming around, dragging AND drawing both stop
            // responding". The release check below still runs for real
            // drags only.
            context.drawing({ ...context.drawing(), adjusting: false });
            // Re-read the LIVE grabbed shape and only lock when the drag
            // actually moved its nodes (a mere click never records bonds)
            const live = context.drawing();
            const current = live.shapes[released.shapeIndex];
            const moved =
                !!current && (!sig || shapeSig(current) !== sig);
            if (!moved) return;
            // The auto-lock's movers: the bond group of the grabbed shape
            // for a whole-shape (multi-select) drag, the adjusted shape for
            // a node drag
            releaseLock(
                released.mode === 'shape'
                    ? movingSetOf(live.connections ?? [], released.movingSeeds)
                    : [released.shapeIndex],
            );
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
        // Browser-cancelled pointer (touchpad gesture takeover etc.): the
        // pointerup will never come — unwind exactly like a leave or the
        // grabbed gesture's state latches and every later press is refused
        const handlePointerCancel = () => {
            endGrab();
            setCursor(null);
        };

        surface.addEventListener('pointerdown', handlePointerDown);
        surface.addEventListener('pointermove', handlePointerMove);
        surface.addEventListener('pointerup', handlePointerUp);
        surface.addEventListener('pointerleave', handlePointerLeave);
        // Browser-cancelled gestures unwind with the release path
        surface.addEventListener('pointercancel', handlePointerCancel);
        // The deliberate bond-breaker
        surface.addEventListener('dblclick', handleDoubleClick);

        return () => {
            surface.removeEventListener('pointerdown', handlePointerDown);
            surface.removeEventListener('pointermove', handlePointerMove);
            surface.removeEventListener('pointerup', handlePointerUp);
            surface.removeEventListener('pointerleave', handlePointerLeave);
            surface.removeEventListener('pointercancel', handlePointerCancel);
            surface.removeEventListener('dblclick', handleDoubleClick);
        };
    },
) satisfies DrawPlugin;
