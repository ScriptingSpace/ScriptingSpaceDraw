// ─────────────────────────────────────────────────────────────────────────────
// DrawPluginContext — the shared service bundle the host passes to every
// plugin execution.
//
// The context is the ONLY way a plugin touches the dashboard. It bundles:
// - `transform` — the single source of truth for pan/zoom state (the
//   CanvasTransform state handle from useStateHook: call with no args to
//   read, with a value to write + trigger re-render). Cross-reference:
//   packages/presource/react/src/hooks/local/state.ts — the setter takes a
//   VALUE, not a React-style updater; read-then-write.
// - `pointer` — live pointer state (viewport-relative cursor point, drag
//   bookkeeping, pressed button state). Written by the pointer core plugin,
//   read by any plugin that needs cursor tracking (coordinate HUD) or
//   drag gestures (pan).
// - `keyboard` — live keyboard state (held-key set). Written by the
//   keyboard core plugin, read by gesture plugins (space+drag pan).
// - `surface` — a ref accessor to the canvas surface DOM element. The host
//   owns the element; plugins read it for measurements (grid size, pointer
//   coordinate conversion) and the host passes it to `onMount` callbacks.
// - `viewport` — the measured pixel size of the canvas surface (state
//   handle; written by the resize core plugin, read by the grid + reset).
// - `palette` — the color tokens (from ../functions/palette.ts) so plugins
//   stay decoupled from the palette module.
// - `render` — forces a host re-render (plugins that keep their own mutable
//   state in refs call this when that state changes).
//
// ALL handles are stable across renders (useStateHook/useReferenceHook
// contract — accessor identity never changes), so plugins can safely close
// over them in effects and event listeners.
// ─────────────────────────────────────────────────────────────────────────────

import type { CanvasTransform } from '../../functions/canvasTransform';
import type { DrawPalette } from '../../functions/palette';
import { PALETTE_ACCENT, DRAW_DEFAULT_RECENT_COLORS } from '../../functions/palette';
import type { DrawPoint, DrawShape } from '../../functions/shapes';
import type { DrawBond } from '../../functions/connection';
import type { DrawToolRegistry } from './DrawToolRegistry';

// Pointer state — written by the pointer core plugin on every pointer event.
export type DrawPointerState = {
    // Viewport-relative cursor point while the pointer is over the canvas,
    // null when it is off-canvas (the coordinate HUD hides on null)
    cursor: { x: number; y: number } | null;
    // The last pointer point of the active drag (null when not dragging).
    // The pan gesture plugin reads this + the live cursor to compute the
    // frame delta.
    dragLast: { x: number; y: number } | null;
    // The button that started the active drag (null when not dragging)
    dragButton: number | null;
};

// Keyboard state — written by the keyboard core plugin on keydown/keyup.
// Tracks the set of currently held keys by `event.code`.
export type DrawKeyboardState = {
    // Currently held key codes (e.g. 'Space'). The pan gesture plugin reads
    // has('Space') to arm space+drag.
    held: Set<string>;
};

// Wheel state — written by the wheel core plugin on every wheel event.
// Declared here (next to the other state shapes) but CONSTRUCTED by the
// wheel plugin itself (createWheelState lives in wheelPlugin.ts — the state
// shape is shared, the default value is the plugin's business).
export type DrawWheelState = {
    // Multiplicative zoom factor from the latest deltaY (1 = no zoom)
    zoomFactor: number;
    // Horizontal delta in pixels from the latest deltaX (0 = none)
    panX: number;
    // Monotonic counter — increments on every wheel event so gesture
    // plugins can detect fresh events even when the values repeat
    sequence: number;
};

// Helper constructors (used by the host to build the initial state objects)
export const createPointerState = (): DrawPointerState => ({
    cursor: null,
    dragLast: null,
    dragButton: null,
});

export const createKeyboardState = (): DrawKeyboardState => ({
    held: new Set<string>(),
});

