// ─────────────────────────────────────────────────────────────────────────────
// DrawPluginApi — the registry handle the host passes to every plugin
// execution. A plugin uses it to register other plugins (plugin compounds),
// declare itself non-removable, or remove removable plugins.
//
// PERMANENT vs REMOVABLE: `usePermanent` marks plugins as fundamental
// building blocks (pointer/wheel/keyboard/resize/transform — the substrate
// the dashboard cannot function without). Permanent plugins:
// - are registered through the SAME registry (uniform execution model) but
//   are INVISIBLE to `remove` (attempting to remove one is a silent no-op —
//   the registry returns false).
// - `list` still reports them (with `permanent: true`) so debugging/inspection
//   can see the full active set.
// ─────────────────────────────────────────────────────────────────────────────

import type { DrawPlugin, DrawPluginId } from './DrawPlugin';

// Registry entry — the plugin function + its metadata
export type DrawPluginEntry = {
    id: DrawPluginId;
    plugin: DrawPlugin;
    // True for core/fundamental plugins (non-removable)
    permanent: boolean;
};

// The api bundle handed to each plugin execution
export type DrawPluginApi = {
    // Registers a plugin under a unique id. Duplicate ids are rejected
    // (returns false, existing plugin kept) — id collision is a programmer
    // error, not an overwrite.
    register: (id: DrawPluginId, plugin: DrawPlugin) => boolean;
    // Declares this plugin NON-REMOVABLE (fundamental building block). The
    // plugin is registered AND flagged permanent in one call. Call during
    // plugin execution (the host re-applies permanence on re-execution so
    // the flag survives registry rebuilds).
    usePermanent: (id: DrawPluginId, plugin: DrawPlugin) => boolean;
    // Removes a REMOVABLE plugin by id. Permanent plugins cannot be removed
    // (returns false). Returns true when the plugin was found and removed.
    remove: (id: DrawPluginId) => boolean;
    // Lists the currently registered plugins (id + permanence). Read-only
    // snapshot for inspection.
    list: () => Array<{ id: DrawPluginId; permanent: boolean }>;
    // Whether a plugin id is currently registered.
    has: (id: DrawPluginId) => boolean;
};

// Registry snapshot shape returned by `list` — exported for tests
export type DrawPluginListEntry = { id: DrawPluginId; permanent: boolean };
