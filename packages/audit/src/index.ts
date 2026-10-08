/**
 * A durable record of the corrections that deliberately never reach the
 * transcript.
 *
 * A whole class of event is invisible by design (ADR 0014): a tool refuses a
 * call as model-correctable, and the model corrects it, on its own or through
 * a separate repair request, without anyone being told. That is right for a
 * person trying to get work done, and without a record it would leave nothing
 * behind: a model that fails the same way every time, or a repair rejected for
 * altering protected content, could not be seen at all.
 *
 * This is where those events go. It is written for someone asking what
 * happened, after the fact: what was refused, what was proposed in its place,
 * and — when a repair was thrown away — precisely why.
 *
 * It is not a second transcript. Nothing here is shown to the person during
 * their work, and nothing here is sent to a model.
 *
 * Boundaries and invariants: docs/architecture/features/audit/README.md
 */

export * from "./audit.js";
