import { useState } from "react";
import type { McpSignInOutcome } from "@zhiyin/contract";

/**
 * A sign-in the person started from a connector's form: whether the browser is
 * still open for it, and why the last one failed. A cancelled one says
 * nothing; the person cancelled it.
 */
export function useConnectorSignIn(
  onSignIn: (() => Promise<McpSignInOutcome>) | undefined,
  onSignedIn: () => void = () => {},
) {
  const [signingIn, setSigningIn] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function start() {
    if (!onSignIn) return;
    setSigningIn(true);
    setFailure(null);
    try {
      const outcome = await onSignIn();
      if (outcome.status === "failed") setFailure(outcome.reason);
      if (outcome.status === "signed-in") onSignedIn();
    } catch {
      setFailure("Zhiyin could not start the sign-in.");
    } finally {
      setSigningIn(false);
    }
  }

  return { signingIn, failure, start };
}
