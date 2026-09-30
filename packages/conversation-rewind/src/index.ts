/**
 * Plans one exact revision of a conversation before anything durable changes.
 * It knows conversation records and nothing about persistence, files, models,
 * Electron, or rendering. The agent loop composes those boundaries.
 */

export * from "./conversation-rewind.js";
