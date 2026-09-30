/**
 * Everything that crosses between the core and the renderer, in one place.
 *
 * There is no code generation here and nothing to keep in sync: both sides are
 * TypeScript and import these declarations directly. The contract is the file,
 * not a build step.
 */

/** Identifies the running core. Answers "what am I actually talking to". */
export interface CoreInfo {
  readonly version: string;
}

/**
 * Everything the core can tell the renderer.
 *
 * One stream, not per-feature events: the audit trail and the live UI are
 * rendered from the same sequence, so there is no way for the app to do
 * something user-visible that the trail omits.
 */
export type WorkStep = {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly status: "complete" | "active" | "queued" | "failed";
};
