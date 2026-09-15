// Barrel — the plugin system.
//
// core/  — the plugin contract (DrawPlugin, DrawPluginContext, registry)
//          + the NON-REMOVABLE fundamental plugins
// features/ — the REMOVABLE feature plugins (grid, HUDs, gestures, title)
export * from './core';
export * from './features';
