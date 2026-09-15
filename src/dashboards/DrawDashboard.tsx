import React from 'react';
import {
    styledComponent,
    useReferenceHook,
    useStateHook,
} from '@presource/react';
import { createInitialTransform } from '../functions/canvasTransform';
import type { CanvasTransform } from '../functions/canvasTransform';
import { drawPalette } from '../functions/palette';
import {
    createDrawPluginRuntime,
    createDrawToolRegistry,
    createKeyboardState,
    createPointerState,
    createWheelState,
} from '../plugins/core';
import type {
    DrawPluginApi,
    DrawPluginContext,
    DrawKeyboardState,
    DrawPointerState,
    DrawWheelState,
    DrawDrawingState,
} from '../plugins/core';
import {
    transformStorePlugin,
    pointerPlugin,
    wheelPlugin,
    keyboardPlugin,
    resizePlugin,
    gridPlugin,
    coordinateHudPlugin,
    zoomHudPlugin,
    titlePlugin,
    zoomOnWheelPlugin,
    panOnWheelPlugin,
    dragToPanPlugin,
    toolbarPlugin,
    colorPalettePlugin,
    circleToolPlugin,
    rectangleToolPlugin,
    lineToolPlugin,
    nodeEditorPlugin,
    toolRouterPlugin,
    drawingLayerPlugin,
} from '../plugins';
import { createDrawingState } from '../plugins/core/DrawPluginContext';

// ─────────────────────────────────────────────────────────────────────────────
// DrawDashboard — the plugin host / executor.
//
// PLUGIN ARCHITECTURE (user contract: "everything should be a plugin... every
// plugin should be a stand alone function that the Draw Dashboard can execute
// again to render out the UI as well as their functionality on the UI
// itself"):
//
// The dashboard is a PURE HOST. It owns:
// 1. The state HANDLES (transform / pointer / keyboard / wheel / viewport /
//    surface) — hook calls must live in a component, so the host creates
//    them and hands them to the plugins through the context.
// 2. The plugin RUNTIME (createDrawPluginRuntime) — registration, re-
//    execution, mount cycles, disposal.
// 3. The EXECUTION LOOP: on every render pass it calls runtime.executeAll
//    (context) — every registered plugin function runs with the live
//    context and returns its UI node; the host renders the collected nodes
//    inside the canvas surface. This is "the dashboard executes the plugins
//    again" on every render.
// 4. The MOUNT CYCLE: after the surface element exists (ref callback) the
//    host runs runtime.runMountCycle — every plugin's `mount` slot fires
//    exactly once, wiring its event listeners. Disposal happens on unmount
//    (disposeAll) and on plugin removal (disposeOne inside api.remove).
//
// CORE vs REMOVABLE (registered in registerCorePlugins / registerDefaultPlugins):
// - CORE (usePermanent — NON-REMOVABLE fundamental building blocks):
//     transformStorePlugin  — the pan/zoom state itself
//     pointerPlugin         — mouse press / move / release tracking
//     wheelPlugin           — raw wheel input normalization (non-passive)
//     keyboardPlugin        — keyboard press/release tracking
//     resizePlugin          — viewport measurement
//   These ARE the input substrate; without them no gesture or readout can
//   work. They are uniform plugins (same execution model) but immune to
//   api.remove.
// - REMOVABLE (register — the default feature set):
//     gridPlugin            — the SVG grid renderer
//     coordinateHudPlugin   — bottom-left cursor readout
//     zoomHudPlugin         — bottom-right scale readout + Reset view
//     titlePlugin           — "Draw Dashboard v1.0.0" floating label
//     zoomOnWheelPlugin     — vertical wheel → zoom at pointer
//     panOnWheelPlugin      — horizontal wheel → pan left/right
//     dragToPanPlugin       — drag gestures → grab-the-paper pan
//     toolbarPlugin         — bottom-center tool buttons (tool-agnostic)
//     colorPalettePlugin    — right-side stroke palette (while a tool is
//                             armed; writes context.drawing().color)
//     …tool plugins         — circle / rectangle / line (curve) — all
//                             grid-locked ("This isn't free form")
//     nodeEditorPlugin      — shape node handles + click-drag adjustment
//                             (registers BEFORE tool-router so a node grab
//                             can swallow the press via
//                             stopImmediatePropagation)
//     toolRouterPlugin      — routes pointer events to the active tool
//     drawingLayerPlugin    — renders committed shapes + the live draft
//
// LAYOUT (unchanged contract): the canvas fills the ENTIRE viewport. No
// header, no footer. POINTER MATH: viewport-relative pixels via
// getBoundingClientRect — now inside the pointer/wheel core plugins.
// ─────────────────────────────────────────────────────────────────────────────

