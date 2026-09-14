/// <reference types="vite/client" />

// Vite client types provide ambient module declarations for asset imports
// (e.g. `import './app.css'`), which the TypeScript compiler would otherwise
// reject during `tsc --noEmit`.

// Compile-time constant injected by Vite `define` (vite.config.ts →
// __APP_VERSION__: JSON.stringify(pkg.version)). Ambient declaration keeps
// `tsc --noEmit` and the tsc lib build (tsconfig.build.json) happy; the
// runtime value only exists in Vite dev/build output.
declare const __APP_VERSION__: string;
