/**
 * How Zhiyin looks: one of the listed looks, and how strongly its pictures
 * show. The window draws each look from its own stylesheet; this is the list
 * both the core and the window check a choice against (ADR 0028).
 */

export type LookId = "neutral" | "ink" | "dots";

/** How strongly a look's pictures show. A look with none ignores it. */
export type LookStrength = "subtle" | "default" | "vivid";

export type LookChoice = {
  readonly look: LookId;
  readonly strength: LookStrength;
};

/** Every look, in the order a person is offered them. */
export const lookIds: readonly LookId[] = ["neutral", "ink", "dots"];

export const lookStrengths: readonly LookStrength[] = [
  "subtle",
  "default",
  "vivid",
];

/** What a profile shows until the person chooses. */
export const defaultLook: LookChoice = { look: "ink", strength: "default" };
