// ─────────────────────────────────────────────────────────────────────────────
// Draw palette — Tokyo Night Storm.
//
// Same research-backed scheme as the sibling ScriptingSpace packages
// (cross-reference: distribution/ScriptingSpaceScribble/src/functions/palette.ts
// for the full rationale + contrast table; folke/tokyonight.nvim,
// extras/lua/tokyonight_storm.lua is the verified primary source).
// Imported as individual constants so each styled rule reads a named token
// instead of loose magic hex strings.
// ─────────────────────────────────────────────────────────────────────────────

// Page / app background — Tokyo Night Storm bg (blue-violet tinted)
export const PALETTE_BACKGROUND = '#24283b';
// Raised surfaces: header, footer (bg_dark — deeper than bg so panels read
// as grounded, with the canvas area lighter)
export const PALETTE_SURFACE = '#1f2335';
// Editor / content well — Night's deep bg for maximum accent pop
export const PALETTE_WELL = '#1a1b26';
// Hairline borders (bg_highlight)
export const PALETTE_BORDER = '#292e42';
// Hover / raised interactive surface
export const PALETTE_SURFACE_HOVER = '#292e42';

// PRIMARY accent — Tokyo Night blue #7aa2f7 (S 91%, L 72%). Active controls,
// focus rings, the grid's origin cross.
export const PALETTE_ACCENT = '#7aa2f7';
// Brighter blue for hover states / accent text on dark grounds (blue_bright)
export const PALETTE_ACCENT_BRIGHT = '#8db0ff';
// SECONDARY accent — purple #bb9af7 (S 77%, L 78%). Subtitle, links, info.
export const PALETTE_SECONDARY = '#bb9af7';
// TERTIARY accent — orange #ff9e64 (S 100%, L 70%). Warnings, active states.
export const PALETTE_TERTIARY = '#ff9e64';
// Cool cyan #7dcfff (S 100%, L 74%)
export const PALETTE_CYAN = '#7dcfff';
// Success green #9ece6a (S 53%, L 67%)
export const PALETTE_GREEN = '#9ece6a';
// Gold yellow #e0af68 (S 79%, L 64%) — badges
export const PALETTE_GOLD = '#e0af68';

// Text colors
export const PALETTE_TEXT_BRIGHT = '#c0caf5'; // headings, active text
export const PALETTE_TEXT_BODY = '#a9b1d6'; // default body text (fg_dark)
export const PALETTE_TEXT_MUTED = '#737aa2'; // secondary labels
export const PALETTE_TEXT_FAINT = '#565f89'; // decorative hints (comment)

// Overlay scrim (Night bg at high alpha)
export const PALETTE_SCRIM = 'rgba(26, 27, 38, 0.78)';
