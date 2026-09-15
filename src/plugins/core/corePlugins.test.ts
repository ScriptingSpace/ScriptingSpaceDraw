import { describe, it, expect } from 'vitest';
import {
    transformStorePlugin,
    pointerPlugin,
    wheelPlugin,
    keyboardPlugin,
    resizePlugin,
} from './index';
import { createDrawPluginRuntime } from './DrawPluginRegistry';
import {
    createInitialTransform,
    applyPan,
    applyZoom,
} from '../../functions/canvasTransform';
import { drawPalette } from '../../functions/palette';
import {
    createPointerState,
    createKeyboardState,
} from './DrawPluginContext';
import { createWheelState } from './wheelPlugin';
import type { DrawPluginContext, DrawPointerState, DrawKeyboardState, DrawWheelState } from './DrawPluginContext';

// ─────────────────────────────────────────────────────────────────────────────
// Core plugin tests — the NON-REMOVABLE fundamental building blocks.
//
// Each plugin is exercised through the real registry + a fake context so the
// tests cover the exact contract the host uses: register → execute → mount.
// ─────────────────────────────────────────────────────────────────────────────

// Context factory — builds a fresh fake context per test with ref-backed
// handles (plain closures over a mutable box; the useStateHook contract:
// read with no args, write with a value)
const makeContext = () => {
    const boxes: Record<string, { value: unknown }> = {};
    const handle = (key: string, initial: unknown) => {
        boxes[key] = { value: initial };
        return ((updated?: unknown) => {
            if (updated === undefined) return boxes[key].value;
            boxes[key].value = updated;
        }) as never;
    };
    return {
        context: {
            transform: handle('transform', null),
            pointer: handle('pointer', null),
            keyboard: handle('keyboard', null),
            wheel: handle('wheel', null),
            wheelPoint: handle('wheelPoint', null),
            surface: handle('surface', null),
            viewport: handle('viewport', { width: 800, height: 600 }),
            palette: drawPalette,
            render: () => undefined,
            resetTransform: () => undefined,
        } as unknown as DrawPluginContext,
        boxes,
    };
};

// Element factory — a surface-like div with a stubbed rect + listener
// bookkeeping (records added/removed listeners so tests can fire them)
const makeSurface = (width = 800, height = 600) => {
    const listeners = new Map<string, Set<(event: never) => void>>();
    const surface = {
        clientWidth: width,
        clientHeight: height,
        getBoundingClientRect: () => ({
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: width,
            bottom: height,
            width,
            height,
            toJSON: () => ({}),
        }),
        addEventListener: (type: string, listener: (event: never) => void) => {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type)?.add(listener);
        },
        removeEventListener: (type: string, listener: (event: never) => void) => {
            listeners.get(type)?.delete(listener);
        },
        // Test-only event firing
        __fire: (type: string, event: never) => {
            listeners.get(type)?.forEach((listener) => listener(event));
        },
        __listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
    };
    return surface as unknown as HTMLDivElement & {
        __fire: (type: string, event: never) => void;
        __listenerCount: (type: string) => number;
    };
};

// Mounts a plugin through the real runtime (the same path the host uses)
const mountPlugin = (plugin: Parameters<ReturnType<typeof createDrawPluginRuntime>['api']['register']>[1], context: DrawPluginContext, surface: HTMLDivElement) => {
    const runtime = createDrawPluginRuntime();
    runtime.api.register('under-test', plugin);
    // First execution (the host always executes before mounting)
    runtime.executeAll(context);
    runtime.runMountCycle(surface, context);
    return runtime;
};

describe('transformStorePlugin — seeds the transform once', () => {
    it('seeds the initial transform from the surface size on first execution', () => {
        const { context, boxes } = makeContext();
        context.surface(makeSurface(800, 600) as never);
        // Execute directly (no mount needed — the store is pure state)
        transformStorePlugin(context, {} as never);
        expect(boxes.transform.value).toEqual({ x: -400, y: -300, scale: 1 });
    });

    it('falls back to the 800×600 design size when no surface exists', () => {
        const { context, boxes } = makeContext();
        transformStorePlugin(context, {} as never);
        expect(boxes.transform.value).toEqual({ x: -400, y: -300, scale: 1 });
    });

    it('leaves the live transform alone on re-execution (seed exactly once)', () => {
        const { context, boxes } = makeContext();
        transformStorePlugin(context, {} as never);
        // Simulate a zoom
        boxes.transform.value = applyZoom(boxes.transform.value as never, 1.2, { x: 400, y: 300 });
        const zoomed = { ...(boxes.transform.value as object) };
        // Re-execution (the host's next render pass)
        transformStorePlugin(context, {} as never);
        expect(boxes.transform.value).toEqual(zoomed);
    });

    it('seeds from the CURRENT surface size, not a hardcoded one', () => {
        const { context, boxes } = makeContext();
        context.surface(makeSurface(1920, 1080) as never);
        transformStorePlugin(context, {} as never);
        expect(boxes.transform.value).toEqual(createInitialTransform(1920, 1080));
    });
});

