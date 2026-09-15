// ─────────────────────────────────────────────────────────────────────────────
// DrawPluginRegistry — the plugin registry + execution engine.
//
// THE HOST CONTRACT (user contract: "every plugin should be a stand alone
// function that the Draw Dashboard can execute again to render out the UI
// as well as their functionality on the UI itself"):
//
// 1. REGISTRATION: plugins register via `register(id, fn)` (removable) or
//    `usePermanent(id, fn)` (core, non-removable). Registration is id-based;
//    duplicate ids are rejected.
//
// 2. RE-EXECUTION: `executeAll(context)` runs EVERY registered plugin
//    function with the host context, in registration order, and returns the
//    collected React nodes. The dashboard calls this on every render pass —
//    re-execution is the mechanism by which plugins both render their UI
//    and (re)wire their behavior. Plugins must be idempotent: behavior
//    wiring happens in their `onMount`-style side effects, which the host
//    invokes through the mount-cycle runner (see DrawPluginRuntime below),
//    NOT inline during execution.
//
// 3. MOUNT CYCLES: plugins that need DOM/event access export a mount
//    callback through the runtime's `mount` slot (see the core input
//    plugins). The runtime tracks which plugin ids have been mounted this
//    session; `runMountCycle(surface, context)` invokes `mount` exactly
//    once per plugin (on the first cycle after registration) and
//    `disposeAll()` tears everything down in reverse order. Removing a
//    plugin disposes just that plugin's mount callback.
//
// 4. PERMANENCE: permanent plugins are registered in the same map but
//    `remove` refuses them (returns false). This makes the fundamental
//    building blocks (pointer, wheel, keyboard, resize, transform) uniform
//    to execute but impossible to strip by user code.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import type { DrawPlugin, DrawPluginId, DrawPluginNode } from './DrawPlugin';
import type { DrawPluginApi, DrawPluginEntry, DrawPluginListEntry } from './DrawPluginApi';
import type { DrawPluginContext } from './DrawPluginContext';

// Mount callback — invoked once per plugin with the live canvas surface
// element + context. Returns a disposer (or nothing). The runtime stores
// disposers keyed by plugin id.
export type DrawPluginMount = (
    surface: HTMLDivElement,
    context: DrawPluginContext,
) => void | (() => void);

// A mount-capable plugin: the runtime reads `mount` off the object the
// plugin function returns (rendering plugins return a React node instead —
// the runtime ignores `mount` on those and vice versa).
export type DrawPluginWithMount = {
    mount: DrawPluginMount;
};

// Runtime — owns the registry + mount lifecycle. The dashboard creates ONE
// runtime per component lifetime (useReferenceHook) and drives it from its
// render + effects.
export type DrawPluginRuntime = {
    api: DrawPluginApi;
    // Execute every plugin function → collected nodes (registration order)
    executeAll: (context: DrawPluginContext) => DrawPluginNode[];
    // Run one mount cycle: invoke `mount` on every registered plugin that
    // (a) exposes one and (b) has not been mounted yet this session. The
    // surface comes from the host (the canvas element ref). Returns whether
    // any new plugin was mounted (the host can use this to trigger a
    // follow-up render pass if needed).
    runMountCycle: (surface: HTMLDivElement, context: DrawPluginContext) => boolean;
    // Dispose every active mount callback (reverse order) — full teardown
    disposeAll: () => void;
    // Dispose a single plugin's mount callback (used on plugin removal)
    disposeOne: (id: DrawPluginId) => void;
};

