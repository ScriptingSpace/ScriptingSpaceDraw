import { describe, it, expect } from 'vitest';
import { createDrawPluginRuntime, mountOf } from './DrawPluginRegistry';
import type { DrawPlugin, DrawPluginContext } from './DrawPlugin';
import { createPointerState } from './DrawPluginContext';

// Test helpers — a minimal fake context. The registry never inspects the
// context; plugins receive it opaquely. Only the plugin functions below
// read from it.

const fakeContext = {
    pointer: (() => createPointerState()) as unknown as DrawPluginContext['pointer'],
} as unknown as DrawPluginContext;

// Counting plugins — record every execution so tests can assert the
// re-execution contract (the host runs every plugin on every pass)
const makeCountingPlugin = (
    log: string[],
    id: string,
    node: React.ReactNode = null,
): DrawPlugin =>
    mountOf(() => {
        log.push(id);
        return node;
    }, () => undefined);

describe('DrawPluginRegistry — registration', () => {
    it('registers removable plugins and reports them via list/has', () => {
        const runtime = createDrawPluginRuntime();
        expect(runtime.api.has('a')).toBe(false);
        expect(runtime.api.register('a', () => null)).toBe(true);
        expect(runtime.api.has('a')).toBe(true);
        expect(runtime.api.list()).toEqual([{ id: 'a', permanent: false }]);
    });

    it('rejects duplicate ids (programmer error, not an overwrite)', () => {
        const runtime = createDrawPluginRuntime();
        runtime.api.register('a', () => null);
        expect(runtime.api.register('a', () => 'other')).toBe(false);
        // The ORIGINAL plugin is kept
        expect(runtime.api.list()).toEqual([{ id: 'a', permanent: false }]);
    });

    it('usePermanent registers a plugin flagged permanent', () => {
        const runtime = createDrawPluginRuntime();
        expect(runtime.api.usePermanent('core', () => null)).toBe(true);
        expect(runtime.api.list()).toEqual([{ id: 'core', permanent: true }]);
    });

    it('usePermanent upgrades an existing removable plugin to permanent', () => {
        const runtime = createDrawPluginRuntime();
        runtime.api.register('a', () => null);
        expect(runtime.api.usePermanent('a', () => null)).toBe(true);
        expect(runtime.api.list()).toEqual([{ id: 'a', permanent: true }]);
    });

    it('preserves registration order in list (execution order contract)', () => {
        const runtime = createDrawPluginRuntime();
        runtime.api.register('b', () => null);
        runtime.api.usePermanent('a', () => null);
        runtime.api.register('c', () => null);
        expect(runtime.api.list().map((entry) => entry.id)).toEqual(['b', 'a', 'c']);
    });
});

describe('DrawPluginRegistry — removal', () => {
    it('removes a removable plugin (has flips false)', () => {
        const runtime = createDrawPluginRuntime();
        runtime.api.register('a', () => null);
        expect(runtime.api.remove('a')).toBe(true);
        expect(runtime.api.has('a')).toBe(false);
    });

    it('refuses to remove a permanent plugin (fundamental building block)', () => {
        const runtime = createDrawPluginRuntime();
        runtime.api.usePermanent('core', () => null);
        expect(runtime.api.remove('core')).toBe(false);
        expect(runtime.api.has('core')).toBe(true);
    });

    it('returns false for unknown ids', () => {
        const runtime = createDrawPluginRuntime();
        expect(runtime.api.remove('ghost')).toBe(false);
    });

    it('removing a plugin disposes its mount callback', () => {
        const runtime = createDrawPluginRuntime();
        let disposed = false;
        runtime.api.register(
            'a',
            mountOf(() => null, () => {
                return () => {
                    disposed = true;
                };
            }),
        );
        // Simulate the mount cycle
        runtime.runMountCycle({} as HTMLDivElement, fakeContext);
        expect(disposed).toBe(false);
        runtime.api.remove('a');
        expect(disposed).toBe(true);
    });
});