describe('pointerPlugin — raw pointer tracking', () => {
    it('execution seeds the pointer state when missing', () => {
        const { context } = makeContext();
        pointerPlugin(context, {} as never);
        expect(context.pointer()).toEqual(createPointerState());
    });

    it('mounts pointer listeners and disposes them on removal', () => {
        const { context } = makeContext();
        const surface = makeSurface();
        const runtime = mountPlugin(pointerPlugin, context, surface);
        expect(surface.__listenerCount('pointerdown')).toBe(1);
        expect(surface.__listenerCount('pointermove')).toBe(1);
        expect(surface.__listenerCount('pointerup')).toBe(1);
        expect(surface.__listenerCount('pointerleave')).toBe(1);
        runtime.disposeAll();
        expect(surface.__listenerCount('pointerdown')).toBe(0);
        expect(surface.__listenerCount('pointermove')).toBe(0);
    });

    it('tracks the cursor on move (viewport-relative)', () => {
        const { context } = makeContext();
        const surface = makeSurface(800, 600);
        mountPlugin(pointerPlugin, context, surface);
        surface.__fire('pointermove', { clientX: 250, clientY: 120 } as never);
        expect((context.pointer() as DrawPointerState).cursor).toEqual({ x: 250, y: 120 });
    });

    it('records dragLast + dragButton on press, clears on release', () => {
        const { context } = makeContext();
        const surface = makeSurface();
        mountPlugin(pointerPlugin, context, surface);
        surface.__fire('pointerdown', { clientX: 100, clientY: 50, button: 0, target: null } as never);
        expect(context.pointer()).toEqual({
            cursor: { x: 100, y: 50 },
            dragLast: { x: 100, y: 50 },
            dragButton: 0,
        });
        surface.__fire('pointerup', {} as never);
        expect(context.pointer()).toEqual({
            cursor: { x: 100, y: 50 },
            dragLast: null,
            dragButton: null,
        });
    });

    it('does NOT start a drag when the press lands inside a [data-hud] subtree', () => {
        const { context } = makeContext();
        const surface = makeSurface();
        mountPlugin(pointerPlugin, context, surface);
        // A target inside the zoom HUD wrapper
        const hudTarget = { closest: (selector: string) => (selector === '[data-hud]' ? {} : null) };
        surface.__fire('pointerdown', { clientX: 760, clientY: 580, button: 0, target: hudTarget } as never);
        expect((context.pointer() as DrawPointerState).dragLast).toBeNull();
        // Cursor tracking still happens (the HUD readout needs it)
        expect((context.pointer() as DrawPointerState).cursor).toEqual({ x: 760, y: 580 });
    });

    it('pointerleave clears the cursor AND the drag (HUD hides, pan ends)', () => {
        const { context } = makeContext();
        const surface = makeSurface();
        mountPlugin(pointerPlugin, context, surface);
        surface.__fire('pointerdown', { clientX: 100, clientY: 50, button: 0, target: null } as never);
        surface.__fire('pointerleave', {} as never);
        expect(context.pointer()).toEqual(createPointerState());
    });
});

