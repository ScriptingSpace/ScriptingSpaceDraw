import { describe, it, expect } from 'vitest';
import {
    pushRecentColor,
    DRAW_DEFAULT_RECENT_COLORS,
    DRAW_MAX_RECENT_COLORS,
    DRAW_COLOR_BLOCK_COUNT,
} from './palette';

// ─────────────────────────────────────────────────────────────────────────────
// The recency-ledger math + the default seed list (pure — no DOM).
//
// These back the right-side color palette contract: a 10-block column of
// 9 most-recently-used inks (most-recent-first) + a 10th color-wheel block,
// seeded by default with the most common colors (rainbow).
// ─────────────────────────────────────────────────────────────────────────────

describe('pushRecentColor — the recency-ledger update rule', () => {
    it('surfaces a fresh color at the front of the ledger', () => {
        expect(pushRecentColor(['#aaaaaa', '#bbbbbb', '#cccccc'], '#ffffff')).toEqual([
            '#ffffff',
            '#aaaaaa',
            '#bbbbbb',
            '#cccccc',
        ]);
    });

    it('re-surfaces a color already in the ledger without duplicating it', () => {
        expect(pushRecentColor(['#bbbbbb', '#aaaaaa', '#cccccc'], '#aaaaaa')).toEqual([
            '#aaaaaa',
            '#bbbbbb',
            '#cccccc',
        ]);
    });

    it('evicts the OLDEST entry once the ledger passes its cap', () => {
        expect(pushRecentColor(['#111111', '#222222', '#333333'], '#444444', 3)).toEqual([
            '#444444',
            '#111111',
            '#222222',
        ]);
    });

    it('caps exactly at the budget — never over', () => {
        expect(
            pushRecentColor(['#1', '#2', '#3', '#4', '#5'], '#6', 4),
        ).toEqual(['#6', '#1', '#2', '#3']);
    });

    it('recovers from a missing ledger (null/third-party state)', () => {
        expect(pushRecentColor(null as unknown as string[], '#aaaaaa')).toEqual(['#aaaaaa']);
    });

    it('treats hexes case-sensitively apart (a custom pick is lowercase; palette tokens lowercase)', () => {
        // '#AAAAAA' (uppercase — e.g. a raw user hex) is NOT equal to
        // '#aaaaaa': the ledger keeps simple exact-hex identity
        expect(pushRecentColor(['#aaaaaa'], '#AAAAAA')).toEqual(['#AAAAAA', '#aaaaaa']);
    });
});

describe('DRAW_DEFAULT_RECENT_COLORS — the most-common-color seed', () => {
    it('seeds the 9 recency blocks in rainbow order (red … purple, pink, white)', () => {
        expect(DRAW_DEFAULT_RECENT_COLORS).toEqual([
            '#f7768e', // red
            '#ff9e64', // orange
            '#e0af68', // yellow (gold)
            '#9ece6a', // green
            '#7dcfff', // cyan
            '#7aa2f7', // blue accent (the default stroke ink)
            '#bb9af7', // purple
            '#ff007c', // pink
            '#c0caf5', // white (text bright)
        ]);
    });

    it('holds DRAW_MAX_RECENT_COLORS entries — the 10th block is the wheel', () => {
        expect(DRAW_MAX_RECENT_COLORS).toBe(9);
        expect(DRAW_COLOR_BLOCK_COUNT).toBe(10);
    });
});
