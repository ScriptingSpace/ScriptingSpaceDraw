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
// Red #f7768e (the tokyonight red — storm flavor). Stroke swatch.
export const PALETTE_RED = '#f7768e';
// Pink / magenta #ff007c (the tokyonight magenta2 token — verified primary).
// The ninth default recency block — pink slots between purple and white so
// the default rainbow reads red → … → purple → pink → white.
export const PALETTE_PINK = '#ff007c';

// Text colors
export const PALETTE_TEXT_BRIGHT = '#c0caf5'; // headings, active text
export const PALETTE_TEXT_BODY = '#a9b1d6'; // default body text (fg_dark)
export const PALETTE_TEXT_MUTED = '#737aa2'; // secondary labels
export const PALETTE_TEXT_FAINT = '#565f89'; // decorative hints (comment)

// Overlay scrim (Night bg at high alpha)
export const PALETTE_SCRIM = 'rgba(26, 27, 38, 0.78)';

// DRAW_MAX_RECENT_COLORS — how many RECENT-ink blocks the right-side
// palette keeps (most-recent-first; the ledger lives in
// DrawDrawingState.recentColors). The panel renders this many blocks plus
// the color-wheel block → the 10-block total the palette exposes.
export const DRAW_MAX_RECENT_COLORS = 9;
// DRAW_COLOR_BLOCK_COUNT — the total swatch blocks on the right side:
// 9 recency blocks + the 10th color-wheel block.
export const DRAW_COLOR_BLOCK_COUNT = DRAW_MAX_RECENT_COLORS + 1;

// DRAW_DEFAULT_RECENT_COLORS — the DEFAULT content of the recency blocks:
// the most common drawing inks, in rainbow order (red → orange → yellow →
// green → cyan → blue → purple → pink → white). Every hex is a verified
// tokyonight storm token with AA contrast on the deep well (#1a1b26), so a
// block in ANY position is always visible. The blue accent doubles as the
// DEFAULT stroke ink (createDrawingState seed — cross-reference:
// ../plugins/core/DrawPluginContext.ts).
export const DRAW_DEFAULT_RECENT_COLORS: string[] = [
    PALETTE_RED, // #f7768e red
    PALETTE_TERTIARY, // #ff9e64 orange
    PALETTE_GOLD, // #e0af68 yellow
    PALETTE_GREEN, // #9ece6a green
    PALETTE_CYAN, // #7dcfff cyan
    PALETTE_ACCENT, // #7aa2f7 blue (the default stroke ink)
    PALETTE_SECONDARY, // #bb9af7 purple
    PALETTE_PINK, // #ff007c pink
    PALETTE_TEXT_BRIGHT, // #c0caf5 white (near-white pencil ink)
];

// Legacy alias — DRAW_COLOR_SWATCHES named the 8-block rainbow list that
// pre-dated the recency model. It aliases the default recency list so
// existing imports keep compiling (same rainbow content, +1 entry).
export const DRAW_COLOR_SWATCHES: string[] = DRAW_DEFAULT_RECENT_COLORS;

// pushRecentColor — the recency-ledger update rule for an ink SELECTION
// (swatch click OR color-wheel pick — the single write path, see
// ../plugins/features/colorPalettePlugin.tsx): the chosen hex moves to the
// FRONT, a color already listed re-surfaces at the front instead of
// duplicating, and the list keeps at most `max` entries (the OLDEST falls
// off past the cap — the 9-block recency window). Pure: returns a new
// array; the caller writes it into the drawing state. Defensive `?? []`
// so a null/third-party ledger still yields a valid single-entry list.
export const pushRecentColor = (
    colors: string[],
    color: string,
    max: number = DRAW_MAX_RECENT_COLORS,
): string[] => [color, ...(colors ?? []).filter((entry) => entry !== color)].slice(0, max);

// DrawPalette — the aggregated token bundle passed to plugins through the
// DrawPluginContext (see ../plugins/core/DrawPluginContext.ts). Plugins read
// named tokens from this object instead of importing the palette module
// directly, keeping them decoupled from the palette file itself.
export type DrawPalette = {
    background: string;
    surface: string;
    well: string;
    border: string;
    surfaceHover: string;
    accent: string;
    accentBright: string;
    secondary: string;
    tertiary: string;
    cyan: string;
    green: string;
    gold: string;
    red: string;
    textBright: string;
    textBody: string;
    textMuted: string;
    textFaint: string;
    scrim: string;
    // The DEFAULT recency blocks (the right-side panel's most-common-color
    // seed — the LIVE recency ledger flows through the drawing state:
    // DrawDrawingState.recentColors). The colorPalettePlugin reads these as
    // the defensive fallback for third-party drawing states that pre-date
    // the ledger field.
    swatches: string[];
};

// drawPalette — the singleton bundle built from the constants above (the
// values the dashboard + plugins actually consume)
export const drawPalette: DrawPalette = {
    background: PALETTE_BACKGROUND,
    surface: PALETTE_SURFACE,
    well: PALETTE_WELL,
    border: PALETTE_BORDER,
    surfaceHover: PALETTE_SURFACE_HOVER,
    accent: PALETTE_ACCENT,
    accentBright: PALETTE_ACCENT_BRIGHT,
    secondary: PALETTE_SECONDARY,
    tertiary: PALETTE_TERTIARY,
    cyan: PALETTE_CYAN,
    green: PALETTE_GREEN,
    gold: PALETTE_GOLD,
    red: PALETTE_RED,
    textBright: PALETTE_TEXT_BRIGHT,
    textBody: PALETTE_TEXT_BODY,
    textMuted: PALETTE_TEXT_MUTED,
    textFaint: PALETTE_TEXT_FAINT,
    scrim: PALETTE_SCRIM,
    swatches: DRAW_COLOR_SWATCHES,
};