// createDrawPluginRuntime — the factory the dashboard calls once
export const createDrawPluginRuntime = (): DrawPluginRuntime => {
    // Ordered registry: insertion order = execution order. A plain array of
    // entries (not a Map) keeps execution deterministic and cheap to slice.
    const entries: DrawPluginEntry[] = [];

    // Active mount disposers keyed by plugin id
    const disposers = new Map<DrawPluginId, () => void>();

    // Lookup helper — linear scan (the registry holds a handful of plugins;
    // a Map index would be overhead without benefit at this scale)
    const findEntry = (id: DrawPluginId): DrawPluginEntry | undefined =>
        entries.find((entry) => entry.id === id);

    // The api object — the SAME object identity is handed to every plugin
    // execution (stable handle, safe to close over)
    const api: DrawPluginApi = {
        register: (id, plugin) => {
            // Duplicate id → reject (programmer error, not an overwrite)
            if (findEntry(id)) return false;
            entries.push({ id, plugin, permanent: false });
            return true;
        },
        usePermanent: (id, plugin) => {
            // Register + flag permanent in one call. If the plugin already
            // exists as removable, UPGRADE it to permanent (the id is the
            // identity; the host re-applies permanence on re-execution).
            const existing = findEntry(id);
            if (existing) {
                existing.permanent = true;
                existing.plugin = plugin;
                return true;
            }
            entries.push({ id, plugin, permanent: true });
            return true;
        },
        remove: (id) => {
            const index = entries.findIndex((entry) => entry.id === id);
            // Unknown id → nothing removed
            if (index === -1) return false;
            // Permanent plugins are fundamental building blocks — refuse
            if (entries[index].permanent) return false;
            // Dispose the plugin's mount callback (event listeners etc.)
            // BEFORE dropping the entry, so removal is complete + immediate
            const disposer = disposers.get(id);
            if (disposer) {
                disposer();
                disposers.delete(id);
            }
            entries.splice(index, 1);
            return true;
        },
        list: () =>
            // Snapshot — callers must not mutate the registry through it
            entries.map((entry) => ({ id: entry.id, permanent: entry.permanent })),
        has: (id) => Boolean(findEntry(id)),
    };

    // executeAll — run every plugin function with the context, collect the
    // returned nodes. A plugin that throws during execution is skipped for
    // this pass (one broken plugin must not blank the whole dashboard) —
    // the error surfaces in dev via console.error.
    const executeAll = (context: DrawPluginContext): DrawPluginNode[] => {
        const nodes: DrawPluginNode[] = [];
        entries.forEach((entry) => {
            try {
                nodes.push(entry.plugin(context, api));
            } catch (error) {
                // Isolate plugin failures: log + continue with the rest
                console.error(`[DrawDashboard] plugin "${entry.id}" failed:`, error);
            }
        });
        return nodes;
    };

    // runMountCycle — invoke `mount` on every registered plugin that exposes
    // one and has not been mounted yet. Mounted ids are tracked so re-running
    // the cycle (host re-renders) is a no-op for already-mounted plugins.
    const runMountCycle = (surface: HTMLDivElement, context: DrawPluginContext): boolean => {
        let mountedAny = false;
        entries.forEach((entry) => {
            if (disposers.has(entry.id)) return; // already mounted
            // Probe the plugin for a mount slot: a plugin function may
            // carry `mount` as a property (function-property pattern) —
            // this keeps "a plugin is a standalone function" literally true.
            const mount = (entry.plugin as DrawPlugin & Partial<DrawPluginWithMount>).mount;
            if (typeof mount !== 'function') return;
            try {
                const disposer = mount(surface, context);
                if (typeof disposer === 'function') disposers.set(entry.id, disposer);
                else disposers.set(entry.id, () => undefined); // placeholder so has() works
                mountedAny = true;
            } catch (error) {
                console.error(`[DrawDashboard] plugin "${entry.id}" mount failed:`, error);
            }
        });
        return mountedAny;
    };

    // disposeAll — full teardown in REVERSE registration order (unwind
    // semantics: later plugins may depend on earlier ones' listeners)
    const disposeAll = () => {
        Array.from(disposers.keys())
            .reverse()
            .forEach((id) => {
                const disposer = disposers.get(id);
                if (disposer) disposer();
            });
        disposers.clear();
    };

    // disposeOne — single-plugin teardown (the removal path already calls
    // this via api.remove; exposed for the host's unmount effect too)
    const disposeOne = (id: DrawPluginId) => {
        const disposer = disposers.get(id);
        if (disposer) {
            disposer();
            disposers.delete(id);
        }
    };

    return { api, executeAll, runMountCycle, disposeAll, disposeOne };
};

// mountOf — helper for declaring a plugin function WITH a mount slot in one
// expression (attaches the mount callback as a function property, keeping
// the plugin a single standalone function):
//
//   export const wheelPlugin = mountOf((context, api) => { ...render... }, (surface, context) => { ...wire events... });
//
export const mountOf = (
    plugin: DrawPlugin,
    mount: DrawPluginMount,
): DrawPlugin & DrawPluginWithMount => {
    const composed = plugin as DrawPlugin & DrawPluginWithMount;
    composed.mount = mount;
    return composed;
};

// Re-export the node type so the runtime module is the single import point
// for the host's render collection
export type { DrawPluginNode };
