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
import type { DrawShape } from '../../functions/shapes';
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

// Drawing state — written by TOOL plugins (pen, shapes) via the tool
// registry's interaction API, read by the drawing layer plugin.
export type DrawDrawingState = {
    // All COMMITTED shapes (world coordinates — they pan/zoom with the
    // grid). The drawing layer renders these every pass.
    shapes: DrawShape[];
    // The shape currently being drawn (draft) — rendered by the drawing
    // layer as a live preview while the pointer drags. Null when idle.
    draft: DrawShape | null;
    // Whether a drawing drag is in progress (the dragToPanPlugin reads this
    // to yield left-drag to the active tool)
    drawing: boolean;
};

// Initial drawing state
export const createDrawingState = (): DrawDrawingState => ({
    shapes: [],
    draft: null,
    drawing: false,
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
    // shapes live in world coordinates.
    drawing: {
        (): DrawDrawingState;
        (value: DrawDrawingState): void;
    };
};
