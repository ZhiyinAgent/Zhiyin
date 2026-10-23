/**
 * What an approval of a connector call is bound to: the connection, by its id
 * and address, the tool's schema, and what a built-in says the call acts on.
 * Switching another of the connection's tools off or on leaves it as it is.
 * The same identity is worked out again before the call runs, and a call whose
 * identity changed is refused, saying what changed.
 */

export function approvalIdentity(
  server: unknown,
  schema: unknown,
  action: string | undefined,
): string {
  return JSON.stringify({ server, schema, ...(action ? { action } : {}) });
}

/** The connection and schema an identity names, without what the call acts on. */
function connectionOf(identity: string): string {
  try {
    const { server, schema } = JSON.parse(identity) as Record<string, unknown>;
    return JSON.stringify({ server, schema });
  } catch {
    return identity;
  }
}

/** Why a call may not run under the approval it was given, or nothing when it may. */
export function changedSinceApproval(
  current: string | undefined,
  approved: string,
): string | undefined {
  if (current === approved) return undefined;
  return current !== undefined &&
    connectionOf(current) === connectionOf(approved)
    ? "What this call acts on changed after it was approved, so it did not run. Request approval again."
    : "The connection or this tool changed after approval. Request approval again.";
}
