// ─────────────────────────────────────────────────────────────────────────────
// DrawPlugin — the plugin contract for the Draw Dashboard.
//
// PLUGIN ARCHITECTURE (user contract: "everything should be a plugin,
// including the canvas, the coordinate display on the left and the zoom
// display on the right. Every plugin should be a stand alone function that
// the Draw Dashboard can execute again to render out the UI as well as
// their functionality on the UI itself"):
//
// A plugin is a STANDALONE FUNCTION. The dashboard (the host) executes it
// on every render pass. A plugin receives:
//   - `context` — the shared services provided by the host (see
//     DrawPluginContext in ./DrawPluginContext.ts): the transform state
//     handle, the pointer state handle, the keyboard state handle, the
//     canvas surface element reference, viewport size, palette tokens and
//     the host's own render trigger.
//   - `api` — the plugin registry API (see DrawPluginApi in
//     ./DrawPluginApi.ts): `register`/`remove` for plugin lifecycle and
//     `usePermanent` for declaring non-removable (core) plugins.
//
// EXECUTION MODEL: the host calls every plugin function on EVERY render of
// the dashboard (idempotent re-execution). Rendering plugins return the
// React node they want mounted; the host collects the returned nodes and
// renders them inside the canvas surface. Event-binding plugins use the
// `onMount` slot: the host invokes every registered `onMount` exactly once
// per mount cycle (in a React effect), passing the live canvas surface
// element; the returned disposer is called on unmount / plugin removal.
//
// CORE vs REMOVABLE (user contract: "figure out which can be a removeable
// plugin and which cannot"):
// - NON-REMOVABLE (fundamental building blocks the dashboard cannot work
//   without — they ARE the interaction substrate every other plugin builds
//   on): pointer press/move/release tracking, wheel input normalization,
//   keyboard state tracking, viewport resize measurement, the transform
//   store itself. Without these the canvas has no pan/zoom state and no
//   input stream — removing them breaks every other plugin. They are
//   registered through `api.usePermanent` and are invisible to `remove`.
// - REMOVABLE (presentation/feature layers): the grid renderer, the
//   coordinate HUD, the zoom HUD, the reset-view control, drag-to-pan
//   gesture wiring, horizontal-wheel pan, the floating title. Removing any
//   of these degrades the UX but the dashboard keeps functioning.
// ─────────────────────────────────────────────────────────────────────────────

import type { DrawPluginContext } from './DrawPluginContext';
import type { DrawPluginApi } from './DrawPluginApi';

// The plugin node a rendering plugin returns. `null` = render nothing
// (pure behavior plugins return null).
export type DrawPluginNode = React.ReactNode;

// The plugin function itself — a standalone function the host executes on
// every render. Synchronous. Must be idempotent: re-execution must produce
// the same output for the same context state (the host re-executes on every
// render pass to pick up context changes).
export type DrawPlugin = (context: DrawPluginContext, api: DrawPluginApi) => DrawPluginNode;

// Plugin identity — every plugin carries a unique id so the registry can
// address it for removal and duplicate protection.
export type DrawPluginId = string;