// Local palette token — the canvas well background (deeper than the app
// background). The rest of the tokens flow to plugins through
// context.palette (drawPalette).
const PALETTE_WELL = '#1a1b26';

// Root shell — locked to the viewport (app.css zeroes the body margin and
// locks overflow). The canvas IS the whole app: no header, no footer.
const DashboardRoot = styledComponent('div', {
    height: '100%',
    width: '100%',
    position: 'relative' as const,
    background: PALETTE_WELL,
    color: '#a9b1d6',
    fontFamily:
        'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    boxSizing: 'border-box' as const,
    overflow: 'hidden' as const,
});

// Canvas surface — fills the entire viewport; the mount point for every
// plugin's event listeners and the container for every plugin's UI node.
// Ref-forwarding cast: the styledComponent return type (React.FC) lacks
// `ref` — Emotion forwards it at runtime (same cast pattern documented in
// the presource styledComponent notes).
const CanvasSurface = styledComponent<{ toolArmed: boolean }>(
    'div',
    {
        position: 'absolute' as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden' as const,
        // Cursor reflects the button map: crosshair while a tool is armed
        // (left-drag draws), grab when no tool is active (left-drag pans —
        // and right-drag always pans)
        cursor: ({ toolArmed }) => (toolArmed ? 'crosshair' : 'grab'),
    },
) as unknown as React.FC<
    { toolArmed: boolean } & React.HTMLAttributes<HTMLDivElement> & {
        ref?: React.Ref<HTMLDivElement>;
    }
>;

// The CORE plugin ids — exported so tests (and future tooling) can assert
// permanence without hardcoding strings
export const CORE_PLUGIN_IDS = [
    'transform-store',
    'pointer',
    'wheel',
    'keyboard',
    'resize',
] as const;

// registerCorePlugins — registers the NON-REMOVABLE fundamental plugins via
// api.usePermanent. Idempotent: usePermanent upgrades/keeps existing ids.
const registerCorePlugins = (api: DrawPluginApi) => {
    api.usePermanent('transform-store', transformStorePlugin);
    api.usePermanent('pointer', pointerPlugin);
    api.usePermanent('wheel', wheelPlugin);
    api.usePermanent('keyboard', keyboardPlugin);
    api.usePermanent('resize', resizePlugin);
};

// registerDefaultPlugins — registers the default REMOVABLE feature set via
// api.register. Idempotent (duplicate ids are rejected by the registry).
// REGISTRATION ORDER MATTERS for plugins reading fresh input state on the
// same event (listeners fire in registration order):
//   grid/HUDs/title (render-only) → wheel/pan gestures → drag-to-pan →
//   TOOLBAR (renders the tool buttons) → COLOR PALETTE (right-side swatches,
//   appears while a tool is armed) → TOOL PLUGINS (register their tool
//   definitions BEFORE the router mounts) → NODE EDITOR (grabs node drags
//   before the router — listener order = registration order) → tool router
//   → drawing layer.
const registerDefaultPlugins = (api: DrawPluginApi) => {
    api.register('grid', gridPlugin);
    api.register('coordinate-hud', coordinateHudPlugin);
    api.register('zoom-hud', zoomHudPlugin);
    api.register('title', titlePlugin);
    api.register('zoom-on-wheel', zoomOnWheelPlugin);
    api.register('pan-on-wheel', panOnWheelPlugin);
    api.register('drag-to-pan', dragToPanPlugin);
    // Tool system: toolbar (tool-agnostic UI) → tools (register into
    // context.tools) → node editor (shape node handles + adjustment; grabs
    // node presses BEFORE the router) → router (routes pointer events to
    // the active tool) → drawing layer (renders committed shapes + the
    // live draft)
    api.register('toolbar', toolbarPlugin);
    // The stroke-color palette — writes context.drawing().color; reads the
    // swatch list through context.palette (color-agnostic render)
    api.register('color-palette', colorPalettePlugin);
    api.register('circle-tool', circleToolPlugin);
    api.register('rectangle-tool', rectangleToolPlugin);
    api.register('line-tool', lineToolPlugin);
    api.register('node-editor', nodeEditorPlugin);
    api.register('tool-router', toolRouterPlugin);
    api.register('drawing-layer', drawingLayerPlugin);
};

