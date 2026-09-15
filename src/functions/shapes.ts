// ─────────────────────────────────────────────────────────────────────────────
// Draw shapes — the pure world-coordinate shape model for the drawing tools.
//
// ALL shapes live in WORLD (canvas) coordinates: they are anchored to the
// infinite plane, so panning slides them and zooming scales them — exactly
// like the grid. The drawing layer plugin (plugins/features/drawingLayer
// Plugin.tsx) projects them to screen space with canvasToScreen at render
// time; nothing here touches the DOM.
//
// SHAPE SET (the user contract: "a drawing tool, a pen, and some basic
// shape tools"):
// - `path`  — the pen: a polyline of points captured while dragging
// - `circle`— center + radius (the drag defines the radius from the center)
// - `rect`  — two opposite corners (the drag defines the bounding box)
// - `line`  — two endpoints
//
// The builders below normalize the raw drag geometry (e.g. rect corners
// ordered min/max, circle radius always positive) so the renderer can be
// dumb. Pure math — fully unit-testable without a DOM.
// ─────────────────────────────────────────────────────────────────────────────

import { canvasToScreen } from './canvasTransform';
import type { CanvasTransform } from './canvasTransform';

// A 2D point in world (canvas) coordinates
export type DrawPoint = { x: number; y: number };

// The pen stroke — a polyline of captured points (≥ 2 points to be valid)
export type DrawPathShape = {
    kind: 'path';
    points: DrawPoint[];
};

// An axis-aligned ellipse rendered as a circle: center + radius (world units)
export type DrawCircleShape = {
    kind: 'circle';
    center: DrawPoint;
    radius: number;
};

// An axis-aligned rectangle: min/max corners (world units)
export type DrawRectShape = {
    kind: 'rect';
    // Top-left corner in world space (min x, min y)
    min: DrawPoint;
    // Bottom-right corner in world space (max x, max y)
    max: DrawPoint;
};

// A straight segment between two points
export type DrawLineShape = {
    kind: 'line';
    start: DrawPoint;
    end: DrawPoint;
};

// The discriminated union — the drawing layer switches on `kind`
export type DrawShape = DrawPathShape | DrawCircleShape | DrawRectShape | DrawLineShape;

// createPathShape — pen stroke from a captured point list. Empty and
// single-point lists produce null (a dot is not a stroke); the tool layer
// skips committing those.
export const createPathShape = (points: DrawPoint[]): DrawPathShape | null => {
    if (points.length < 2) return null;
    return { kind: 'path', points };
};

// createCircleShape — center + radius from the drag: the center is the
// press point, the radius is the distance to the release point. A zero
// radius (click without drag) produces null.
export const createCircleShape = (center: DrawPoint, edge: DrawPoint): DrawCircleShape | null => {
    const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
    if (radius <= 0) return null;
    return { kind: 'circle', center, radius };
};

// createRectShape — min/max corners from any two opposite drag corners
// (normalize so the rect is valid regardless of drag direction)
export const createRectShape = (a: DrawPoint, b: DrawPoint): DrawRectShape | null => {
    const min = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
    const max = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
    // Zero-area rect (click without drag) → not a shape
    if (max.x - min.x <= 0 || max.y - min.y <= 0) return null;
    return { kind: 'rect', min, max };
};

// createLineShape — two endpoints; zero-length (click without drag) → null
export const createLineShape = (start: DrawPoint, end: DrawPoint): DrawLineShape | null => {
    if (start.x === end.x && start.y === end.y) return null;
    return { kind: 'line', start, end };
};

// shapeToScreen — project a shape from world space to screen space for
// rendering. Returns an SVG-ready fragment descriptor per kind (the drawing
// layer maps these onto <path>/<circle>/<rect>/<line> elements).
export const shapeToScreen = (
    shape: DrawShape,
    transform: CanvasTransform,
): DrawShape => {
    switch (shape.kind) {
        case 'path':
            return {
                kind: 'path',
                points: shape.points.map((point) => canvasToScreen(point, transform)),
            };
        case 'circle':
            return {
                kind: 'circle',
                center: canvasToScreen(shape.center, transform),
                // Radius scales with zoom (a world-space circle)
                radius: shape.radius * transform.scale,
            };
        case 'rect':
            return {
                kind: 'rect',
                min: canvasToScreen(shape.min, transform),
                max: canvasToScreen(shape.max, transform),
            };
        case 'line':
            return {
                kind: 'line',
                start: canvasToScreen(shape.start, transform),
                end: canvasToScreen(shape.end, transform),
            };
    }
};