describe('DrawPluginRegistry — execution (the host re-executes plugins)', () => {
    it('executeAll runs every plugin function in registration order', () => {
        const runtime = createDrawPluginRuntime();
        const log: string[] = [];
        runtime.api.register('first', makeCountingPlugin(log, 'first'));
        runtime.api.usePermanent('second', makeCountingPlugin(log, 'second'));
        runtime.api.register('third', makeCountingPlugin(log, 'third'));

        const nodes = runtime.executeAll(fakeContext);
        // Execution order = registration order
        expect(log).toEqual(['first', 'second', 'third']);
        // All three returned null → three null nodes collected
        expect(nodes).toEqual([null, null, null]);
    });

    it('executeAll collects returned nodes (render plugins)', () => {
        const runtime = createDrawPluginRuntime();
        runtime.api.register('a', () => 'node-a');
        runtime.api.register('b', () => null);
        runtime.api.register('c', () => 'node-c');
        expect(runtime.executeAll(fakeContext)).toEqual(['node-a', null, 'node-c']);
    });

    it('the host can execute plugins AGAIN — each pass re-runs every plugin', () => {
        const runtime = createDrawPluginRuntime();
        const log: string[] = [];
        runtime.api.register('a', makeCountingPlugin(log, 'a'));
        runtime.executeAll(fakeContext);
        runtime.executeAll(fakeContext);
        runtime.executeAll(fakeContext);
        // Three passes → three executions of the same plugin
        expect(log).toEqual(['a', 'a', 'a']);
    });

    it('a throwing plugin is isolated — the rest still execute', () => {
        const runtime = createDrawPluginRuntime();
        const log: string[] = [];
        runtime.api.register('broken', () => {
            throw new Error('plugin exploded');
        });
        runtime.api.register('healthy', makeCountingPlugin(log, 'healthy'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const nodes = runtime.executeAll(fakeContext);
        errorSpy.mockRestore();
        // The healthy plugin still ran and returned its node; the broken
        // one contributed nothing
        expect(log).toEqual(['healthy']);
        expect(nodes).toEqual([null]);
    });
});

describe('DrawPluginRegistry — mount lifecycle', () => {
    it('runMountCycle invokes mount exactly once per plugin', () => {
        const runtime = createDrawPluginRuntime();
        let mountCount = 0;
        runtime.api.register(
            'a',
            mountOf(() => null, () => {
                mountCount++;
            }),
        );
        const surface = {} as HTMLDivElement;
        expect(runtime.runMountCycle(surface, fakeContext)).toBe(true);
        // Re-running the cycle (host re-renders) must NOT re-mount
        expect(runtime.runMountCycle(surface, fakeContext)).toBe(false);
        expect(mountCount).toBe(1);
    });

    it('plugins without a mount slot are skipped silently', () => {
        const runtime = createDrawPluginRuntime();
        runtime.api.register('plain', () => 'node');
        // No mount property — the cycle reports nothing mounted
        expect(runtime.runMountCycle({} as HTMLDivElement, fakeContext)).toBe(false);
    });

    it('disposeAll tears down every mount callback in reverse order', () => {
        const runtime = createDrawPluginRuntime();
        const log: string[] = [];
        runtime.api.register(
            'first',
            mountOf(() => null, () => () => {
                log.push('dispose-first');
            }),
        );
        runtime.api.register(
            'second',
            mountOf(() => null, () => () => {
                log.push('dispose-second');
            }),
        );
        runtime.runMountCycle({} as HTMLDivElement, fakeContext);
        runtime.disposeAll();
        // Reverse order unwind
        expect(log).toEqual(['dispose-second', 'dispose-first']);
        // After disposeAll a fresh cycle can mount again (remount support)
        expect(runtime.runMountCycle({} as HTMLDivElement, fakeContext)).toBe(true);
    });

    it('a mount callback returning nothing still registers as mounted', () => {
        const runtime = createDrawPluginRuntime();
        runtime.api.register(
            'void-mount',
            mountOf(() => null, () => undefined),
        );
        runtime.runMountCycle({} as HTMLDivElement, fakeContext);
        // Second cycle: already mounted (placeholder disposer) → skipped
        expect(runtime.runMountCycle({} as HTMLDivElement, fakeContext)).toBe(false);
    });

    it('a throwing mount is isolated and the plugin is not marked mounted', () => {
        const runtime = createDrawPluginRuntime();
        runtime.api.register(
            'broken-mount',
            mountOf(() => null, () => {
                throw new Error('mount exploded');
            }),
        );
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        expect(runtime.runMountCycle({} as HTMLDivElement, fakeContext)).toBe(false);
        errorSpy.mockRestore();
        // Not marked mounted → a later cycle retries the mount
        expect(runtime.runMountCycle({} as HTMLDivElement, fakeContext)).toBe(false);
    });
});

describe('mountOf — the standalone-function plugin composer', () => {
    it('attaches the mount slot as a function property (plugin stays a function)', () => {
        const plugin = mountOf(() => 'node', () => undefined);
        // The plugin IS a function…
        expect(typeof plugin).toBe('function');
        // …with the mount attached as a property
        expect(typeof plugin.mount).toBe('function');
        expect(plugin({} as DrawPluginContext, {} as never)).toBe('node');
    });
});
