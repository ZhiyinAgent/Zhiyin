/**
 * Hooks after a call (ADR 0026): code the composition root registers to run
 * after a named tool's call succeeds, which may add a note to what the model
 * is told of it. A hook reads what the call was given and answered; it cannot
 * change what the call did, and the loop gives it nothing that acts.
 */

/** A hook, run after each successful call to `tool`. */
export type AfterCallHook = {
  readonly tool: string;
  /** A note to add to the call's answer, or nothing. */
  readonly run: (call: {
    readonly input: unknown;
    readonly answer: unknown;
  }) => Promise<Readonly<Record<string, unknown>> | undefined>;
};

/**
 * The notes the hooks for `tool` add to a call's answer. A hook that fails
 * adds nothing, and the failure is handed to `failed`: the call has already
 * done its work, and a note is never worth undoing it.
 */
export async function notesAfter(
  hooks: readonly AfterCallHook[],
  tool: string,
  call: { readonly input: unknown; readonly answer: unknown },
  failed: (error: unknown) => void,
): Promise<Record<string, unknown>> {
  const notes: Record<string, unknown> = {};
  for (const hook of hooks) {
    if (hook.tool !== tool) continue;
    try {
      Object.assign(notes, await hook.run(call));
    } catch (error) {
      failed(error);
    }
  }
  return notes;
}
