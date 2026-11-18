/**
 * Decides allow / ask / deny for every filesystem, shell and network action the
 * agent attempts, and what a conversation's standing grants offer and cover.
 * The single place "is this safe" is decided.
 */

export * from "./permission-engine.js";
export * from "./standing-grants.js";
