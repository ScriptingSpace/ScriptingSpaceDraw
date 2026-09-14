import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Matches the vitest setup used by every sibling distribution package
// (template, comfy-dashboard, maths, english, ScribbleScribble):
// jsdom + globals + src glob.

// Same define as vite.config.ts: vitest.config.ts takes precedence over
// vite.config.ts, so without this the __APP_VERSION__ constant (footer
// version display) would be undefined inside tests.
const pkg = JSON.parse(
    readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string };

export default defineConfig({
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
        passWithNoTests: true,
    },
});
