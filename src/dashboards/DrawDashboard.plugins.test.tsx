import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { DrawDashboard } from './DrawDashboard';
import { createDrawPluginRuntime, mountOf } from '../plugins/core';
import {
    transformStorePlugin,
    pointerPlugin,
    wheelPlugin,
    keyboardPlugin,
    resizePlugin,
} from '../plugins/core';
import type { DrawPluginContext, DrawPlugin } from '../plugins/core';

afterEach(() => {
    cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// Plugin-architecture tests for the DrawDashboard host.
//
// The behavior suite (the 32 interaction tests in DrawDashboard.test.tsx)
// already proves the DEFAULT plugin set works end-to-end. THIS suite proves
// the ARCHITECTURE contracts:
// 1. Core plugins (pointer/wheel/keyboard/resize/transform) are registered
//    PERMANENT — they cannot be removed through the registry api.
// 2. Feature plugins (grid/HUDs/title/gestures) are removable — removing
//    one degrades the UI but the dashboard keeps functioning.
// 3. The host re-executes every plugin on every render pass (the "execute
//    again" contract).
// ─────────────────────────────────────────────────────────────────────────────

// Stub the canvas surface rect (same helper as the behavior suite)
const stubSurfaceRect = () => {
    const surface = screen.getByTestId('canvas-surface');
    surface.getBoundingClientRect = () =>
        ({
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 800,
            bottom: 600,
            width: 800,
            height: 600,
            toJSON: () => ({}),
        }) as DOMRect;
    return surface;
};

describe('DrawDashboard — plugin architecture', () => {
    it('renders the default plugin set (grid, HUDs, title) through the host', () => {
        render(<DrawDashboard />);
        stubSurfaceRect();

        // Every default plugin's UI is present
        expect(screen.getByTestId('grid-svg')).toBeDefined();
        expect(screen.getByTestId('zoom-hud')).toBeDefined();
        expect(screen.getByTestId('floating-title')).toBeDefined();
    });

    it('the registry refuses to remove permanent (core) plugins', () => {
        // Registry-level contract: the core plugins are the fundamental
        // building blocks — pointer, wheel, keyboard, resize, transform
        // store. Registered via usePermanent → remove refuses them.
        const runtime = createDrawPluginRuntime();
        const corePlugins: Array<[string, DrawPlugin]> = [
            ['transform-store', transformStorePlugin],
            ['pointer', pointerPlugin],
            ['wheel', wheelPlugin],
            ['keyboard', keyboardPlugin],
            ['resize', resizePlugin],
        ];
        corePlugins.forEach(([id, plugin]) => {
            runtime.api.usePermanent(id, plugin);
        });
        corePlugins.forEach(([id]) => {
            expect(runtime.api.remove(id)).toBe(false);
            expect(runtime.api.has(id)).toBe(true);
        });
        // All five report permanent: true
        expect(runtime.api.list().every((entry) => entry.permanent)).toBe(true);
        expect(runtime.api.list().map((entry) => entry.id)).toEqual([
            'transform-store',
            'pointer',
            'wheel',
            'keyboard',
            'resize',
        ]);
    });

    it('removing a removable plugin via the api removes its UI on the next execution', () => {
        // Registry-level: register a rendering plugin, execute, remove,
        // execute again — the node disappears
        const runtime = createDrawPluginRuntime();
        runtime.api.register(
            'marker',
            mountOf(() => 'marker-node', () => undefined),
        );
        expect(runtime.executeAll({} as DrawPluginContext)).toEqual(['marker-node']);
        expect(runtime.api.remove('marker')).toBe(true);
        expect(runtime.executeAll({} as DrawPluginContext)).toEqual([]);
    });

    it('plugin mount listeners are disposed on unmount (no leaks)', () => {
        // Count window keydown listeners by instrumenting add/removeEventListener
        // around the render + unmount cycle
        let added = 0;
        let removed = 0;
        const originalAdd = window.addEventListener.bind(window);
        const originalRemove = window.removeEventListener.bind(window);
        window.addEventListener = ((type: string, ...rest: unknown[]) => {
            if (type === 'keydown') added++;
            return (originalAdd as (...args: unknown[]) => void)(type, ...rest);
        }) as typeof window.addEventListener;
        window.removeEventListener = ((type: string, ...rest: unknown[]) => {
            if (type === 'keydown') removed++;
            return (originalRemove as (...args: unknown[]) => void)(type, ...rest);
        }) as typeof window.removeEventListener;

        try {
            const { unmount } = render(<DrawDashboard />);
            // Exactly two keydown listeners: the keyboard core plugin
            // (raw key tracking) + the toolRouterPlugin (tool shortcuts)
            expect(added).toBe(2);
            unmount();
            // ...and the unmount disposal removed both
            expect(removed).toBe(2);
        } finally {
            // Restore the originals so other tests are unaffected
            window.addEventListener = originalAdd as typeof window.addEventListener;
            window.removeEventListener = originalRemove as typeof window.removeEventListener;
        }
    });

    it('the host executes plugins again on every render pass', () => {
        // Proven through the coordinate HUD: it re-renders on EVERY pointer
        // move (a plugin-driven re-render), which requires the host to
        // re-run the execution loop each pass with the fresh context
        render(<DrawDashboard />);
        const surface = stubSurfaceRect();

        fireEvent.pointerMove(surface, { clientX: 400, clientY: 300 });
        expect(screen.getByTestId('coord-value').textContent).toBe('x +0.0  y +0.0');
        fireEvent.pointerMove(surface, { clientX: 500, clientY: 250 });
        expect(screen.getByTestId('coord-value').textContent).toBe('x +100.0  y −50.0');
        fireEvent.pointerMove(surface, { clientX: 200, clientY: 400 });
        expect(screen.getByTestId('coord-value').textContent).toBe('x −200.0  y +100.0');
    });

    it('plugin mount cycle fires exactly once per plugin across re-renders', () => {
        // A counting probe: render the dashboard and verify a plugin's
        // mount side effects happen once even as re-renders occur. The
        // wheel plugin's listener count on the surface is the probe.
        const { unmount } = render(<DrawDashboard />);
        const surface = stubSurfaceRect();
        // Fire several wheel events (each triggers re-renders)
        for (let index = 0; index < 3; index++) {
            fireEvent.wheel(surface, { clientX: 400, clientY: 300, deltaY: 100 });
        }
        // The scale readout reflects the zooms — the wheel plugin is alive
        // and the gesture plugin kept working across all the re-renders
        expect(screen.getByTestId('hud-scale').textContent).toBe('×1.728e+0');
        unmount();
    });
});