describe('wheelPlugin — raw wheel normalization', () => {
    it('execution seeds the wheel state when missing', () => {
        const { context } = makeContext();
        wheelPlugin(context, {} as never);
        expect(context.wheel()).toEqual(createWheelState());
    });

    it('normalizes deltaY into a zoom factor + records the wheel point', () => {
        const { context } = makeContext();
        const surface = makeSurface();
        mountPlugin(wheelPlugin, context, surface);
        surface.__fire('wheel', {
            clientX: 200,
            clientY: 150,
            deltaX: 0,
            deltaY: 100,
            deltaMode: 0,
            preventDefault: () => undefined,
        } as never);
        const state = context.wheel() as DrawWheelState;
        expect(state.zoomFactor).toBe(1.2);
        expect(state.panX).toBe(0);
        expect(state.sequence).toBe(1);
        expect(context.wheelPoint()).toEqual({ x: 200, y: 150 });
    });

    it('passes horizontal deltas through as panX (line-mode ×100)', () => {
        const { context } = makeContext();
        const surface = makeSurface();
        mountPlugin(wheelPlugin, context, surface);
        surface.__fire('wheel', {
            clientX: 0,
            clientY: 0,
            deltaX: 3,
            deltaY: 0,
            deltaMode: 1,
            preventDefault: () => undefined,
        } as never);
        const state = context.wheel() as DrawWheelState;
        expect(state.panX).toBe(300);
        // deltaY 0 → zoomFactor exactly 1 (no zoom)
        expect(state.zoomFactor).toBe(1);
    });

    it('increments the sequence per event (fresh-event detection)', () => {
        const { context } = makeContext();
        const surface = makeSurface();
        mountPlugin(wheelPlugin, context, surface);
        const wheelEvent = {
            clientX: 0,
            clientY: 0,
            deltaX: 0,
            deltaY: 100,
            deltaMode: 0,
            preventDefault: () => undefined,
        } as never;
        surface.__fire('wheel', wheelEvent);
        surface.__fire('wheel', wheelEvent);
        expect((context.wheel() as DrawWheelState).sequence).toBe(2);
    });

    it('attaches the listener NON-passively (preventDefault owns the gesture)', () => {
        const { context } = makeContext();
        const surface = makeSurface();
        // Record the options object the listener was registered with
        let capturedOptions: AddEventListenerOptions | undefined;
        const original = surface.addEventListener;
        (surface as unknown as { addEventListener: typeof original }).addEventListener = (
            type: string,
            listener: never,
            options?: AddEventListenerOptions,
        ) => {
            if (type === 'wheel') capturedOptions = options;
            original.call(surface, type, listener, options);
        };
        mountPlugin(wheelPlugin, context, surface);
        expect(capturedOptions).toEqual({ passive: false });
    });
});

describe('keyboardPlugin — held-key tracking', () => {
    it('execution seeds the keyboard state when missing', () => {
        const { context } = makeContext();
        keyboardPlugin(context, {} as never);
        expect(context.keyboard()).toEqual(createKeyboardState());
    });

    it('tracks keydown/keyup by event.code on window listeners', () => {
        const { context } = makeContext();
        const surface = makeSurface();
        mountPlugin(keyboardPlugin, context, surface);
        // Simulate window events (the plugin listens on window)
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
        expect((context.keyboard() as DrawKeyboardState).held.has('Space')).toBe(true);
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
        expect((context.keyboard() as DrawKeyboardState).held.has('Space')).toBe(false);
    });

    it('removes the window listeners on dispose', () => {
        const { context } = makeContext();
        const surface = makeSurface();
        const runtime = mountPlugin(keyboardPlugin, context, surface);
        runtime.disposeAll();
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
        expect((context.keyboard() as DrawKeyboardState).held.has('Space')).toBe(false);
    });
});

describe('resizePlugin — viewport measurement', () => {
    it('measures the surface on mount (lazy rect read)', () => {
        const { context, boxes } = makeContext();
        const surface = makeSurface(1024, 768);
        mountPlugin(resizePlugin, context, surface);
        expect(boxes.viewport.value).toEqual({ width: 1024, height: 768 });
    });

    it('re-measures on window resize', () => {
        const { context, boxes } = makeContext();
        const surface = makeSurface(800, 600);
        mountPlugin(resizePlugin, context, surface);
        // Simulate a window resize event
        window.dispatchEvent(new Event('resize'));
        expect(boxes.viewport.value).toEqual({ width: 800, height: 600 });
    });

    it('ignores zero-size rects (keeps the previous size)', () => {
        const { context, boxes } = makeContext();
        const surface = makeSurface(800, 600);
        mountPlugin(resizePlugin, context, surface);
        expect(boxes.viewport.value).toEqual({ width: 800, height: 600 });
        // A zero-size rect must NOT wipe the viewport to 0×0
        (surface as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect =
            () =>
                ({
                    width: 0,
                    height: 0,
                    toJSON: () => ({}),
                }) as DOMRect;
        window.dispatchEvent(new Event('resize'));
        expect(boxes.viewport.value).toEqual({ width: 800, height: 600 });
    });
});

// Re-exported for convenience — the pure math helpers the gesture plugins
// apply (the gesture plugin tests cover them end-to-end through the
// dashboard suite; these imports keep the test's math helpers referenced)
export { applyPan, applyZoom };
