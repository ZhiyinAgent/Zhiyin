/**
 * The files a task produced: what was made, how it is reviewed, and how it
 * leaves the workspace.
 *
 * A tool says which files it created or replaced; this feature turns that into
 * the durable record a person reads afterwards, and reads those files back on
 * demand. It never decides that an action was allowed and never writes into the
 * workspace — export copies outward only.
 *
 * Boundaries and invariants: docs/architecture/features/artifacts/README.md
 */

export * from "./artifacts.js";
