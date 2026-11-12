# Scripting Space Draw

A **plug-and-play infinite grid canvas**. The dashboard is an unbounded
pan/zoom surface: scroll the mouse wheel to zoom (infinite magnification in
both directions — the zoom is anchored at the pointer so the point under the
cursor stays put), hold **Space** (or middle-click) and drag to pan, and the
grid automatically re-levels itself so there is always a comfortable grid
visible at ANY scale.

## Deployment (GitHub Pages)

Every push to `main` automatically builds and deploys the site via
`.github/workflows/deploy-pages.yml`: `yarn install` → test → typecheck →
`vite build` (output `dist/`, relative `base: './'`) → `actions/deploy-pages`.
Manual re-deploys are available via `workflow_dispatch`.

Dependencies are pulled from npm: `@presource/core` and `@presource/react`.
`@presource/core` is published; `@presource/react` is published from the
NQQT/noobscript monorepo via its **Publish @presource packages** workflow
(Actions tab, requires the `NPM_TOKEN` secret) — the Pages deploy fails at
install until that has run once.

One-time repo setting: **Settings → Pages → Build and deployment → Source:
"GitHub Actions"**.

## npm Publishing

The package is publishable to npm as `@scripting-space/draw`:

```bash
yarn publish
```

(`prepublishOnly` runs `vitest run` → `tsc --noEmit` → `vite build`; the build
emits only the sanctioned `dist/` app bundle — no library build: the published
library **is** the TypeScript source.)

## Consuming the library

```bash
yarn add @scripting-space/draw
```

```tsx
import { DrawDashboard } from '@scripting-space/draw';
```

- **Public API = `src/index.ts`** — `main` / `module` / `types` and the `.`
  `exports` condition all name that `.ts` barrel, and `files` ships the `src/`
  tree (tests, the app entry `src/main.tsx` and its `src/app.css` excluded), so
  npm installs the sources themselves — no `lib/`, no `.mjs`/`.cjs`, no
  emitted `.d.ts`.
- Consumers compile those sources with their own bundler (Vite / webpack /
  esbuild). TypeScript consumers must use `moduleResolution: "bundler"`: the
  relative imports inside `src/` are extensionless, which `node16` / `nodenext`
  rejects per specifier (TS2834).
- `react` / `react-dom` are `peerDependencies`; `sideEffects: false` + the
  barrel keep the import tree-shakeable.
- `dist/` is the deployable GitHub Pages app build (sanctioned output), shipped
  alongside for reference — nothing in the library entry reads it.

## Development

```bash
yarn install
yarn dev        # vite dev server
yarn test       # vitest run (jsdom)
yarn typecheck  # tsc --noEmit
yarn build      # vite build → dist/ (deployable Pages app only)
```

## Architecture

- `src/functions/canvasTransform.ts` — the pure math core: one transform
  `{ x, y, scale }` maps screen ↔ canvas space; wheel zoom solves the
  zoom-at-pointer equation (`pan₂ = P/s₁ + pan₁ − P/s₂`); the grid is a
  geometric ladder of 8× spacings rooted at 64 canvas units, selected from
  `log₂` of the scale so it is valid at ANY magnification (float-edge clamps
  at ±1e300 keep arithmetic finite — ~600 orders of magnitude of travel).
- `src/components/GridLayer.tsx` — SVG grid renderer. Only lines intersecting
  the viewport are drawn (bounded DOM at any pan distance); three levels with
  a cross-fade between them; accent-colored origin cross.
- `src/components/ZoomHud.tsx` — floating scale readout (scientific notation)
  + Reset view button.
- `src/dashboards/DrawDashboard.tsx` — the shell: wheel (non-passive, so the
  browser zoom is blocked), space/middle-button drag panning, HUD, footer.
