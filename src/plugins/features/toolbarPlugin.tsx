// ─────────────────────────────────────────────────────────────────────────────
// REMOVABLE feature plugin: TOOLBAR — bottom-center tool bar.
//
// THE CONTRACT (user: "Add a plugin that allows tool bars at the bottom of
// the screen, centered. These will allow pen, circle, drawing tools to be
// used. The plugin itself has no tools available, as tools themselves are
// plugin."):
//
// The toolbar is TOOL-AGNOSTIC. It renders one button per tool currently
// registered in `context.tools` — it has ZERO knowledge of circle,
// rectangle, curve, or any specific tool. With zero tools registered it
// renders an EMPTY pill (the placeholder bar at the bottom center). Tool
// plugins register their definitions at execution time (tool registration
// happens during the plugin execution phase, which runs before this
// plugin's node is built — registration order in the host decides).
//
// BEHAVIOR:
// - Click a tool button → activate it (context.activeTool = tool.id).
// - Click the ACTIVE tool's button again → deactivate (activeTool = null)
//   — back to pan mode.
// - The active button is highlighted (accent border + brighter text).
// - The bar is wrapped in data-hud so canvas drag gestures ignore it (the
//   pointer core plugin's gesture gate).
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { styledComponent } from '@presource/react';
import { mountOf } from '../core/DrawPluginRegistry';
import type { DrawPlugin, DrawPluginContext } from '../core';

// The bottom-center pill — anchored with left: 50% + translateX(-50%).
// pointerEvents: auto (unlike the HUD readouts) — the buttons are clickable.
const ToolbarBar = styledComponent('div', {
    position: 'absolute' as const,
    bottom: 16,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    borderRadius: 10,
    background: 'rgba(26, 27, 38, 0.85)',
    border: '1px solid var(--draw-toolbar-border)',
    zIndex: 10,
    pointerEvents: 'auto' as const,
    userSelect: 'none' as const,
});

// One tool button — 32×32 icon button with per-instance hover + active
// states via props (styledComponent has no nested selectors — same pattern
// as ZoomHud's HudResetButton)
const ToolButton = styledComponent<{ hovered: boolean; active: boolean }>(
    'button',
    {
        width: 32,
        height: 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        borderRadius: 8,
        border: '1px solid var(--draw-toolbar-border)',
        background: ({ hovered, active }) =>
            active ? 'var(--draw-toolbar-hover)' : hovered ? 'var(--draw-toolbar-hover)' : 'transparent',
        color: ({ active }) =>
            active ? 'var(--draw-toolbar-accent)' : 'var(--draw-toolbar-text)',
        cursor: 'pointer',
    },
) as unknown as React.FC<
    { hovered: boolean; active: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>
>;

// One toolbar button with its own hover state (isolated per button so
// hovering doesn't re-render the whole bar)
const ToolButtonInstance = ({
    label,
    icon,
    active,
    onToggle,
}: {
    label: string;
    icon: string;
    active: boolean;
    onToggle: () => void;
}): React.ReactElement => {
    const [hovered, setHovered] = React.useState(false);
    return (
        <ToolButton
            type="button"
            hovered={hovered}
            active={active}
            title={label}
            aria-label={label}
            aria-pressed={active}
            onMouseOver={() => setHovered(true)}
            onMouseOut={() => setHovered(false)}
            onClick={onToggle}
            data-testid={`tool-${label.toLowerCase()}`}
        >
            {/* The icon — inline SVG path from the tool definition */}
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <path
                    d={icon}
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
        </ToolButton>
    );
};

// The plugin function — returns the toolbar node on every execution.
export const toolbarPlugin = mountOf(
    (context: DrawPluginContext) => {
        // Read the CURRENT tool list — tools registered by other plugins
        // during this execution pass are already in the registry
        const tools = context.tools.list();
        const activeTool = context.activeTool();

        return (
            // data-hud wrapper — the pointer plugin's gesture gate reads it
            // (a drag starting on the bar belongs to the bar)
            <div data-hud="toolbar">
                <ToolbarBar
                    style={{
                        ['--draw-toolbar-border' as never]: context.palette.border,
                        ['--draw-toolbar-text' as never]: context.palette.textFaint,
                        ['--draw-toolbar-accent' as never]: context.palette.accent,
                        ['--draw-toolbar-hover' as never]: context.palette.surfaceHover,
                    }}
                    data-testid="toolbar"
                >
                    {/* One button per registered tool — zero tool knowledge
                        here. Empty registry → empty pill (the placeholder
                        bar). Toggle behavior: click active → deactivate. */}
                    {tools.map((tool) => (
                        <ToolButtonInstance
                            key={tool.id}
                            label={tool.label}
                            icon={tool.icon}
                            active={activeTool === tool.id}
                            onToggle={() => {
                                // Toggle: clicking the active tool deactivates
                                // it (back to pan mode); clicking an inactive
                                // tool activates it
                                context.activeTool(
                                    context.activeTool() === tool.id ? null : tool.id,
                                );
                            }}
                        />
                    ))}
                </ToolbarBar>
            </div>
        );
    },
    // Mount slot: nothing to wire — pure render plugin
    () => undefined,
) satisfies DrawPlugin;
