// ─────────────────────────────────────────────────────────────────────────────
// REMOVABLE feature plugin: COLOR PALETTE — right-side recency blocks + color
// wheel.
//
// USER CONTRACT ("update the palette on the right. It lists the last color
// used in 10 blocks, the last block opens a color wheel to choose whatever
// color we want. By default, set the most common color, like red, blue,
// green…"):
//
// - THE 10 BLOCKS: blocks 1–9 are the RECENCY LEDGER
//   (DrawDrawingState.recentColors — most-recent-first, capped at
//   DRAW_MAX_RECENT_COLORS = 9); the 10th block is the CUSTOM COLOR
//   WHEEL — always the LAST block, it never holds a recent entry. Every
//   selection (a swatch click or a wheel pick) flows through ONE writer
//   (selectInk below): it stamps the ink into the drawing state AND
//   re-surfaces the color at the front of the ledger via pushRecentColor
//   (pure — cross-reference: ../../functions/palette.ts). The oldest entry
//   falls off past the 9-block cap.
// - THE DEFAULT (no user pick yet): createDrawingState seeds the ledger
//   with the MOST COMMON colors in rainbow order
//   (DRAW_DEFAULT_RECENT_COLORS — red, orange, yellow, green, cyan, blue,
//   purple, pink, white) and the ink with the blue accent.
// - COLOR-AGNOSTIC: the plugin hardcodes zero ink hexes — the ledger flows
//   through the drawing state, the fallback seed through
//   context.palette.swatches (same decoupling as the toolbar reads tools
//   through context.tools).
// - Click a swatch / pick a wheel color → selectInk(color) →
//   context.drawing({ ...state, color, recentColors }) — the host's
//   drawing write wrapper triggers a re-render, and TOOL plugins stamp the
//   new ink onto subsequent drafts (cross-reference: shapeToolPlugins.ts,
//   nodeEditorPlugin.tsx — each committed shape keeps its creation-time
//   color; later selections don't repaint old shapes).
// - The ACTIVE block (== context.drawing().color) gets the accent ring.
//   The default ink is the palette accent (createDrawingState seed).
//   A custom wheel ink never rings a swatch block — it sits on top of the
//   ledger as the first block (handle still reads the ring).
//
// THE WHEEL (10th block): a real <label> wrapping a conic-rainbow chip and
// a hidden native <input type="color"> that covers the whole block —
// opacity 0, NOT visibility:hidden, so the element stays hit-testable and
// any click anywhere on the chip opens the browser's color-wheel dialog.
// The input's change event feeds selectInk with the picked hex.
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
import { DRAW_MAX_RECENT_COLORS, pushRecentColor } from '../../functions/palette';

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