// Drawing state — written by TOOL plugins (circle, rectangle, curve) and by
// the color palette plugin (color: the active swatch); read by the drawing
// layer plugin.
export type DrawDrawingState = {
    // All COMMITTED shapes (world coordinates — they pan/zoom with the
    // grid). The drawing layer renders these every pass; the node editor
    // renders their adjustment handles.
    shapes: DrawShape[];
    // The shape currently being drawn (draft) — rendered by the drawing
    // layer as a live preview while the pointer drags. Null when idle.
    draft: DrawShape | null;
    // Whether a drawing drag is in progress (the dragToPanPlugin reads this
    // to yield left-drag to the active tool)
    drawing: boolean;
    // Whether a NODE ADJUSTMENT drag is in progress (set by
    // nodeEditorPlugin when it claims a press on a shape's handle node).
    // Gesture plugins (dragToPan's mayPan, toolRouter's pointerdown gate)
    // read this to yield the left button to node dragging — in pan mode
    // AND tool mode alike.
    adjusting: boolean;
    // The ACTIVE stroke color (hex — a recency-block color or a wheel-picked
    // custom ink). New shapes are stamped with it at drag time (tool plugins
    // read it when writing the draft); the committed shape keeps the
    // creation-time ink. Written by the colorPalettePlugin (swatch buttons
    // AND the color wheel).
    color: string;
    // The RECENCY LEDGER of stroke inks (most-recent-first) — the content of
    // the right-side palette's recency blocks. Capped at DRAW_MAX_RECENT_COLORS
    // entries; every selection (swatch click or color-wheel pick) moves its
    // color to the front via pushRecentColor (cross-reference:
    // ../../functions/palette.ts). Seeded with the most common colors
    // (DRAW_DEFAULT_RECENT_COLORS — the "by default, set the most common
    // color" contract). 10th block = the color wheel (no hex entry).
    recentColors: string[];
    // The SELECTION (multi-select from the left-drag marquee): indices into
    // the shapes array, stored BOND-EXPANDED (each pick arrives already
    // expanded through the endpoint-bond chain — "jointed shapes are
    // selected together", cross-reference: functions/selection.ts). Ephemeral
    // UI state — written by selectionPlugin (marquee release) and
    // nodeEditorPlugin (grabbing a shape re-skims the selection to that
    // shape's bond group; grabbing a selected shape KEEPS the multi-select).
    // Grabbing a selected shape also moves every member (multi-move).
    selection: number[];
    // The LIVE RUBBER-BAND BOX of an in-flight marquee drag (world-space:
    // anchored to the plane like the shapes — panning never runs mid-marquee
    // so the anchor stays stable). start = press anchor; current = live
    // pointer point. Null when no marquee drag is running. Written by
    // selectionPlugin (owns the left-drag gesture in pan mode), rendered by
    // the same plugin, consumed at release through selectShapesInBounds.
    marquee: { start: DrawPoint; current: DrawPoint } | null;
    // The ENDPOINT BONDS (cross-reference: functions/connection.ts) — two
    // shapes sharing an endpoint MOVE AS ONE UNIT until the user breaks
    // the node. Plain data (shapeIndex + nodeId pairs), resolved against
    // the shapes array at query time. Written by the shape tools (auto-
    // connect on commit) and nodeEditorPlugin (break / re-connect).
    connections: DrawBond[];
};

// Initial drawing state — the DEFAULT ink is the palette's primary accent
// (shown pre-selected in the recency blocks) and the recency ledger seeds
// with the MOST COMMON colors (rainbow — cross-reference:
// ../../functions/palette.ts DRAW_DEFAULT_RECENT_COLORS). Both default
// fields are COPIES: the constant arrays must survive the session, third
// parties may mutate the state they read.
export const createDrawingState = (): DrawDrawingState => ({
    shapes: [],
    draft: null,
    drawing: false,
    adjusting: false,
    color: PALETTE_ACCENT,
    recentColors: [...DRAW_DEFAULT_RECENT_COLORS],
    selection: [],
    marquee: null,
    connections: [],
});
// The context bundle itself
export type DrawPluginContext = {
    // Pan/zoom state — THE single source of truth (read/write state handle)
    transform: {
        (): CanvasTransform;
        (value: CanvasTransform): void;
    };
    // Pointer state — a ref-backed handle (writes do NOT re-render; the
    // transform writes are what drive re-renders during gestures)
    pointer: {
        (): DrawPointerState;
        (value: DrawPointerState): void;
    };
    // Keyboard state — ref-backed (held-key set; writes do NOT re-render)
    keyboard: {
        (): DrawKeyboardState;
        (value: DrawKeyboardState): void;
    };
    // Wheel state — ref-backed (written by the wheel core plugin; gesture
    // plugins read it on the wheel event itself)
    wheel: {
        (): DrawWheelState;
        (value: DrawWheelState): void;
    };
    // The viewport-relative pointer point of the LATEST wheel event (the
    // zoom-at-pointer anchor — written by the wheel core plugin)
    wheelPoint: {
        (): { x: number; y: number };
        (value: { x: number; y: number }): void;
    };
    // Canvas surface element accessor (ref-backed; the host owns the element)
    surface: {
        (): HTMLDivElement | null;
        (value: HTMLDivElement | null): void;
    };
    // Measured viewport size of the canvas surface (state handle — writes
    // re-render so the grid re-renders on resize)
    viewport: {
        (): { width: number; height: number };
        (value: { width: number; height: number }): void;
    };
    // Palette tokens (static — module constants, never changes)
    palette: DrawPalette;
    // Force a host re-render (for plugins keeping mutable ref state)
    render: () => void;
    // Snap back to the origin-centered resting state for the CURRENT
    // viewport size (the Reset view contract — consumed by the zoom HUD
    // plugin; implemented by the host from transform + viewport handles)
    resetTransform: () => void;
    // ── TOOL SYSTEM (added for the toolbar + tool plugins) ──
    // The tool registry — tools register themselves into it; the toolbar
    // renders a button per registered tool; interactions are routed to the
    // active tool. Created by the HOST (stable identity across renders).
    tools: DrawToolRegistry;
    // The id of the ACTIVE tool (state handle — writes re-render so the
    // toolbar highlights the active button and the drawing layer shows the
    // right draft). Null = no tool active → left-drag pans the canvas.
    activeTool: {
        (): string | null;
        (value: string | null): void;
    };
    // Drawing state — ref-backed shape store (writes via
    // context.drawing({ ...state, shapes: [...] }) from tool plugins; the
    // drawing layer plugin reads it on every render pass). Draft/committed
    // shapes live in world coordinates. `.color` is the active stroke ink
    // (read by the color palette plugin for its highlighted swatch and by
    // the tool plugins when stamping new shapes).
    drawing: {
        (): DrawDrawingState;
        (value: DrawDrawingState): void;
    };
};
