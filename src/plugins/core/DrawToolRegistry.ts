// ─────────────────────────────────────────────────────────────────────────────
// DrawToolRegistry — the registry for TOOL plugins.
//
// THE TOOL SYSTEM (user contract: "add a plugin that allows tool bars at the
// bottom of the screen, centered... the plugin itself has no tools available,
// as tools themselves are plugin"):
//
// - A TOOL is a plugin that registers a DrawToolDefinition into this
//   registry. The definition carries: the display label, an SVG icon path,
//   a keyboard shortcut, and the tool's pointer-interaction handlers.
// - The TOOLBAR plugin (plugins/features/toolbarPlugin.tsx) is tool-
//   AGNOSTIC: it renders one button per registered tool by reading the
//   registry — it owns zero tool knowledge. With zero tools registered it
//   renders an empty pill (still the placeholder bar).
// - INTERACTION ROUTING: the toolInteractionPlugin (plugins/features/) reads
//   the active tool from the context and forwards pointer events to its
//   handlers. Tools never attach their own listeners — the router owns the
//   event stream, so tools are pure behavior definitions.
//
// The registry lives in the CONTEXT (created by the host, stable identity)
// so any plugin can register a tool at execution time.
// ─────────────────────────────────────────────────────────────────────────────

import type { DrawPoint } from '../../functions/shapes';

// The interaction handlers a tool can implement. All points are in WORLD
// coordinates (screenToCanvas applied by the router). Every handler is
// optional — a tool may only care about some phases.
export type DrawToolHandlers = {
    // Called on pointerdown when this tool is active. The point is the
    // press position in world coordinates.
    onDragStart?: (start: DrawPoint) => void;
    // Called on pointermove while the drawing drag is active. `current` is
    // the live pointer position in world coordinates.
    onDragMove?: (current: DrawPoint) => void;
    // Called on pointerup — the tool commits (or discards) its draft. The
    // point is the last tracked cursor position in world coordinates (the
    // router reads it from the pointer state — pointerup events can lack
    // coordinates).
    onDragEnd?: (end: DrawPoint) => void;
};

// The tool definition — what a tool plugin registers
export type DrawToolDefinition = {
    // Unique tool id (the activeTool context handle stores this)
    id: string;
    // Button label (tooltip / aria-label)
    label: string;
    // SVG path data for the button icon (24×24 viewbox)
    icon: string;
    // Keyboard shortcut (event.code) — optional. The toolRouter listens for
    // it and activates the tool.
    shortcut?: string;
    // The pointer-interaction handlers (see above)
    handlers: DrawToolHandlers;
};

// The registry — created ONCE by the host, passed through the context
export type DrawToolRegistry = {
    // Registers a tool. Duplicate ids are rejected (returns false).
    register: (tool: DrawToolDefinition) => boolean;
    // Removes a tool by id (returns true when found + removed).
    remove: (id: string) => boolean;
    // Lists the registered tools in registration order.
    list: () => DrawToolDefinition[];
    // Looks up a tool by id (undefined when not registered).
    get: (id: string) => DrawToolDefinition | undefined;
    // Whether a tool id is registered.
    has: (id: string) => boolean;
};

// createDrawToolRegistry — the factory (the host calls it once)
export const createDrawToolRegistry = (): DrawToolRegistry => {
    // Ordered tool list (registration order = toolbar button order)
    const tools: DrawToolDefinition[] = [];

    const findIndex = (id: string) => tools.findIndex((tool) => tool.id === id);

    return {
        register: (tool) => {
            if (findIndex(tool.id) !== -1) return false;
            tools.push(tool);
            return true;
        },
        remove: (id) => {
            const index = findIndex(id);
            if (index === -1) return false;
            tools.splice(index, 1);
            return true;
        },
        list: () => tools.map((tool) => ({ ...tool })),
        get: (id) => {
            const tool = tools.find((entry) => entry.id === id);
            return tool ? { ...tool } : undefined;
        },
        has: (id) => findIndex(id) !== -1,
    };
};