// One recency block — 24×24 ink chip. The ink itself (`swatch`), the active
// ring and the hover state are all per-instance props (function values in
// the styledComponent input; same isolated-state pattern as the toolbar's
// ToolButtonInstance so hovering one block doesn't re-render the panel).
const Swatch = styledComponent<{ swatch: string; active: boolean; hovered: boolean }>(
    'button',
    {
        width: 24,
        height: 24,
        padding: 0,
        borderRadius: 6,
        // Constant 2px border in BOTH states — selecting never shifts layout;
        // inactive blocks carry a transparent ring
        border: ({ active }) =>
            active ? '2px solid var(--draw-palette-accent)' : '2px solid transparent',
        // The ink — the block's own hex color
        background: ({ swatch }) => swatch,
        // Hover halo (only when not already ringed — avoids double-ring)
        boxShadow: ({ hovered, active }) =>
            hovered && !active ? '0 0 0 2px var(--draw-palette-hover-ring)' : 'none',
        cursor: 'pointer',
    },
) as unknown as React.FC<
    { swatch: string; active: boolean; hovered: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>
>;

// One recency block with its own hover state — styledComponent has no nested
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

// The wheel block — the 10th slot. A real <label> so a click anywhere on it
// forwards the activation to the inner input (label-forwarded clicks count
// as the user gesture that opens the native color-wheel dialog).
const WheelBlock = styledComponent<{ hovered: boolean }>(
    'label',
    {
        position: 'relative' as const,
        display: 'block' as const,
        width: 24,
        height: 24,
        cursor: 'pointer',
    },
) as unknown as React.FC<
    { hovered: boolean } & React.LabelHTMLAttributes<HTMLLabelElement>
>;

// The wheel chip — the conic rainbow ring. Pinned to the SAME geometry as a
// recency block (24×24, 6px radius, constant 2px transparent border) so the
// column lines up exactly; the prism gradient (pure CSS colors, palette-
// agnostic) signals "pick any color".
const WHEEL_GRADIENT =
    'conic-gradient(from 0deg, #f7768e, #ff9e64, #e0af68, #9ece6a, #7dcfff, #7aa2f7, #bb9af7, #ff007c, #f7768e)';

const WheelChip = styledComponent<{ hovered: boolean }>(
    'span',
    {
        display: 'block' as const,
        width: 24,
        height: 24,
        boxSizing: 'border-box' as const,
        borderRadius: 6,
        border: '2px solid transparent',
        background: WHEEL_GRADIENT,
        // Hover halo — the same treatment the recency blocks get
        boxShadow: ({ hovered }) =>
            hovered ? '0 0 0 2px var(--draw-palette-hover-ring)' : 'none',
    },
) as unknown as React.FC<
    { hovered: boolean } & React.HTMLAttributes<HTMLSpanElement>
>;

// The hidden native control — an absolute overlay that covers the whole
// block. opacity 0 (NOT visibility:hidden / display:none — those remove the
// element from hit-testing) so every click lands on the input and opens the
// color-wheel dialog.
const WheelInput = styledComponent(
    'input',
    {
        position: 'absolute' as const,
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        opacity: 0,
        margin: 0,
        padding: 0,
        border: 0,
        cursor: 'pointer',
    },
) as unknown as React.FC<React.InputHTMLAttributes<HTMLInputElement>>;

// One wheel block with its own hover state (same isolated pattern as
// SwatchInstance so hovering the wheel doesn't re-render the panel)
const WheelInstance = ({
    seed,
    onPick,
}: {
    // The hex the native dialog opens pre-tuned to (the current ink when it
    // is a plain rgb hex)
    seed: string;
    onPick: (hex: string) => void;
}): React.ReactElement => {
    const [hovered, setHovered] = React.useState(false);
    return (
        <WheelBlock
            hovered={hovered}
            title="Pick any color"
            data-testid="color-wheel"
            onMouseOver={() => setHovered(true)}
            onMouseOut={() => setHovered(false)}
        >
            {/* aria-hidden — the chip is purely decorational; the input
                below carries the accessibility label */}
            <WheelChip hovered={hovered} aria-hidden="true" />
            <WheelInput
                type="color"
                value={seed}
                aria-label="Custom color wheel"
                data-testid="color-wheel-input"
                onChange={(event) => onPick(event.currentTarget.value)}
            />
        </WheelBlock>
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
        // The recency ledger (most-recent-first). Defensive default for
        // third-party drawing states pre-dating the field: fall back to the
        // palette's default recency seed (the most common colors).
        const recents = (
            drawing.recentColors ?? context.palette.swatches.slice(0, DRAW_MAX_RECENT_COLORS)
        ).slice(0, DRAW_MAX_RECENT_COLORS);

        // The ONE write path for an ink selection (recency-block click OR
        // color-wheel pick): stamp the active ink into the drawing state AND
        // surface the color at the front of the ledger (pushRecentColor
        // dedupes + evicts the oldest past the 9-block cap).
        const selectInk = (color: string) => {
            const state = context.drawing();
            context.drawing({
                ...state,
                color,
                recentColors: pushRecentColor(state.recentColors ?? [], color),
            });
        };

        // The wheel's seed hex — the native dialog opens pre-tuned to the
        // current ink WHEN it is a plain lowercase rgb hex; shorthand or
        // uppercase hex can break the native control, so fall back to the
        // palette accent.
        const wheelSeed = /^#[0-9a-f]{6}$/.test(current.toLowerCase())
            ? current.toLowerCase()
            : context.palette.accent;

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
                    {/* Blocks 1–9 — the recency ledger, most-recent-first.
                        Zero ink knowledge here: the ledger flows through the
                        drawing state, the seed fallback through the context */}
                    {recents.map((swatch) => (
                        <SwatchInstance
                            key={swatch}
                            swatch={swatch}
                            active={current === swatch}
                            onSelect={() => selectInk(swatch)}
                        />
                    ))}
                    {/* The 10th block — the custom color wheel, always last */}
                    <WheelInstance seed={wheelSeed} onPick={selectInk} />
                </PalettePanel>
            </div>
        );
    },
    // Mount slot: nothing to wire — pure render plugin
    () => undefined,
) satisfies DrawPlugin;
