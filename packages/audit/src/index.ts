/**
 * A durable record of the corrections that deliberately never reach the
 * transcript.
 *
 * ADRs 0014 and 0016 made a whole class of event invisible: a tool refuses a
 * call as model-correctable, and either the model or a small repair model fixes
 * it without anyone being told. That is the right behaviour for a person trying
 * to get work done, and it leaves nothing at all behind — which means a model
 * that fails the same way every time, or a repair that is rejected for altering
 * protected content, cannot be seen from inside the app.
 *
 * This is where those events go instead. It is written for someone asking what
 * actually happened, after the fact: what was refused, what was proposed in its
 * place, and — when a repair was thrown away — precisely why.
 *
 * It is not a second transcript. Nothing here is shown to the person during
 * their work, and nothing here is sent to a model.
 *
 * Boundaries and invariants: docs/architecture/features/audit/README.md
 */

export * from "./audit.js";
