// Barrel — the REMOVABLE feature plugins.
//
// Everything here is user-facing presentation or gesture interpretation.
// Removing any of these degrades the UX but the dashboard keeps functioning
// (the core input substrate in ../core keeps running).
export * from './gridPlugin';
export * from './coordinateHudPlugin';
export * from './zoomHudPlugin';
export * from './titlePlugin';
export * from './zoomOnWheelPlugin';
export * from './panOnWheelPlugin';
export * from './dragToPanPlugin';
export * from './toolbarPlugin';
export * from './toolRouterPlugin';
export * from './penToolPlugin';
export * from './shapeToolPlugins';
export * from './drawingLayerPlugin';
