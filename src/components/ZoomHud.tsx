import React from 'react';
import { styledComponent } from '@presource/react';
import { formatExponent } from '../functions/canvasTransform';
import type { CanvasTransform } from '../functions/canvasTransform';

// ─────────────────────────────────────────────────────────────────────────────
// ZoomHud — the floating zoom readout (bottom-right of the canvas).
//
// Shows the current scale in scientific notation ("×1.200e+0") — REQUIRED
// format because the scale spans ~600 orders of magnitude (see
// formatExponent in ../functions/canvasTransform.ts; fixed notation would
// produce 300-digit strings at the float edge).
//
// Also renders a "Reset view" button that snaps back to the initial
// transform (origin centered, scale 1).
// ─────────────────────────────────────────────────────────────────────────────

// Floating pill anchored to the bottom-right of the canvas area
const HudPanel = styledComponent('div', {
    position: 'absolute' as const,
    right: 16,
    bottom: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '6px 12px',
    borderRadius: 8,
    background: 'rgba(26, 27, 38, 0.85)',
    border: '1px solid var(--draw-hud-border)',
    zIndex: 10,
    pointerEvents: 'auto' as const,
    userSelect: 'none' as const,
});

// The scale readout — monospace so digits don't jitter while zooming
const HudScale = styledComponent('span', {
    fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
    fontSize: 12,
    color: 'var(--draw-hud-text)',
    minWidth: 96,
    textAlign: 'right' as const,
});

// Reset button — subtle until hovered (per-instance hover via a `hovered`
// prop; styledComponent has no nested-selector support — same pattern as
// the Scribble dashboard's TabOverflowRow)
const HudResetButton = styledComponent<{ hovered: boolean }>(
    'button',
    {
        padding: '2px 8px',
        fontSize: 11,
        fontFamily: 'inherit',
        borderRadius: 6,
        border: '1px solid var(--draw-hud-border)',
        background: ({ hovered }) => (hovered ? 'var(--draw-hud-hover)' : 'transparent'),
        color: ({ hovered }) => (hovered ? 'var(--draw-hud-text-bright)' : 'var(--draw-hud-text)'),
        cursor: 'pointer',
    },
    // Standard button attributes passthrough
) as unknown as React.FC<
    { hovered: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>
>;

// One HUD instance with its own hover state (isolated so hovering the button
// doesn't re-render the scale readout's subtree)
const ResetButton = ({ onReset }: { onReset: () => void }): React.ReactElement => {
    const [hovered, setHovered] = React.useState(false);
    return (
        <HudResetButton
            type="button"
            hovered={hovered}
            onMouseOver={() => setHovered(true)}
            onMouseOut={() => setHovered(false)}
            onClick={onReset}
            data-testid="hud-reset"
        >
            Reset view
        </HudResetButton>
    );
};

export const ZoomHud = ({
    transform,
    onReset,
    colors,
}: {
    transform: CanvasTransform;
    onReset: () => void;
    // Palette tokens for the HUD surface — injected as CSS custom properties
    // on the panel so the styled rules stay palette-agnostic
    colors: { border: string; text: string; textBright: string; hover: string };
}): React.ReactElement => (
    <HudPanel
        style={{
            ['--draw-hud-border' as never]: colors.border,
            ['--draw-hud-text' as never]: colors.text,
            ['--draw-hud-text-bright' as never]: colors.textBright,
            ['--draw-hud-hover' as never]: colors.hover,
        }}
        data-testid="zoom-hud"
    >
        <HudScale data-testid="hud-scale">{formatExponent(transform.scale)}</HudScale>
        <ResetButton onReset={onReset} />
    </HudPanel>
);
