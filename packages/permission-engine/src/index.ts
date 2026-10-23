/**
 * Decides allow / ask / deny for every filesystem, shell and network action the
 * agent attempts. The single place "is this safe" is decided.
 */

export * from "./permission-engine.js";
