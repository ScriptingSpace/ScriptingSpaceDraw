// Barrel — the CORE (non-removable) plugins.
//
// These are the fundamental building blocks the dashboard cannot function
// without (user contract): pointer press/move/release, wheel input,
// keyboard state, viewport measurement, and the transform store. They are
// registered through `api.usePermanent` by the host, making them immune to
// `api.remove`.
//
// Everything user-facing (grid, HUDs, gestures, title) lives in
// ../features/ as REMOVABLE plugins.
export * from './DrawPlugin';
export * from './DrawPluginApi';
export * from './DrawPluginContext';
export * from './DrawPluginRegistry';
export * from './DrawToolRegistry';
export * from './transformStorePlugin';
export * from './pointerPlugin';
export * from './wheelPlugin';
export * from './keyboardPlugin';
export * from './resizePlugin';
