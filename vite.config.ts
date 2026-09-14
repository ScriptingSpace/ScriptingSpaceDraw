import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Read the package version at config time (raw fs read instead of a JSON
// import so tsconfig does not need resolveJsonModule for the config file).
// It is injected into the app bundle via `define` below so the dashboard
// footer can display it on the GitHub Pages deploy without bundling the
// whole package.json into the client.
const pkg = JSON.parse(
    readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string };

// Relative base so the built bundle works on GitHub Pages / any sub-path host
// (same pattern as the sibling ScriptingSpace packages, e.g.
// distribution/ScriptingSpaceScribble/vite.config.ts).
export default defineConfig({
    plugins: [react()],
    base: './',
    define: {
        // Compile-time constant — replaced with the literal version string
        // (e.g. "1.0.0") in both dev and build output
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
    build: {
        outDir: 'dist',
    },
});
