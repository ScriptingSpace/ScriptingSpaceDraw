// ─────────────────────────────────────────────────────────────────────────────
// Core plugin: KEYBOARD — raw keyboard press/release tracking.
//
// NON-REMOVABLE (fundamental building block): keyboard state (space held,
// modifier keys, future tool shortcuts) is part of the dashboard's input
// substrate. Gesture plugins read the held-key set — this plugin only
// tracks it, never interprets it.
//
// Tracks `event.code` (physical key — layout independent) in a Set:
// keydown adds, keyup deletes. Listeners attach to WINDOW (keyboard is
// global input — the user may hold space while the pointer is over the
// canvas, which is exactly the space+drag contract) and are removed on
// dispose.
//
// Writes are ref-backed (no re-render) — gesture plugins consult the set
// synchronously inside their own event handlers.
// ─────────────────────────────────────────────────────────────────────────────

import { mountOf } from '../core/DrawPluginRegistry';
import { createKeyboardState } from '../core/DrawPluginContext';
import type { DrawPlugin, DrawPluginContext, DrawKeyboardState } from '../core';

// The plugin function — renders nothing; all work is in the mount slot.
export const keyboardPlugin = mountOf(
    // Execution: ensure the keyboard state object exists
    (context: DrawPluginContext) => {
        if (!context.keyboard()) {
            context.keyboard(createKeyboardState());
        }
        return null;
    },
    // Mount: attach window-level keydown/keyup listeners. The context is
    // passed by the runtime's mount cycle — captured here in the closure.
    (surface: HTMLDivElement, context: DrawPluginContext) => {
        // The held set is MUTATED in place (the handle wraps a stable
        // object) — plugins read context.keyboard().held synchronously.
        const state = context.keyboard() as DrawKeyboardState;

        const handleKeyDown = (event: KeyboardEvent) => {
            state.held.add(event.code);
        };
        const handleKeyUp = (event: KeyboardEvent) => {
            state.held.delete(event.code);
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        // Disposer — detach both listeners
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    },
) satisfies DrawPlugin;