export const DrawDashboard = React.memo(() => {
    // ── State handles (the host owns the hook calls) ──
    // THE single source of truth for the canvas: pan (x, y in canvas units
    // at the viewport's top-left corner) + scale. Starts UNSET (null) — the
    // transformStorePlugin seeds it on first execution.
    const transform = useStateHook<CanvasTransform | null>(null);

    // Ref-backed interaction state (writes do NOT re-render — the
    // transform writes are what drive renders during gestures)
    const pointerRef = useReferenceHook<DrawPointerState | null>(createPointerState());
    const keyboardRef = useReferenceHook<DrawKeyboardState | null>(createKeyboardState());
    const wheelRef = useReferenceHook<DrawWheelState | null>(createWheelState());
    const wheelPointRef = useReferenceHook<{ x: number; y: number } | null>(null);

    // Canvas surface element (ref-backed; set by the ref callback below)
    const surfaceRef = useReferenceHook<HTMLDivElement | null>(null);

    // ── Tool system state ──
    // The tool registry — created ONCE (stable identity; tools register
    // into it during plugin execution)
    const toolsRef = useReferenceHook<ReturnType<typeof createDrawToolRegistry> | null>(null);
    if (toolsRef() === null) {
        toolsRef(createDrawToolRegistry());
    }
    const tools = toolsRef() as ReturnType<typeof createDrawToolRegistry>;

    // The ACTIVE tool id (STATE — writes re-render so the toolbar
    // highlights the active button and the router reads the fresh id).
    // Null = no tool → left-drag pans the canvas.
    const activeTool = useStateHook<string | null>(null);

    // Drawing state (ref-backed — tool handlers write shapes/drafts through
    // it; the drawing layer plugin reads it on every render pass). The
    // context wraps this handle so writes also trigger a host re-render.
    const drawingRef = useReferenceHook<DrawDrawingState | null>(createDrawingState());

    // Viewport size of the canvas area (STATE — writes re-render so the
    // grid re-renders on resize; seeded by the resize plugin's first
    // measurement, with the 800×600 design size as the pre-measure default)
    const viewport = useStateHook<{ width: number; height: number }>({
        width: 800,
        height: 600,
    });

    // Render trigger — bumps a dummy state so plugin-initiated re-renders
    // re-run the execution loop (currently unused by the default plugins,
    // but part of the context contract for third-party plugins)
    const [, setRenderTick] = React.useState(0);
    const render = React.useCallback(() => setRenderTick((tick) => tick + 1), []);

    // ── Plugin runtime (ONE per component lifetime — stable identity) ──
    const runtimeRef = useReferenceHook<ReturnType<typeof createDrawPluginRuntime> | null>(null);
    if (runtimeRef() === null) {
        runtimeRef(createDrawPluginRuntime());
    }
    const runtime = runtimeRef() as ReturnType<typeof createDrawPluginRuntime>;

    // ── The context bundle — rebuilt each render with LIVE values ──
    // The handles themselves are stable; the bundle object is fresh each
    // pass so plugins reading context.transform() etc. always get the
    // current value.
    const context: DrawPluginContext = {
        transform: transform as unknown as DrawPluginContext['transform'],
        pointer: pointerRef as unknown as DrawPluginContext['pointer'],
        keyboard: keyboardRef as unknown as DrawPluginContext['keyboard'],
        wheel: wheelRef as unknown as DrawPluginContext['wheel'],
        wheelPoint: wheelPointRef as unknown as DrawPluginContext['wheelPoint'],
        surface: surfaceRef as unknown as DrawPluginContext['surface'],
        viewport: viewport as unknown as DrawPluginContext['viewport'],
        palette: drawPalette,
        render,
        // resetTransform — the Reset view control (consumed by the zoom HUD
        // plugin): snap back to the origin-centered resting state for the
        // CURRENT viewport size
        resetTransform: () => {
            const { width, height } = viewport();
            transform(createInitialTransform(width, height));
        },
        // ── Tool system ──
        tools,
        activeTool: activeTool as unknown as DrawPluginContext['activeTool'],
        // The drawing handle — a ref-backed write that ALSO triggers a
        // re-render (shape changes must appear immediately; the drawing
        // layer reads this handle on every pass). Implemented as a wrapper
        // over the raw ref so tool plugins can simply write.
        drawing: ((updated?: DrawDrawingState) => {
            if (updated === undefined) return drawingRef();
            drawingRef(updated);
            // Shape/draft changes need a render pass (the drawing layer
            // reads the ref at execution time)
            render();
        }) as unknown as DrawPluginContext['drawing'],
    };

    // ── Plugin registration (once per lifetime, before first execution) ──
    // Registration happens during FIRST render only (the registry lives in
    // the runtime; re-registering every pass would hit duplicate-id
    // rejections — harmless but wasteful).
    if (runtime.api.list().length === 0) {
        registerCorePlugins(runtime.api);
        registerDefaultPlugins(runtime.api);
    }

    // ── THE EXECUTION LOOP — every plugin function runs on EVERY render ──
    // This is the core of the contract: the dashboard executes the plugins
    // again each pass; each plugin returns its UI node (or null), computed
    // from the LIVE context state.
    const pluginNodes = runtime.executeAll(context);

    // ── Mount cycle driver ──
    // Runs whenever the surface element changes (ref callback fires on
    // mount) and after every render pass while unmounted plugins remain.
    // runMountCycle is idempotent per plugin (the runtime tracks mounted
    // ids), so re-running it is cheap.
    const runMountCycle = React.useCallback(() => {
        const surface = surfaceRef();
        if (!surface) return;
        runtime.runMountCycle(surface, context as never);
        // context is intentionally fresh per pass (live values); the mount
        // cycle passes it to plugins exactly once per plugin lifetime
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [runtime]);

    // Drive a mount cycle after every commit (covers late-registered
    // plugins and the first mount after the ref callback)
    React.useEffect(() => {
        runMountCycle();
    });

    // Full teardown on unmount — every plugin's disposer runs (reverse
    // order inside the runtime)
    React.useEffect(() => () => runtime.disposeAll(), [runtime]);

    // Surface ref callback — stores the element, then runs a mount cycle
    // immediately (plugins can wire listeners the moment the element exists)
    const handleSurfaceRef = React.useCallback(
        (element: HTMLDivElement | null) => {
            surfaceRef(element);
            if (element) runMountCycle();
        },
        [runMountCycle, surfaceRef],
    );

    return (
        <DashboardRoot data-testid="dashboard-root">
            {/* toolArmed drives the cursor: crosshair while a tool is
                selected (left-drag draws), grab when idle (left-drag pans) */}
            <CanvasSurface
                ref={handleSurfaceRef}
                toolArmed={activeTool() !== null}
                data-testid="canvas-surface"
            >
                {/* Every plugin's UI node, collected by the execution loop.
                    The order is registration order: grid → HUDs → title. */}
                {pluginNodes.map((node, index) => (
                    // Plugins own their own positioning (absolute/fixed);
                    // the fragment wrapper adds no layout of its own
                    <React.Fragment key={index}>{node}</React.Fragment>
                ))}
            </CanvasSurface>
        </DashboardRoot>
    );
});

// Re-export for consumers that want the canvas-space read helpers alongside
// the dashboard (pure math passthrough — see canvasTransform.ts)
export { applyPan, applyZoom, screenToCanvas } from '../functions/canvasTransform';
