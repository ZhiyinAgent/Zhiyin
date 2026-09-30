/**
 * Whether a view can be drawn is a question only the surface holding the
 * drawing library can answer, and that surface is not in this process. This is
 * the correlation between asking and being answered: one question out, one
 * answer back, bounded by a timeout so a surface that never replies cannot
 * hold a turn open (ADR 0017).
 *
 * It is deliberately ignorant of how the question travels. The caller supplies
 * `ask`; whether that is IPC, a socket, or a function in the same process is
 * not this feature's business, which is what makes it testable with nothing
 * else present.
 */

export * from "./views.js";
