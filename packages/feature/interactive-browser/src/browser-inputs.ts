import { browserTools } from "./browser-tools.js";

/**
 * Inputs that name a place on disk. A picture is kept with the conversation
 * under an id the session store generates, so a filename the model chose has
 * nothing to select and everything to leak: it is removed from the schema the
 * model is shown, and from the arguments if one arrives regardless.
 */
const pathInputs = new Set(["filename"]);

/** The inputs Zhiyin answers for the model in a call to `name`. */
export function decidedInputs(name: string): Readonly<Record<string, unknown>> {
  return browserTools[name]?.decided ?? {};
}

/** Inputs the browser never receives from the model, so no approval shows them. */
export const hiddenInputs: ReadonlySet<string> = new Set([
  ...pathInputs,
  ...Object.values(browserTools).flatMap((tool) =>
    Object.keys(tool.decided ?? {}),
  ),
]);
