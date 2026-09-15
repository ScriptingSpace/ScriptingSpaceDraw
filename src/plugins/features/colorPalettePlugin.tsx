// ─────────────────────────────────────────────────────────────────────────────
// REMOVABLE feature plugin: COLOR PALETTE — right-side stroke color panel.
//
// USER CONTRACT ("when a tool is selected, on the right side should have a
// color palette for me to choose color"):
// - Visible ONLY while a tool is armed (activeTool ≠ null) — returns null
//   otherwise. Toggling a tool re-executes every plugin (the host's
//   execution loop), so the panel appears/disappears with the tool state.
// - COLOR-AGNOSTIC: one swatch per context.palette.swatches entry (the
//   swatch list flows through the context palette — same decoupling as the
//   toolbar reads tools through context.tools). The plugin hardcodes zero
//   hex values.
// - Click a swatch → context.drawing({ ...state, color }) — the host's
//   drawing write wrapper triggers a re-render, and TOOL plugins stamp the
//   new ink onto subsequent drafts (cross-reference: shapeToolPlugins.ts,
//   nodeEditorPlugin.tsx — each committed shape keeps its creation-time
//   color; later swatch changes don't repaint old shapes).
// - The ACTIVE swatch (== context.drawing().color) gets the accent ring.
//   The default ink is the palette accent (createDrawingState seed).
//
// INTERACTION GATES: the wrapper carries `data-hud` — a pointerdown
// starting inside it never begins a tool drag (toolRouterPlugin's
// `[data-hud]` target check) and never records a pan drag (the pointer
// core plugin skips data-hud targets — same pattern as toolbarPlugin).
// pointerEvents: auto — the swatches are clickable.
//
// REMOVABLE: removing it hides the palette; the active ink stays whatever
// it was and committed shapes keep their stamped colors.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { styledComponent } from '@presource/react';
import { mountOf } from '../core/DrawPluginRegistry';
import type { DrawPlugin, DrawPluginContext } from '../core';

// The right-side panel — vertically centered, floating over the canvas edge.
// Same translucent-well treatment as the toolbar bar (rgba of PALETTE_WELL
// at 0.85) so drawings show through underneath.
const PalettePanel = styledComponent('div', {
    position: 'absolute' as const,
    top: '50%',
    right: 16,
    transform: 'translateY(-50%)',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 6,
    padding: '10px 8px',
    borderRadius: 10,
    background: 'rgba(26, 27, 38, 0.85)',
    border: '1px solid var(--draw-palette-border)',
    zIndex: 10,
    pointerEvents: 'auto' as const,
    userSelect: 'none' as const,
});

// The small "Color" caption — muted uppercase micro-label
const PaletteLabel = styledComponent('div', {
    color: 'var(--draw-palette-text)',
    fontSize: 10,
    letterSpacing: 1,
    lineHeight: 1,
    textTransform: 'uppercase' as const,
    marginBottom: 2,
});

// One swatch button — 24×24 ink chip. The ink itself (`swatch`), the active
// ring and the hover state are all per-instance props (function values in
// the styledComponent input; same isolated-state pattern as the toolbar's
// ToolButtonInstance so hovering one swatch doesn't re-render the panel).
const Swatch = styledComponent<{ swatch: string; active: boolean; hovered: boolean }>(
    'button',
    {
        width: 24,
        height: 24,
        padding: 0,
        borderRadius: 6,
        // Constant 2px border in BOTH states — selecting never shifts layout;
        // inactive swatches carry a transparent ring
        border: ({ active }) =>
            active ? '2px solid var(--draw-palette-accent)' : '2px solid transparent',
        // The ink — the swatch's own hex color
        background: ({ swatch }) => swatch,
        // Hover halo (only when not already ringed — avoids double-ring)
        boxShadow: ({ hovered, active }) =>
            hovered && !active ? '0 0 0 2px var(--draw-palette-hover-ring)' : 'none',
        cursor: 'pointer',
    },
) as unknown as React.FC<
    { swatch: string; active: boolean; hovered: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>
>;

// One swatch with its own hover state — styledComponent has no nested
// selectors, so per-instance hovers ride React state (the toolbar's
// ToolButtonInstance pattern)
const SwatchInstance = ({
    swatch,
    active,
    onSelect,
}: {
    swatch: string;
    active: boolean;
    onSelect: () => void;
}): React.ReactElement => {
    const [hovered, setHovered] = React.useState(false);
    return (
        <Swatch
            type="button"
            swatch={swatch}
            hovered={hovered}
            active={active}
            // Tooltip + label carry the EXACT hex (deterministic test hook:
            // tests read these instead of guessing aria names)
            title={swatch}
            aria-label={`Stroke color ${swatch}`}
            aria-pressed={active}
            data-testid={`color-swatch-${swatch}`}
            onMouseOver={() => setHovered(true)}
            onMouseOut={() => setHovered(false)}
            onClick={onSelect}
        />
    );
};

// The plugin function — returns the palette node (or null when no tool is
// armed) on every execution.
export const colorPalettePlugin = mountOf(
    (context: DrawPluginContext) => {
        // CONTRACT: the palette appears only while a tool is selected
        if (context.activeTool() === null) return null;

        const drawing = context.drawing();
        // The active ink — createDrawingState seeds it, but stay defensive
        // (third-party drawing states pre-dating the field fall back to the
        // palette's primary accent)
        const current = drawing.color ?? context.palette.accent;

        return (
            // data-hud wrapper — presses inside belong to the palette
            <div data-hud="color-palette">
                <PalettePanel
                    style={{
                        ['--draw-palette-border' as never]: context.palette.border,
                        ['--draw-palette-text' as never]: context.palette.textFaint,
                        ['--draw-palette-accent' as never]: context.palette.accent,
                        ['--draw-palette-hover-ring' as never]: context.palette.surfaceHover,
                    }}
                    data-testid="color-palette"
                >
                    <PaletteLabel>Color</PaletteLabel>
                    {/* One swatch per palette token — zero color knowledge
                        here; the swatch list flows through the context */}
                    {context.palette.swatches.map((swatch) => (
                        <SwatchInstance
                            key={swatch}
                            swatch={swatch}
                            active={current === swatch}
                            onSelect={() => {
                                // Select the ink: write it into the drawing
                                // state (the host's drawing write wrapper
                                // triggers a re-render — subsequent tool
                                // drags stamp this color onto their drafts)
                                context.drawing({ ...context.drawing(), color: swatch });
                            }}
                        />
                    ))}
                </PalettePanel>
            </div>
        );
    },
    // Mount slot: nothing to wire — pure render plugin
    () => undefined,
) satisfies DrawPlugin;
